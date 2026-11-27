// Builds the Smart Pack line (stations 1 to 4) and advances it in time.
//
// Flow: test pallet with the TV standing → (1) the robot lays it screen-down on the infeed, as it lay on the assembly
// belt → (2) bagger → (3) the upender stands it up sideways; the side clamps carry it across onto the box line, into
// the base (EPS corners) that came ready down the chute onto that line, parallel to the packing line → (4) the tube
// erector opens a folded box into a tube and the gantry lowers it over the TV, top flaps open → existing stations 5–10.
// Interlocks (flow document, section 5): the robot only sets a TV down where the infeed is clear; one TV at a time in
// the bagger; the upender only takes a TV when its table is down and empty; the clamps only lower a TV into a base that
// is there and empty; the gantry only lowers a tube onto a box that holds a TV; the erector head and the gantry never
// work over the erector table at the same time.
import * as THREE from 'three';
import { createAndons } from '../../sim/andon';
import { buildConveyor, liftUnit } from '../../sim/conveyor';
import { buildHall, createFloorMarks } from '../../sim/hall';
import { makeLine, station, updateLine, type Line, type LineItem } from '../../sim/line';
import { createMaterials } from '../../sim/materials';
import { runSeq, type Pose } from '../../sim/sequencer';
import type { Stage } from '../../sim/stage';
import { Track, line } from '../../sim/track';
import { rollerConveyor } from '../transfer-flow/rollers';
import {
  BAGGER, BAG_X, BELT_BOX, BELT_PACK, BELT_TEST, BOX_END, BOX_X0, COVER_X, DEFAULT_TIMING, FEED_X, ERECT, ERECT_SPEED, LINE_UPH, LYING_Y, MAG_Z0, PACK_X0, PAL_W, PIVOT_Z, ROBOT,
  SEAT_BOX, SEAT_Y, SIZES, SPEED_BOX, SPEED_PACK, SPEED_TEST, TABLE_L, TABLE_X0, TEST_X0, TEST_X1, UP_X, Y_BOX, Y_PACK, Y_TEST, Z_BASE, Z_EDGE, Z_MAG,
  Z_PACK, Z_TEST, coverOf, RELEASE_X, type Inch,
} from './config';
import {
  buildBagger, buildClampUnit, buildExisting, buildGantry, buildBaseChute, buildErector, CHUTE, chuteY, buildUpender,
} from './machines';
import { TV_BOXED, TV_STANDING, makeBase, makePallet, makeTube, makeTV, setBag, type Tube } from './products';
import { measureClearance } from './clearance';
import { createRobot, resetRobot, updateRobot } from './robot';
import type { BoxItem, PalletItem, PackItem, Params, World } from './types';

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
  // the ceiling (trusses, light rows, pipes) casts no shadow: it would show on the floor whenever it is drawn
  ceiling.traverse(o => { o.userData.noShadow = true; o.castShadow = false; });

  // ---------- conveyors ----------
  rollerConveyor(scene, M, { x0: TEST_X0, x1: TEST_X1, z: Z_TEST, top: Y_TEST, w: BELT_TEST });
  liftUnit(scene, M, { x: TEST_X1 + 0.15, z: Z_TEST, beltW: BELT_TEST, side: 1, open: 2.1 });
  const packTex = buildConveyor(scene, M, new Track([line(PACK_X0, Z_PACK, TABLE_X0 - 0.03, Z_PACK)], false), BELT_PACK, Y_PACK);
  rollerConveyor(scene, M, { x0: BOX_X0, x1: BOX_END, z: Z_BASE, top: Y_BOX, w: BELT_BOX });

  // ---------- equipment ----------
  const bag = buildBagger(scene, M);
  const up = buildUpender(scene, M);
  const cl = buildClampUnit(scene, M);
  const gt = buildGantry(scene, M);
  const er = buildErector(scene, M);
  const chute = buildBaseChute(scene, M);
  const feed = { queue: [], moving: null, setStopper: chute.setStopper };
  buildExisting(scene);
  // floor: the automated area (stations 1 to 4) and the robot's footprint
  marks.rect(TEST_X0 - 0.2, MAG_Z0 - 0.4, COVER_X + 1.5, 1.2, 0.1);
  marks.rect(ROBOT.x - 0.4, ROBOT.z - 0.4, ROBOT.x + 0.4, ROBOT.z + 0.4, 0.04);

  const w = {
    scene, M, params, due: 0, baseAt: null, feed,
    stats: { simT: 0, picked: 0, bagged: 0, boxed: 0, packed: 0, out: 0, bagT: 0, upT: 0, gantryT: 0 },
  } as unknown as World;

  // ---------- lines (station order along each line matters) ----------
  w.test = makeLine<PalletItem>({
    track: new Track([line(TEST_X0, Z_TEST, TEST_X1, Z_TEST)], false), speed: SPEED_TEST, gap: PAL_W + 0.1, tex: null, y: Y_TEST,
    onExit: it => scene.remove(it.obj),
  });
  w.pack = makeLine<PackItem>({
    track: new Track([line(PACK_X0, Z_PACK, TABLE_X0 + TABLE_L, Z_PACK)], false), speed: SPEED_PACK, gap: 1, tex: packTex, y: Y_PACK,
    onExit: it => scene.remove(it.obj),
  });
  w.boxes = makeLine<BoxItem>({
    track: new Track([line(BOX_X0, Z_BASE, BOX_END, Z_BASE)], false), speed: SPEED_BOX, gap: 1, tex: null, y: Y_BOX,
    onExit: it => { w.stats.out++; scene.remove(it.obj); },
  });

  // station 1
  // release stop (cadence) before station 1
  w.release = station(w.test, w.test.track.sAtX(0, RELEASE_X), it => { if (!it.tv) return false; if (w.due >= 1) { w.due -= 1; return false; } return true; }, () => {});
  w.robot = createRobot(w);
  // station 2: the TV stops in the middle of the bagger
  w.bagger = { item: null, t: 0, mouth: bag.mouth, inside: null } as unknown as World['bagger'];
  // one TV in the bagger cabin at a time: the next one waits before the entry until the one inside has left it
  w.bagger.gate = station(w.pack, 0, it => { if (!w.bagger.inside) { w.bagger.inside = it; return false; } return true; }, () => {});
  station(w.pack, w.pack.track.sAtX(0, BAG_X), it => !it.bagged, it => { w.bagger.item = it; w.bagger.t = 0; });
  // station 3: gate before the table (one TV on it at a time), then the stop in the middle of the table
  const upender = { seq: [], pose: [0], table: up.table, free: true, tv: null, tilted: false } as unknown as World['upender'];
  w.upender = upender;
  upender.gate = station(w.pack, 0, () => { if (upender.free) { upender.free = false; return false; } return true; }, () => {});
  upender.stop = station(w.pack, w.pack.track.sAtX(0, UP_X), () => true, it => startUpender(w, it));
  // the empty base waits under the clamps; then (with its TV) under the gantry
  station(w.boxes, w.boxes.track.sAtX(0, UP_X), it => !it.tv, it => { w.baseAt = it; });
  station(w.boxes, w.boxes.track.sAtX(0, COVER_X), it => !it.covered, it => { w.gantry.target = it; });
  w.clamp = { seq: [], pose: [], group: cl.group, set: cl.setClamp, tv: null, busy: false };
  w.gantry = { seq: [], pose: [], head: gt.head, set: gt.setGantry, cover: null, target: null, busy: false };
  w.erector = { seq: [], pose: [], box: null, ready: null, arm: 0, count: ERECT.n, setHead: er.setHead, setArm: er.setArm, setStack: er.setStack };
  w.zone = null;

  const lights = {
    bagger: andons.make(scene, bag.top.x, bag.top.y, bag.top.z),
    upender: andons.make(scene, UP_X + 1.4, 2.92, Z_PACK + 1.1),
    gantry: andons.make(scene, COVER_X + 1.2, 3.92, Z_BASE + 0.65),
  };
  resetLine(w);
  return { world: w, andons, lights, ceiling };
}

