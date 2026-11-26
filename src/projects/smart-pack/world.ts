// Builds the Smart Pack line (stations 1 to 4) and advances it in time.
//
// Flow: test pallet with the TV standing → (1) robot lays it screen-down on the infeed → (2) bagger → (3) upender stands
// it up, the side clamps set it into the box base (EPS corners) that came from the preparation table → (4) the gantry
// takes a cover from the magazine and lowers it over the TV → existing stations 5–10.
// Interlocks (flow document, section 5): the robot only sets a TV down where the infeed is clear; one TV at a time in
// the bagger; the upender only takes a TV when its table is down and empty; the clamps only lower a TV into a base that
// is there and empty; the gantry only lowers a cover onto a box that holds a TV.
import * as THREE from 'three';
import { createAndons } from '../../sim/andon';
import { buildConveyor, liftUnit } from '../../sim/conveyor';
import { buildHall, createFloorMarks } from '../../sim/hall';
import { makeLine, station, updateLine } from '../../sim/line';
import { createMaterials } from '../../sim/materials';
import { runSeq, type Pose } from '../../sim/sequencer';
import type { Stage } from '../../sim/stage';
import { Track, line } from '../../sim/track';
import { rollerConveyor } from '../transfer-flow/rollers';
import {
  BAG_X, BELT_BOX, BELT_PACK, BELT_TEST, BOX_END, BOX_X, COVER_X, DEFAULT_TIMING, FEED_W, FEED_Z0, LINE_UPH, MAG_X0, PACK_X0, PAL_W, PIVOT_X,
  ROBOT, SEAT_BOX, SEAT_Y, SIZES, SPEED_BOX, SPEED_PACK, SPEED_TEST, TABLE_X0, TEST_X0, TEST_X1, LYING_Y, Y_BOX, Y_PACK, Y_TEST, Z_MAG, Z_PACK,
  Z_TEST, coverOf, trayOf, type Inch,
} from './config';
import {
  buildBagger, buildClampUnit, buildExisting, buildGantry, buildMagazineGuides, buildPrepTable, buildUpender, rollerConveyorZ,
} from './machines';
import { TV_BOXED, TV_STANDING, makeBase, makeCover, makePallet, makeTV, setBag } from './products';
import { createRobot, resetRobot, updateRobot } from './robot';
import type { BoxItem, CoverItem, PalletItem, PackItem, Params, World } from './types';

export const DEFAULT_PARAMS: Params = { inch: 55, feed: 'linha', timing: { ...DEFAULT_TIMING } };

const H = Math.PI / 2;
const hOf = (w: World) => SIZES[w.params.inch][1];
const wOf = (w: World) => SIZES[w.params.inch][0];

