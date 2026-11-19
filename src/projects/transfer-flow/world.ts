// Builds the Transfer Flow line and advances it in time. No DOM besides canvases for textures.
import { createAndons } from '../../sim/andon';
import { buildConveyor, flowArrow, liftUnit } from '../../sim/conveyor';
import { buildFence, buildHall, createFloorMarks } from '../../sim/hall';
import { makeLine, station, updateLine } from '../../sim/line';
import { createMaterials } from '../../sim/materials';
import { UR10E, UR30 } from '../../sim/robots/ur-kinematics';
import { upgradeArm } from '../../sim/robots/ur-arm';
import type { Stage } from '../../sim/stage';
import { Track, line } from '../../sim/track';
import {
  BELT_ASM, BELT_TEST, BUFFER_X, FENCE_Z, ITEM_GAP, JIG_L, JIG_TOP, LIFT_OPEN, LINE_X0, LINE_X1, PAL_W, ROBOT_X1, ROBOT_X2, SEAT_Y, SIZES,
  SPEED_ASM, SPEED_TEST, TOP, TV_T, Z_ASM, Z_PAL, Z_TEST, slotX, slotsFor, type Inch,
} from './config';
import { buildInspectionCell, createInspector, drawInsp, resetInspector, updateInspector } from './inspection';
import { makeJig, makePallet, makeTV, tvPower, type TV } from './products';
import { commitJig, createTransfer, dispatchPallets, hasTV, resetTransfer, updateRobots } from './transfers';
import type { Jig, Pallet, Params, World } from './types';

export const DEFAULT_PARAMS: Params = { inch: 43, arms: 'both', mode: 'auto', simulateNG: false, uphTarget: 600 };

export function createWorld(stage: Stage, params: Params = { ...DEFAULT_PARAMS }) {
  const { scene } = stage;
  const M = createMaterials();
  const andons = createAndons(M);
  const marks = createFloorMarks(scene);

  // ---------- conveyors ----------
  const asmTrack = new Track([line(LINE_X0, Z_ASM, LINE_X1, Z_ASM)], false);
  const testBeltTrack = new Track([line(LINE_X0, Z_TEST, LINE_X1, Z_TEST)], false);
  const testTrack = new Track([line(LINE_X0, Z_PAL, LINE_X1, Z_PAL)], false); // pallets ride 30 cm off the belt centre
  const asmTex = buildConveyor(scene, M, asmTrack, BELT_ASM, TOP);
  const testTex = buildConveyor(scene, M, testBeltTrack, BELT_TEST, TOP);
  flowArrow(scene, LINE_X1 - 2.2, Z_ASM - 0.35, TOP + 0.005);
  flowArrow(scene, LINE_X0 + 1.4, Z_TEST - 0.38, TOP + 0.005);
  for (const [lz, bw] of [[Z_ASM, BELT_ASM], [Z_TEST, BELT_TEST]]) for (const sx of [-1, 1] as const) {
    liftUnit(scene, M, { x: (sx < 0 ? LINE_X0 : LINE_X1) + sx * 0.15, z: lz, beltW: bw, side: sx, open: LIFT_OPEN });
  }

  const w = {
    stage, scene, M, params,
    robots: [], palletBuffer: [], okCount: 0, palletDemand: 0, losses: { tv: 0, emptyPallet: 0 },
    stats: { ok: 0, ng: 0, okTV: 0, ngTV: 0, inspTV: 0, moved: 0, simT: 0 },
    floorRect: marks.rect,
  } as unknown as World;

  // accumulation belts with stoppers · queued items keep 10 cm apart
  w.asm = makeLine<Jig>({
    track: asmTrack, speed: SPEED_ASM, gap: JIG_L + ITEM_GAP, tex: asmTex, y: TOP,
    onExit: it => { if (hasTV(it) && !it.ng) w.losses.tv++; scene.remove(it.obj); },
  });
  w.test = makeLine<Pallet>({
    track: testTrack, speed: SPEED_TEST, gap: PAL_W + ITEM_GAP, tex: testTex, y: TOP,
    onExit: it => { if (!it.tvs.length) w.losses.emptyPallet++; scene.remove(it.obj); },
  });

  // ---------- floor, fence, hall ----------
  marks.rect(LINE_X0 - 1.6, -2.85, LINE_X1 + 1.6, 4.2, 0.1); // cell boundary, with the operator aisle behind the test belt
  buildFence(scene, M, FENCE_Z);
  const ceiling = buildHall(scene, M);

  // ---------- inspection cell ----------
  const cell = buildInspectionCell(w, marks.line);
  w.hmi = cell.hmi;
  w.inspAndon = andons.make(scene, cell.cellTop.x, cell.cellTop.y, cell.cellTop.z);

  // ---------- robots (station order matters: transfers first, then the inspector, then the pallet buffer) ----------
  w.robots = [
    createTransfer(w, ROBOT_X1, { home: 0 }), // both transfers swing the same way, through the downstream side
    createTransfer(w, ROBOT_X2, { home: 0 }),
  ];
  w.insp = createInspector(w);
  // pallet buffer just before robot 1: empty pallets wait here and leave one per TV committed to a robot
  station(w.test, w.test.track.sAtX(0, BUFFER_X), it => !it.released && !it.tvs.length, it => w.palletBuffer.push(it));

  prefill(w);
  drawInsp(w, 'idle', null, 0);
  return { world: w, andons, ceiling };
}