// ---------- poses of the machines ----------
/** Clamps waiting over the TV that the upender stands up: [z, TV bottom height, open 0–1]. */
const clampHome = (): Pose => [PIVOT_Z - LYING_Y, Y_PACK + 0.02, 1];
const gantryHigh = (w: World) => Y_BOX + coverOf(w.params.inch).h + hOf(w) + 0.2;
/** Empty, the gantry waits high over the box line (clear of the erector table). */
const gantryHome = (w: World): Pose => [Z_BASE, gantryHigh(w)];
/** Erector: transfer height of the grip (the standing box clears the table by 15 cm), the grip over the stack, at the table. */
const erHigh = (w: World) => Math.max(ERECT.yS, Y_BOX + coverOf(w.params.inch).h / 2) + 0.15;
const erHome = (w: World): Pose => [ERECT.zS, erHigh(w), 1, 0];
const erDur = (a: Pose, b: Pose) => 0.3 + Math.max(Math.abs(b[0] - a[0]) / ERECT_SPEED.z, Math.abs(b[1] - a[1]) / ERECT_SPEED.y, Math.abs(b[2] - a[2]) * ERECT_SPEED.turnS, Math.abs(b[3] - a[3]) * ERECT_SPEED.openS);
const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), XA = new THREE.Vector3(1, 0, 0);
/** Linear axes: 0.8 m/s with a short ramp (the clamp opening is the third axis of the clamps). */
const axisDur = (a: Pose, b: Pose) => 0.35 + Math.max(...a.map((v, i) => Math.abs(b[i] - v) / (i === 2 ? 2.5 : 0.8)));