export function createWorld(stage: Stage, params: Params = { ...DEFAULT_PARAMS, timing: { ...DEFAULT_TIMING } }) {
  const { scene } = stage;
  const M = createMaterials();
  const andons = createAndons(M);
  const marks = createFloorMarks(scene);
  const ceiling = buildHall(scene, M);

  // ---------- conveyors ----------
  rollerConveyor(scene, M, { x0: TEST_X0, x1: TEST_X1, z: Z_TEST, top: Y_TEST, w: BELT_TEST });
  liftUnit(scene, M, { x: TEST_X1 + 0.15, z: Z_TEST, beltW: BELT_TEST, side: 1, open: 2.1 });
  const packTex = buildConveyor(scene, M, new Track([line(PACK_X0, Z_PACK, TABLE_X0 - 0.03, Z_PACK)], false), BELT_PACK, Y_PACK);
  rollerConveyor(scene, M, { x0: BOX_X - 0.35, x1: BOX_END, z: Z_PACK, top: Y_BOX, w: BELT_BOX });
  rollerConveyorZ(scene, M, BOX_X, FEED_Z0, Z_PACK + BELT_BOX / 2 + 0.03, Y_BOX, FEED_W);
  rollerConveyor(scene, M, { x0: MAG_X0 - 0.1, x1: COVER_X + 0.4, z: Z_MAG, top: Y_BOX, w: BELT_BOX });

  // ---------- equipment ----------
  const bag = buildBagger(scene, M);
  const up = buildUpender(scene, M);
  const cl = buildClampUnit(scene, M);
  const gt = buildGantry(scene, M);
  buildMagazineGuides(scene, M);
  buildPrepTable(scene, M);
  buildExisting(scene);
  // floor: the automated area (stations 1 to 4) and the robot's footprint
  marks.rect(TEST_X0 - 0.2, Z_MAG - 1.5, COVER_X + 1.1, FEED_Z0 + 1.1, 0.1);
  marks.rect(ROBOT.x - 0.4, ROBOT.z - 0.4, ROBOT.x + 0.4, ROBOT.z + 0.4, 0.04);

  const w = {
    scene, M, params, due: 0, baseAt: null,
    stats: { simT: 0, picked: 0, bagged: 0, boxed: 0, packed: 0, out: 0, bagT: 0, upT: 0, gantryT: 0 },
  } as unknown as World;

  // ---------- lines (station order along each line matters) ----------
  w.test = makeLine<PalletItem>({
    track: new Track([line(TEST_X0, Z_TEST, TEST_X1, Z_TEST)], false), speed: SPEED_TEST, gap: PAL_W + 0.1, tex: null, y: Y_TEST,
    onExit: it => scene.remove(it.obj),
  });
  w.pack = makeLine<PackItem>({
    track: new Track([line(PACK_X0, Z_PACK, PIVOT_X, Z_PACK)], false), speed: SPEED_PACK, gap: 1, tex: packTex, y: Y_PACK,
    onExit: it => scene.remove(it.obj),
  });
  w.feeder = makeLine<BoxItem>({
    track: new Track([line(BOX_X, FEED_Z0, BOX_X, Z_PACK)], false), speed: SPEED_BOX, gap: 1, tex: null, y: Y_BOX,
    onExit: it => scene.remove(it.obj),
  });
  w.boxes = makeLine<BoxItem>({
    track: new Track([line(BOX_X, Z_PACK, BOX_END, Z_PACK)], false), speed: SPEED_BOX, gap: trayOf(55).d + 0.15, tex: null, y: Y_BOX,
    onExit: it => { w.stats.out++; scene.remove(it.obj); },
  });
  w.mag = makeLine<CoverItem>({
    track: new Track([line(MAG_X0, Z_MAG, COVER_X, Z_MAG), line(COVER_X, Z_MAG, COVER_X + 0.1, Z_MAG)], false), speed: 0.4, gap: 0.36, tex: null, y: Y_BOX,
    onExit: it => scene.remove(it.obj),
  });

  // station 1
  w.robot = createRobot(w);
  // station 2: the TV stops in the middle of the bagger
  w.bagger = { item: null, t: 0, mouth: bag.mouth };
  station(w.pack, w.pack.track.sAtX(0, BAG_X), it => !it.bagged, it => { w.bagger.item = it; w.bagger.t = 0; });
  // station 3: gate before the table (one TV on it at a time), then the stop on the table (bottom edge on the foot)
  const upender = { seq: [], pose: [0], table: up.table, free: true, tv: null, tilted: false } as unknown as World['upender'];
  w.upender = upender;
  upender.gate = station(w.pack, 0, () => { if (upender.free) { upender.free = false; return false; } return true; }, () => {});
  upender.stop = station(w.pack, 0, () => true, it => startUpender(w, it));
  station(w.feeder, w.feeder.track.length - 0.001, () => true, it => { w.baseAt = it; });
  w.clamp = { seq: [], pose: [], group: cl.group, set: cl.setClamp, tv: null, busy: false };
  // station 4: covers queue on the magazine up to its end stop; the box stops under the gantry
  station(w.mag, w.mag.track.sAtX(0, COVER_X), () => true, () => {});
  station(w.boxes, w.boxes.track.sAtX(0, COVER_X), it => !it.covered, it => { w.gantry.target = it; });
  w.gantry = { seq: [], pose: [], head: gt.head, set: gt.setGantry, cover: null, target: null, busy: false };

  const lights = {
    bagger: andons.make(scene, bag.top.x, bag.top.y, bag.top.z),
    upender: andons.make(scene, PIVOT_X - 0.4, 2.92, Z_PACK + 1.25),
    gantry: andons.make(scene, COVER_X + 0.7, 3.92, Z_PACK + 1.25),
  };
  resetLine(w);
  return { world: w, andons, lights, ceiling };
}