/** Swap the planner rigs for the UR arms: transfers UR30 · inspection UR10e. */
export function mountArms(w: World) {
  w.robots.forEach(r => upgradeArm(w.scene, r.arm, r.pose, UR30));
  upgradeArm(w.scene, w.insp.arm, w.insp.pose, UR10E);
}

/** Robot enable flags from the arms parameter. */
export function applyArms(w: World) {
  w.robots[0].enabled = w.params.arms !== 't2';
  w.robots[1].enabled = w.params.arms !== 't1';
}

// ---------- feeding ----------
function addAsmItem(w: World, s: number, inspected: boolean) {
  const j = makeJig(w.M);
  w.scene.add(j.g);
  const inch = w.params.inch, tvs: TV[] = [];
  for (let k = 0; k < slotsFor(inch); k++) { // screen down, side by side for 32"/43"
    const tv = makeTV(w.M, inch);
    tv.obj.rotation.x = Math.PI;
    tv.obj.position.set(slotX(inch, k), JIG_TOP + TV_T / 2, 0);
    j.g.add(tv.obj);
    tvs.push(tv);
  }
  const it: Jig = { obj: j.g, ledMat: j.ledMat, s, hold: null, passed: new Set(), tvs, inch, inspected, ng: false };
  if (inspected) { j.ledMat.emissive.setHex(0x22c55e); commitJig(w, it); }
  w.asm.items.push(it);
  return it;
}

function addPallet(w: World, s: number, inch: Inch | null) {
  const obj = makePallet(w.M);
  w.scene.add(obj);
  const it: Pallet = { obj, s, hold: null, passed: new Set(), tvs: [], released: !!inch };
  if (inch) {
    const tv = makeTV(w.M, inch);
    obj.add(tv.obj);
    tv.obj.position.set(0, SEAT_Y + SIZES[inch][1] / 2, 0);
    tv.obj.rotation.set(-Math.PI / 2, 0, Math.PI);
    tvPower(tv, 'swoosh');
    it.tvs.push(tv);
  }
  w.test.items.push(it);
  return it;
}

/** Assembly keeps feeding as fast as the belt has room (the transfer cell is never starved); 3 empty pallets wait. */
function updateSpawn(w: World) {
  const { asm, test } = w;
  const minS = asm.items.reduce((m, it) => Math.min(m, it.s), Infinity);
  if (minS >= asm.gap) addAsmItem(w, 0, false);
  else if (minS >= 0 && !asm.items.some(it => it.s < 0)) addAsmItem(w, minS - asm.gap, false); // one jig waits inside the lift
  const minP = test.items.reduce((m, it) => Math.min(m, it.s), Infinity);
  const waiting = test.items.filter(it => !it.released && !it.tvs.length).length;
  if (waiting < 3 && minP >= test.gap) addPallet(w, 0, null);
}

function prefill(w: World) {
  addAsmItem(w, 0, false);
  addAsmItem(w, 3.67, true);
  addPallet(w, 12.2, w.params.inch);
}

/** Advance the line by dt simulated seconds. */
export function step(w: World, dt: number) {
  w.stats.simT += dt;
  updateSpawn(w);
  updateLine(w.asm, dt);
  updateLine(w.test, dt);
  // the jig still inside the lift (s < 0) rises with it instead of being drawn over the jig already on the belt
  for (const it of w.asm.items) if (it.s < 0) it.obj.position.y = TOP - 0.8 * Math.min(1, -it.s / (JIG_L * 0.5));
  updateRobots(w, dt);
  dispatchPallets(w);
  updateInspector(w, dt);
}

export function resetStats(w: World) {
  Object.assign(w.stats, { ok: 0, ng: 0, okTV: 0, ngTV: 0, inspTV: 0, moved: 0, simT: 0 });
  w.robots.forEach(r => { r.busyT = 0; r.totT = 0; r.palT = 0; r.count = 0; });
  w.insp.busyT = 0;
  w.losses.tv = 0;
  w.losses.emptyPallet = 0;
}

/** Restart the line from empty (model or parameter change). */
export function resetLine(w: World) {
  for (const L of [w.asm, w.test] as const) { L.items.forEach(it => w.scene.remove(it.obj)); L.items.length = 0; }
  w.palletBuffer.length = 0;
  w.palletDemand = 0;
  w.okCount = 0;
  w.robots.forEach(r => resetTransfer(w, r));
  resetInspector(w);
  prefill(w);
  resetStats(w);
  drawInsp(w, 'idle', null, 0);
}