function applyMachines(w: World) {
  const h = hOf(w), half = wOf(w) / 2;
  w.upender.table.rotation.x = w.upender.pose[0];
  const [z, yb, open] = w.clamp.pose;
  w.clamp.set(z, yb + 0.65 * h, half + 0.005 + open * 0.09);
  if (w.clamp.tv) {
    w.clamp.tv.obj.position.set(UP_X, yb + h / 2, z);
    w.clamp.tv.obj.quaternion.copy(TV_BOXED);
  }
  w.gantry.set(w.gantry.pose[0], w.gantry.pose[1]);
  // erector: the head; the folded box in it hangs from the grip (middle of panel A's outer face); the arm
  const e = w.erector, { l, d, h: ch } = coverOf(w.params.inch), [ez, ey, et, eu] = e.pose;
  e.setHead(ez, ey, et);
  if (e.box) {
    _q.setFromAxisAngle(XA, (et * Math.PI) / 2);
    _p.set(0, ch / 2, -d / 2).applyQuaternion(_q);
    e.box.obj.quaternion.copy(_q);
    e.box.obj.position.set(COVER_X - _p.x, ey - _p.y, ez - _p.z);
    e.box.set(eu);
  }
  e.setArm(e.arm, l, d);
  e.setStack(e.count, l, d, ch);
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
    { to: [-H], dur: 2.6 }, // stand the TV up sideways on the foot, screen against the table pads
    { fn: () => { u.tilted = true; } },
    { until: () => !u.tv }, // the clamps have it
    { fn: () => { u.tilted = false; } },
    { dur: 0.4 },
    { to: [0], dur: 2.0 },
    { fn: () => { u.free = true; } },
  );
}

function updateClamp(w: World) {
  const c = w.clamp, u = w.upender, h = hOf(w);
  if (c.seq.length || !u.tilted || !u.tv) return;
  const home = clampHome(), [hz, hy] = home, carry = hy + 0.12;
  c.seq.push(
    { to: [hz, hy, 0], dur: 0.5 }, // pads close on the TV's side edges
    { fn: () => { c.tv = u.tv; u.tv = null; w.scene.attach(c.tv!.obj); } },
    { to: [hz, carry, 0], dur: 0.4 }, // off the foot, clear of the belt rails
    { until: () => !!w.baseAt && !w.baseAt.tv && !!w.baseAt.hold },
    { toFn: () => [Z_BASE, carry, 0], durFn: axisDur }, // across, over the box line
    { toFn: () => [Z_BASE, Y_BOX + SEAT_BOX, 0], durFn: axisDur }, // down into the EPS corners
    { to: [Z_BASE, Y_BOX + SEAT_BOX, 1], dur: 0.4 },
    { fn: () => {
      const b = w.baseAt!, tv = c.tv!;
      b.inner.updateWorldMatrix(true, false);
      tv.obj.updateMatrixWorld(true);
      b.inner.attach(tv.obj);
      tv.obj.position.set(0, SEAT_BOX + h / 2, 0);
      b.tv = tv;
      b.hold = null;
      c.tv = null;
      w.baseAt = null;
      w.stats.boxed++;
    } },
    { to: [Z_BASE, hy + 0.12, 1], durFn: axisDur },
    { to: home, durFn: axisDur },
  );
}