// ---------- poses of the machines ----------
const clampHome = (w: World): Pose => [PIVOT_X + LYING_Y, Y_PACK + 0.02, 1];
const gantryHigh = (w: World) => Y_BOX + coverOf(w.params.inch).h + hOf(w) + 0.2;
const gantryHome = (w: World): Pose => [Z_MAG, gantryHigh(w)];
/** Linear axes: 0.8 m/s with a short ramp. */
const axisDur = (a: Pose, b: Pose) => 0.35 + Math.max(...a.map((v, i) => Math.abs(b[i] - v) / (i === 2 ? 2.5 : 0.8)));

function applyMachines(w: World) {
  const h = hOf(w), half = wOf(w) / 2;
  w.upender.table.rotation.z = w.upender.pose[0];
  const [x, yb, open] = w.clamp.pose;
  w.clamp.set(x, yb + 0.65 * h, half + 0.005 + open * 0.09);
  if (w.clamp.tv) {
    w.clamp.tv.obj.position.set(x, yb + h / 2, Z_PACK);
    w.clamp.tv.obj.quaternion.copy(TV_BOXED);
  }
  w.gantry.set(w.gantry.pose[0], w.gantry.pose[1]);
}

// ---------- station 3 ----------
function startUpender(w: World, it: PackItem) {
  const u = w.upender;
  u.seq.push(
    { dur: 0.3 },
    { fn: () => {
      w.pack.items.splice(w.pack.items.indexOf(it), 1);
      u.table.updateWorldMatrix(true, false);
      u.table.attach(it.tv.obj);
      w.scene.remove(it.obj);
      u.tv = it.tv;
    } },
    { to: [-H], dur: 2.6 }, // stand the TV up on the foot, screen against the table pads
    { fn: () => { u.tilted = true; } },
    { until: () => !u.tv }, // the clamps have it
    { fn: () => { u.tilted = false; } },
    { to: [0], dur: 2.0 },
    { fn: () => { u.free = true; } },
  );
}

function updateClamp(w: World) {
  const c = w.clamp, u = w.upender, h = hOf(w);
  if (c.seq.length || !u.tilted || !u.tv) return;
  const home = clampHome(w), [hx, hy] = home;
  c.seq.push(
    { to: [hx, hy, 0], dur: 0.5 }, // pads close on the TV's side edges
    { fn: () => { c.tv = u.tv; u.tv = null; w.scene.attach(c.tv!.obj); } },
    { to: [hx, hy + 0.03, 0], dur: 0.3 }, // off the foot
    { until: () => !!w.baseAt && !w.baseAt.tv && !!w.baseAt.hold },
    { toFn: () => [BOX_X, hy + 0.03, 0], durFn: axisDur },
    { toFn: () => [BOX_X, Y_BOX + SEAT_BOX, 0], durFn: axisDur }, // down into the EPS corners
    { to: [BOX_X, Y_BOX + SEAT_BOX, 1], dur: 0.4 },
    { fn: () => {
      const b = w.baseAt!, tv = c.tv!;
      b.inner.updateWorldMatrix(true, false);
      b.inner.attach(tv.obj);
      tv.obj.position.set(0, SEAT_BOX + h / 2, 0);
      tv.obj.quaternion.copy(TV_BOXED);
      b.tv = tv;
      c.tv = null;
      w.stats.boxed++;
    } },
    { to: [BOX_X, hy, 1], durFn: axisDur },
    { to: home, durFn: axisDur },
  );
}