// ---------- station 4 ----------
function updateGantry(w: World) {
  const g = w.gantry, ch = coverOf(w.params.inch).h, high = gantryHigh(w), e = w.erector;
  if (g.seq.length) return;
  if (!g.cover) {
    // the open tube on the erector table, once the erector head is out of the way
    const tube = e.ready;
    if (!tube || w.zone) return;
    w.zone = 'gantry';
    g.seq.push(
      { to: [Z_MAG, high], durFn: axisDur },
      { to: [Z_MAG, Y_BOX + ch], durFn: axisDur }, // pads either side of the long walls, under the top edge
      { dur: 0.4 }, // vacuum level confirmed
      { fn: () => {
        g.head.updateWorldMatrix(true, false);
        g.head.attach(tube.obj);
        g.cover = tube;
        e.ready = null;
      } },
      { to: [Z_MAG, high], durFn: axisDur },
      { to: [Z_BASE, high], durFn: axisDur },
      { fn: () => { w.zone = null; } },
    );
  } else if (g.target && g.target.hold) {
    const box = g.target;
    g.seq.push(
      { to: [Z_BASE, high], durFn: axisDur },
      { to: [Z_BASE, Y_BOX + 0.004 + ch], durFn: axisDur }, // the tube slides down over the TV and the tray
      { dur: 0.3 },
      { fn: () => {
        const tube = g.cover!;
        box.inner.updateWorldMatrix(true, false);
        box.inner.attach(tube.obj); // as it was let go: centred on the base, flaps up
        box.covered = true;
        box.hold = null;
        g.cover = null;
        g.target = null;
        w.stats.packed++;
      } },
      { to: gantryHome(w), durFn: axisDur },
    );
  }
}

/**
 * Tube erector: picks the next folded box from the stack and holds it lifted; when its table is empty, the arm is back
 * and the gantry is away, it stands the box on the table, the arm opens it into a tube, the head lets go and goes back.
 */
function updateErector(w: World, dt: number) {
  const e = w.erector, { d, h: ch } = coverOf(w.params.inch), yT = erHigh(w);
  // while opening, the arm follows panel B; it swings back only once the tube has been lifted clear of it
  if (e.box && e.pose[3] > 0) e.arm = e.pose[3];
  else if (!e.ready && e.arm > 0 && (!w.gantry.cover || w.gantry.pose[1] - ch > Y_BOX + 0.6)) e.arm = Math.max(0, e.arm - dt / 0.8);
  if (e.seq.length) return;
  const zT = Z_MAG - d / 2; // grip at the table: panel A's outer face
  if (!e.box) {
    e.seq.push(
      { to: erHome(w), durFn: erDur },
      { to: [ERECT.zS, ERECT.yS, 1, 0], durFn: erDur },
      { dur: 0.3 }, // vacuum
      { fn: () => {
        const t = makeTube(w.M, w.params.inch);
        w.scene.add(t.obj);
        e.box = t;
        e.count--;
        if (e.count < 3) e.count = ERECT.n; // pallet changed from outside (PROVISIONAL: no stop for it)
      } },
      { to: erHome(w), durFn: erDur },
    );
  } else if (!e.ready && e.arm === 0 && !w.zone) {
    w.zone = 'erector';
    e.seq.push(
      { to: [zT - 0.05, yT, 0, 0], durFn: erDur }, // turns it up on the way
      { to: [zT, Y_BOX + ch / 2 + 0.003, 0, 0], durFn: erDur },
      { fn: () => { e.arm = 0; } },
      { to: [zT, Y_BOX + ch / 2 + 0.003, 0, 1], durFn: erDur }, // the arm pulls panel B round: a tube
      { dur: 0.2 },
      { fn: () => { e.arm = 1; e.ready = e.box; e.box = null; } },
      { to: [zT - 0.2, Y_BOX + ch / 2, 0, 0], dur: 0.5 },
      { to: [Z_MAG - 0.8, yT, 0.5, 0], durFn: erDur },
      { fn: () => { w.zone = null; } },
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
  tv.obj.quaternion.copy(TV_STANDING); // as on the Transfer Flow test belt: back toward this robot, screen toward +z
  w.test.items.push({ obj, s, hold: null, passed: new Set(), tv });
}

/** A ready base (EPS corners in place), its length along the line (the TV's width). */
function newBase(w: World) {
  const obj = new THREE.Group(), inner = new THREE.Group();
  obj.add(inner);
  inner.rotation.y = H;
  inner.add(makeBase(w.M, w.params.inch));
  w.scene.add(obj);
  return { obj, inner };
}
function addBase(w: World, s: number, b = newBase(w)) {
  w.boxes.items.push({ ...b, s, hold: null, passed: new Set(), tv: null, covered: false });
}
/** Bases waiting on the infeed chute (it runs up to the floor line). */
const CHUTE_N = 8;
/** Place of slot k on the infeed chute (k = 0 at the stopper). */
const chuteSlot = (k: number) => { const z = CHUTE.zEnd - 0.17 - k * 0.34; return new THREE.Vector3(FEED_X, chuteY(z), z); };
/** Bases on the chute: they slide down to their slots; one released goes onto the box line in about a second. */
function updateChute(w: World, dt: number) {
  const f = w.feed;
  f.queue.forEach((b, k) => b.obj.position.lerp(chuteSlot(k), Math.min(1, dt * 2.5)));
  if (f.moving) {
    const m = f.moving;
    m.t += dt;
    const u = Math.min(1, m.t / 1.0), a = chuteSlot(0);
    m.obj.position.set(FEED_X, a.y + (Y_BOX - a.y) * u, a.z + (Z_BASE - a.z) * u);
    if (u >= 1) { addBase(w, FEED_S, m); f.moving = null; f.setStopper(false); }
  }
  while (f.queue.length < CHUTE_N) { // a new base comes in at the top of the chute (from outside the line)
    const b = newBase(w);
    b.obj.position.copy(chuteSlot(f.queue.length + 1));
    f.queue.push(b);
  }
}

/** An open tube standing on the erector table (line start). */
function openTube(w: World): Tube {
  const t = makeTube(w.M, w.params.inch);
  t.set(1);
  t.obj.position.set(COVER_X, Y_BOX, Z_MAG);
  w.scene.add(t.obj);
  return t;
}

/** Where the feeder sets a base down (along the box line). */
const FEED_S = FEED_X - BOX_X0;
const startFree = <I extends LineItem>(L: Line<I>) => L.items.every(it => it.s >= L.gap);

function updateFeed(w: World, dt: number) {
  // TVs from the functional test: the test line comes full (a pallet whenever its start has room) and the release stop
  // lets one go at the line cadence of the model, or as fast as the station takes them
  // ("máxima": always one due. Not Infinity × dt: with dt = 0 on the first frame that is NaN, and the stop would never
  // let a TV go again)
  w.due = w.params.feed === 'max' ? 1 : Math.min(1, (Number.isFinite(w.due) ? w.due : 1) + dt * LINE_UPH[w.params.inch] / 3600);
  if (startFree(w.test)) addPallet(w, 0);
  if (w.due >= 1) { const held = w.test.items.find(p => p.hold === w.release); if (held) { held.hold = null; w.due -= 1; } }
  // the chute keeps three empty bases on the box line: its stopper lets one slide on when the photo-eye sees the box
  // line clear (the base before has moved a pitch on)
  if (!w.feed.moving && w.feed.queue.length && w.boxes.items.filter(b => !b.tv).length < 3 && w.boxes.items.every(b => b.s >= FEED_S + w.boxes.gap)) {
    w.feed.moving = { ...w.feed.queue.shift()!, t: 0 };
    w.feed.setStopper(true);
  }
  updateChute(w, dt);
}

/** Advance the line by dt simulated seconds. */
export function step(w: World, dt: number) {
  const st = w.stats;
  st.simT += dt;
  updateFeed(w, dt);
  updateLine(w.test, dt);
  updateLine(w.pack, dt);
  updateLine(w.boxes, dt);
  updateRobot(w, w.robot, dt);

  // station 2: the bag goes on from the TV's bottom edge (far side); the mouth frame travels across to the top edge
  const bg = w.bagger, h = hOf(w), bagS = w.params.timing.bagS, edge = Z_EDGE - Z_PACK;
  if (bg.item) {
    bg.t += dt;
    st.bagT += dt;
    const u = Math.min(1, Math.max(0, (bg.t - 1.2) / Math.max(0.5, bagS - 2.4)));
    setBag(bg.item.bag, u);
    bg.mouth.position.z = edge - 0.03 + u * (h + 0.06);
    if (bg.t >= bagS) { bg.item.bagged = true; bg.item.hold = null; bg.item = null; st.bagged++; }
  } else {
    const rest = edge - 0.2; // waits past the TV's bottom edge
    bg.mouth.position.z += (rest - bg.mouth.position.z) * Math.min(1, dt * 1.5);
  }

  // station 2: the cabin is free once the TV inside has left it whole; then the next one may go in
  const tw = wOf(w);
  if (bg.inside && (!w.pack.items.includes(bg.inside) || bg.inside.obj.position.x - tw / 2 > BAGGER.x1 + 0.02)) bg.inside = null;
  if (!bg.inside) { const held = w.pack.items.find(it => it.hold === bg.gate); if (held) { held.hold = null; bg.inside = held; } }
  // station 3: let the next TV onto the table once it is down and empty
  const u = w.upender;
  if (u.free) { const held = w.pack.items.find(it => it.hold === u.gate); if (held) { held.hold = null; u.free = false; } }
  updateClamp(w);
  runSeq(u, dt);
  runSeq(w.clamp, dt);
  if (u.seq.length || w.clamp.seq.length) st.upT += dt;
  // station 4
  updateErector(w, dt);
  runSeq(w.erector, dt);
  updateGantry(w);
  runSeq(w.gantry, dt);
  if (w.gantry.seq.length) st.gantryT += dt;
  applyMachines(w);
  checkClearance(w);
}

export function resetStats(w: World) {
  Object.assign(w.stats, { simT: 0, picked: 0, bagged: 0, boxed: 0, packed: 0, out: 0, bagT: 0, upT: 0, gantryT: 0 });
  w.robot.busyT = 0;
  w.robot.maxErr = 0;
}

/** Restart the line from empty for the model in w.params (lot change). */
export function resetLine(w: World) {
  for (const L of [w.test, w.pack, w.boxes] as const) { L.items.forEach(it => w.scene.remove(it.obj)); L.items.length = 0; }
  for (const o of [w.upender.tv, w.clamp.tv, w.gantry.cover, w.erector.box, w.erector.ready]) if (o) o.obj.parent?.remove(o.obj);
  resetRobot(w, w.robot);
  const inch: Inch = w.params.inch, tw = wOf(w);
  // per model: pitch on the packing line (the TV's width along it), the gate before the table, the box pitch
  w.pack.gap = tw + 0.15;
  w.pack.speed = w.params.timing.beltSpeed;
  w.upender.gate.s = w.pack.track.sAtX(0, TABLE_X0 - 0.08 - tw / 2);
  w.bagger.gate.s = w.pack.track.sAtX(0, BAGGER.x0 - 0.08 - tw / 2);
  w.boxes.gap = coverOf(inch).l + 0.15;
  Object.assign(w.upender, { seq: [], pose: [0], free: true, tv: null, tilted: false });
  Object.assign(w.clamp, { seq: [], pose: clampHome(), tv: null });
  Object.assign(w.gantry, { seq: [], pose: gantryHome(w), cover: null, target: null });
  Object.assign(w.bagger, { item: null, t: 0, inside: null });
  w.baseAt = null;
  w.due = 1;
  // the line opens with TVs queued on the test line, empty bases on the box line and the magazine full
  // the test line comes full from the functional test: one TV on its way to station 1, the rest queued at the release stop
  addPallet(w, w.test.track.sAtX(0, 0) - 1.2);
  for (let s = w.test.track.sAtX(0, RELEASE_X); s >= 0; s -= w.test.gap) addPallet(w, s);
  for (let k = 0; k < 3; k++) addBase(w, w.boxes.track.sAtX(0, UP_X) - k * w.boxes.gap);
  // the infeed chute with ready bases for this lot
  for (const b of [...w.feed.queue, ...(w.feed.moving ? [w.feed.moving] : [])]) w.scene.remove(b.obj);
  w.feed.queue.length = 0;
  w.feed.moving = null;
  w.feed.setStopper(false);
  for (let k = 0; k < CHUTE_N; k++) { const b = newBase(w); b.obj.position.copy(chuteSlot(k)); w.feed.queue.push(b); }
  void inch;
  // station 4 starts with an open tube on the erector table and a full stack of folded boxes
  Object.assign(w.erector, { seq: [], pose: erHome(w), box: null, ready: openTube(w), arm: 1, count: ERECT.n });
  w.zone = null;
  applyMachines(w);
  resetStats(w);
}

/** Pallets at the line cadence in TVs per hour, for the panel. */
export const lineRate = (w: World) => LINE_UPH[w.params.inch];

/** Turn the collision check of station 1 on (from zero): every 2nd step keeps the smallest clearance. */
export const startClearance = (w: World) => { w.clear = { min: Infinity, at: '', n: 0, worst: new Map() }; };
export function checkClearance(w: World) {
  if (!w.clear || ++w.clear.n % 2) return;
  const c = measureClearance(w, w.clear.worst);
  if (c.min < w.clear.min) { w.clear.min = c.min; w.clear.at = c.at; }
}