// ---------- station 4 ----------
function updateGantry(w: World) {
  const g = w.gantry, inch = w.params.inch, ch = coverOf(inch).h, high = gantryHigh(w);
  if (g.seq.length) return;
  if (!g.cover) {
    const head = w.mag.items.find(it => it.hold);
    if (!head) return;
    g.seq.push(
      { to: [Z_MAG, Y_BOX + ch], durFn: axisDur },
      { dur: 0.4 }, // vacuum level confirmed
      { fn: () => {
        w.mag.items.splice(w.mag.items.indexOf(head), 1);
        g.head.updateWorldMatrix(true, false);
        g.head.attach(head.obj);
        g.cover = head;
      } },
      { to: [Z_MAG, high], durFn: axisDur },
    );
  } else if (g.target && g.target.hold) {
    const box = g.target;
    g.seq.push(
      { to: [Z_PACK, high], durFn: axisDur },
      { to: [Z_PACK, Y_BOX + 0.004 + ch], durFn: axisDur }, // the cover slides down over the TV and the tray
      { dur: 0.3 },
      { fn: () => {
        const cv = g.cover!;
        box.inner.updateWorldMatrix(true, false);
        box.inner.attach(cv.obj);
        cv.obj.position.set(0, 0.004, 0);
        cv.obj.quaternion.identity();
        box.covered = true;
        box.hold = null;
        g.cover = null;
        g.target = null;
        w.stats.packed++;
      } },
      { to: [Z_PACK, high], durFn: axisDur },
      { to: gantryHome(w), durFn: axisDur },
    );
  }
}

// ---------- feeding ----------
function addPallet(w: World, s: number) {
  const obj = makePallet(w.M), inch = w.params.inch;
  w.scene.add(obj);
  const tv = makeTV(w.M, inch);
  obj.add(tv.obj);
  tv.obj.position.set(0, SEAT_Y + SIZES[inch][1] / 2, 0);
  tv.obj.quaternion.copy(TV_STANDING); // as on the Transfer Flow test belt: screen toward +z, back toward the robot
  w.test.items.push({ obj, s, hold: null, passed: new Set(), tv });
}

function addBase(w: World, s: number) {
  const obj = new THREE.Group(), inner = new THREE.Group();
  obj.add(inner);
  inner.rotation.y = -H; // the feeder runs along −z: keep the base square to the box line
  inner.add(makeBase(w.M, w.params.inch));
  w.scene.add(obj);
  w.feeder.items.push({ obj, inner, s, hold: null, passed: new Set(), tv: null, covered: false });
}

function addCover(w: World, s: number) {
  const obj = makeCover(w.M, w.params.inch);
  w.scene.add(obj);
  w.mag.items.push({ obj, s, hold: null, passed: new Set() });
}

const startFree = (L: World['test'] | World['feeder'] | World['mag']) => L.items.every(it => it.s >= L.gap);

function updateFeed(w: World, dt: number) {
  // TVs from the functional test: at the line cadence of the model, or as fast as the station takes them
  const rate = w.params.feed === 'max' ? Infinity : LINE_UPH[w.params.inch] / 3600;
  w.due = Math.min(2, w.due + dt * rate);
  if (w.due >= 1 && startFree(w.test)) { addPallet(w, 0); w.due -= 1; }
  // the operator keeps three bases on the feeder; the magazine is kept with seven covers
  if (w.feeder.items.length < 3 && startFree(w.feeder)) addBase(w, 0);
  if (w.mag.items.length + (w.gantry.cover ? 1 : 0) < 7 && startFree(w.mag)) addCover(w, 0);
  // a base with its TV goes from the end of the feeder onto the box line
  const b = w.baseAt;
  if (b && b.tv && w.boxes.items.every(it => it.s >= w.boxes.gap)) {
    w.feeder.items.splice(w.feeder.items.indexOf(b), 1);
    Object.assign(b, { s: 0, hold: null, passed: new Set() });
    b.inner.rotation.y = 0;
    w.boxes.items.push(b);
    w.baseAt = null;
  }
}

/** Advance the line by dt simulated seconds. */
export function step(w: World, dt: number) {
  const st = w.stats;
  st.simT += dt;
  updateFeed(w, dt);
  updateLine(w.test, dt);
  updateLine(w.pack, dt);
  updateLine(w.feeder, dt);
  updateLine(w.boxes, dt);
  updateLine(w.mag, dt);
  updateRobot(w, w.robot, dt);

  // station 2: bag over the TV from its bottom edge; the mouth frame travels from the leading edge to the trailing one
  const bg = w.bagger, h = hOf(w), bagS = w.params.timing.bagS;
  if (bg.item) {
    bg.t += dt;
    st.bagT += dt;
    const u = Math.min(1, Math.max(0, (bg.t - 1.2) / Math.max(0.5, bagS - 2.4)));
    setBag(bg.item.bag, u);
    bg.mouth.position.x = h / 2 + 0.03 - u * (h + 0.06);
    if (bg.t >= bagS) { bg.item.bagged = true; bg.item.hold = null; bg.item = null; st.bagged++; }
  } else {
    const rest = 0.95; // waits downstream of the TV position
    bg.mouth.position.x += (rest - bg.mouth.position.x) * Math.min(1, dt * 1.5);
  }

  // station 3: let the next TV onto the table once it is down and empty
  const u = w.upender;
  if (u.free) { const held = w.pack.items.find(it => it.hold === u.gate); if (held) { held.hold = null; u.free = false; } }
  updateClamp(w);
  runSeq(u, dt);
  runSeq(w.clamp, dt);
  if (u.seq.length || w.clamp.seq.length) st.upT += dt;
  // station 4
  updateGantry(w);
  runSeq(w.gantry, dt);
  if (w.gantry.seq.length) st.gantryT += dt;
  applyMachines(w);
}

export function resetStats(w: World) {
  Object.assign(w.stats, { simT: 0, picked: 0, bagged: 0, boxed: 0, packed: 0, out: 0, bagT: 0, upT: 0, gantryT: 0 });
  w.robot.busyT = 0;
  w.robot.maxErr = 0;
}

/** Restart the line from empty for the model in w.params (lot change). */
export function resetLine(w: World) {
  for (const L of [w.test, w.pack, w.feeder, w.boxes, w.mag] as const) { L.items.forEach(it => w.scene.remove(it.obj)); L.items.length = 0; }
  for (const o of [w.upender.tv, w.clamp.tv, w.gantry.cover]) if (o) o.obj.parent?.remove(o.obj);
  resetRobot(w, w.robot);
  const inch: Inch = w.params.inch, h = hOf(w);
  // per model: pitch on the packing line (the TV's height along it), the gate and the table stop, the box pitch
  w.pack.gap = h + 0.12;
  w.upender.gate.s = w.pack.track.sAtX(0, TABLE_X0 - 0.08 - h / 2);
  w.upender.stop.s = w.pack.track.sAtX(0, PIVOT_X - 0.02 - h / 2);
  w.feeder.gap = trayOf(inch).l + 0.12;
  w.boxes.gap = coverOf(inch).d + 0.14;
  Object.assign(w.upender, { seq: [], pose: [0], free: true, tv: null, tilted: false });
  Object.assign(w.clamp, { seq: [], pose: clampHome(w), tv: null });
  Object.assign(w.gantry, { seq: [], pose: gantryHome(w), cover: null, target: null });
  Object.assign(w.bagger, { item: null, t: 0 });
  w.baseAt = null;
  w.due = 1;
  // the line opens with TVs queued on the test line, bases on the feeder and the magazine full
  for (let k = 0; k < 2; k++) addPallet(w, w.test.track.sAtX(0, 0) - 1.2 - k * w.test.gap);
  for (let k = 0; k < 3; k++) addBase(w, w.feeder.track.length - 0.01 - k * w.feeder.gap);
  for (let k = 0; k < 7; k++) addCover(w, w.mag.track.sAtX(0, COVER_X) - k * w.mag.gap);
  applyMachines(w);
  resetStats(w);
}

/** Pallets at the line cadence in TVs per hour, for the panel. */
export const lineRate = (w: World) => LINE_UPH[w.params.inch];
