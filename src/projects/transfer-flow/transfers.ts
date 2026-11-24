// Transfer 1 and Transfer 2 (UR30 with a vacuum plate): take TVs from the assembly jigs and stand them, screen toward
// the test aisle, on the test pallets.
//
// Line logic (one TV per robot cycle, one TV per test pallet):
// · Robot 1 (upstream) takes one TV from a jig only when the work-split rule gives it one, then lets the jig go on.
// · The last enabled robot takes every TV that is left, holding the jig until it is empty. No good TV leaves the belt.
// · A robot's pallet need is known as soon as a TV is committed to it, so the buffer releases a pallet right away.
// · Pallets are not addressed: an empty pallet stops at the first robot that still needs one,
//   so robot 1 lets it go on to robot 2 when it already has its pallet. No pallet leaves empty.
import { station } from '../../sim/line';
import { hookGripper } from '../../sim/robots/grippers';
import * as THREE from 'three';
import { ease } from '../../sim/math';
import { capsuleBoxGap, capsuleGap, linkCapsules, obstacleBox, type Obstacle } from '../../sim/robots/collision';
import { gripperCaps, robotSegs } from './clearance';
import { LED, makeCobot, poseAt, solve, urTrack } from '../../sim/robots/ur-arm';
import { urFK } from '../../sim/robots/ur-kinematics';
import { runSeq, type Pose, type Step } from '../../sim/sequencer';
import {
  ARM_DX, BELT_ASM, BELT_TEST, gripOf, ITEM_GAP, JIG_L, JIG_TOP, JIG_W, LINE_X0, LINE_X1, PAL_W, PICK_Y, ROBOT_X1, ROBOT_X2, ROBOT_Z, SEAT_Y, SIZES, TOP,
  TRANSFER_PED, TV_BACK, TV_T, CUP_Z, HOOK_D,
  Z_ASM, Z_PAL, Z_TEST, slotZ, type Inch,
} from './config';
import { tvPower } from './products';
import type { Jig, Mode, Pallet, Transfer, World } from './types';

const H = Math.PI / 2;

export const hasTV = (it: Jig | Pallet) => !!it.tvs && it.tvs.some(Boolean);
export const tvCount = (it: Jig) => it.tvs.filter(Boolean).length;

/** 'auto': pair jigs (32"/43") → 'B' (jigs alternate, each robot empties its own); single-TV jigs → 'free'. */
export const modeOf = (w: World, it: Jig): Exclude<Mode, 'auto'> => (w.params.mode === 'auto' ? 'B' : w.params.mode);

/** The last ENABLED robot along the belt takes everything left and holds the jig until it is empty. */
export const lastEnabled = (w: World) => {
  for (let i = w.robots.length - 1; i >= 0; i--) if (w.robots[i].enabled) return w.robots[i];
  return w.robots[w.robots.length - 1];
};
export const isLastR = (w: World, r: Transfer) => r === lastEnabled(w);
const enabledCount = (w: World) => w.robots.filter(r => r.enabled).length;

/** Commit `count` TVs of a jig to the last robot (only the part not committed before). */
export function giveToLast(w: World, jig: Jig, count: number) {
  const extra = count - (jig.toLast || 0);
  if (extra > 0) { lastEnabled(w).addNeed(extra); jig.toLast = count; }
}

/** An approved jig: number it and call the last robot's pallets as soon as its share is certain. */
export function commitJig(w: World, it: Jig) {
  it.okIndex = w.okCount++;
  if (enabledCount(w) === 1) { giveToLast(w, it, tvCount(it)); return; }
  const pair = tvCount(it) === 2, second = it.okIndex % 2 === 1, m = modeOf(w, it);
  if (m === 'B') { if (!second) giveToLast(w, it, tvCount(it)); }
  else if (pair) giveToLast(w, it, 1);
  else if (m === 'A' && !second) giveToLast(w, it, 1);
}

export function createTransfer(w: World, x: number, phi: { home: number; wrapPositive?: boolean }): Transfer {
  const { asm, test } = w;
  // 1.0 m column: the UR30 shoulder near the height of the work (TVs lying on the jig, standing in the pallet)
  const arm = makeCobot(w.scene, w.M, { x: x - ARM_DX, z: ROBOT_Z, L1: 0.64, L2: 0.5, ped: TRANSFER_PED, pedW: 0.3 });
  hookGripper(arm.mount, w.M, { hookD: HOOK_D, cupZ: CUP_Z });
  arm.tool.rotation.order = 'YXZ';
  w.floorRect(x - ARM_DX - 0.4, ROBOT_Z - 0.4, x - ARM_DX + 0.4, ROBOT_Z + 0.4, 0.04);
  const home: Pose = [phi.home, 0.75, 0.05, H, Math.PI]; // parked (arm switched off): half open, plate level
  const r: Transfer = {
    arm, x, D: HOOK_D, wrap: p => (phi.wrapPositive && p < 0 ? p + 2 * Math.PI : p),
    enabled: true, count: 0, seq: [], state: 'idle', job: null, pallet: null, need: 0, carried: null, leaving: null, zoneBusy: false,
    busyT: 0, totT: 0, palT: 0, home, pose: home.slice(), jm: null,
    // fixed things a move is planned against, besides the belts and the jig: the lift units at the belt ends and the
    // other transfer's pedestal
    env: [
      ...[[LINE_X0, Z_ASM], [LINE_X1, Z_ASM], [w.testX0, Z_TEST], [LINE_X1, Z_TEST]].map(([lx, lz], i) =>
        obstacleBox('elevador', lx + (i % 2 ? 0.15 : -0.15), 1.2, lz, 2.6 + 0.1, 2.4, 1.7 + 0.1)),
      ...[ROBOT_X1, ROBOT_X2].filter(px => Math.abs(px - x) > 0.5).map(px => obstacleBox('pedestal do outro transfer', px - ARM_DX, TRANSFER_PED / 2, ROBOT_Z, 0.36, TRANSFER_PED, 0.36)),
    ],
    addNeed: n => { if (n > 0) { r.need += n; w.palletDemand += n; } },
    pickSt: null!, gateSt: null!, placeSt: null!,
  };
  const free = () => !r.job && r.state === 'idle';
  r.pickSt = station(asm, asm.track.sAtX(0, x), it => {
    if (!hasTV(it) || !it.inspected || it.ng) return false;
    if (!r.enabled) { giveToLast(w, it, tvCount(it)); return false; } // arm switched off: everything goes on
    if (isLastR(w, r)) return true;
    // work split for the upstream robot:
    //  'free' – takes one TV only if it is free at that instant
    //  'A'    – fixed split: one TV of every pair (the jig waits for it); single-TV jigs alternate
    //  'B'    – jigs alternate; each robot empties its own jig
    const m = modeOf(w, it), mine = m === 'free' ? free() : m === 'A' ? it.tvs.length === 2 || it.okIndex! % 2 === 1 : it.okIndex! % 2 === 1;
    if (mine) return true;
    giveToLast(w, it, tvCount(it)); // not for robot 1: the whole jig goes straight on to robot 2
    return false;
  }, it => { r.job = it; if (!isLastR(w, r)) r.addNeed(modeOf(w, it) === 'B' ? tvCount(it) : 1); });
  // interlock: while the plate is still at the TV just placed, the next pallet waits one slot before the dock
  r.gateSt = station(test, test.track.sAtX(0, x) - (PAL_W + ITEM_GAP) + 0.02, it => !!r.zoneBusy && it !== r.leaving, () => {});
  r.placeSt = station(test, test.track.sAtX(0, x), it => {
    if (r.enabled && it.released && !it.tvs.length && r.need > 0 && !r.pallet) { r.pallet = it; return true; }
    return false;
  }, () => {});
  return r;
}

function setJoints(r: Transfer, q: number[]) {
  const ur = r.arm.ur!;
  ur.q = q.slice();
  ur.joints.forEach((j, i) => { j.rotation.z = q[i]; });
}

/**
 * Clearance of the robot with itself in joints `q`: its arm (from the upper arm on) and its pedestal against the TV
 * it carries, and the arm against its own pedestal. (Everything else is checked by the cell's collision bench.)
 */
let clearWhat = '';
function selfClearance(r: Transfer, q: number[]): number {
  setJoints(r, q);
  const caps = linkCapsules(r.arm, 0.015), b = r.arm.root.position;
  const ped: Obstacle = obstacleBox('pedestal', b.x, TRANSFER_PED / 2, b.z, 0.36, TRANSFER_PED, 0.36);
  let min = Infinity;
  const mn = (v: number, what: string) => { if (v < min) { min = v; clearWhat = what; } };
  for (const c of caps) if (c.link >= 2) mn(capsuleBoxGap(c, ped), `elo ${c.link} × pedestal`);
  // the fixed things around: both belts (up to the roller top) and the jig foam at this robot's pick stop; the arm
  // and the gripper must clear them (the cups only touch the TV)
  // the TVs lying on the jig at this robot's stop (the cups touch the one being picked; the bracket and bars may not)
  const plateSlab = obstacleBox('TVs no gabarito', b.x, (TOP + JIG_TOP + PICK_Y) / 2, Z_ASM, JIG_L, PICK_Y - TOP - JIG_TOP - 0.003, JIG_W);
  const tvSlab = obstacleBox('TVs no gabarito', b.x, TOP + JIG_TOP + (TV_T + 0.045) / 2, Z_ASM, JIG_L, TV_T + 0.045, JIG_W);
  const env: Obstacle[] = [
    obstacleBox('esteira de montagem', b.x, TOP / 2, Z_ASM, 2.4, TOP, BELT_ASM + 0.08),
    obstacleBox('esteira de teste', b.x, TOP / 2, Z_TEST, 2.4, TOP, BELT_TEST + 0.08),
    obstacleBox('gabarito', b.x, TOP + JIG_TOP / 2, Z_ASM, JIG_L, JIG_TOP, JIG_W),
    ...r.env,
  ];
  const m = r.arm.mount;
  m.updateWorldMatrix(true, false);
  const W = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(m.matrixWorld);
  const grip = gripperCaps().map(c => ({ a: W(...c.a), b: W(...c.b), r: c.r + 0.005 }));
  for (const o of env) {
    for (const c of caps) if (c.link >= 2) mn(capsuleBoxGap(c, o), `elo ${c.link} × ${o.name}`);
    for (const g of grip) mn(capsuleBoxGap(g, o), `garra × ${o.name}`);
  }
  // the gripper against the pedestal; against the TVs on the jig only the stem (the plate sits on the one it picks)
  for (const g of grip) mn(capsuleBoxGap(g, ped), 'garra × pedestal');
  mn(capsuleBoxGap(grip[0], plateSlab), 'haste da garra × TVs no gabarito');
  // the plate over the TVs: it rests on the one it picks (2 cm of credit for that), but sweeps over none
  for (const g of grip.slice(1)) mn(capsuleBoxGap(g, plateSlab) + 0.02, 'placa × TVs no gabarito');
  for (const c of caps) if (c.link >= 2) mn(capsuleBoxGap(c, plateSlab), `elo ${c.link} × TVs no gabarito`);
  // the test pallets around (with their TVs), except the one the carried TV is going into
  for (const o of [...dyn, ...dock]) {
    for (const c of caps) if (c.link >= 2) mn(capsuleBoxGap(c, o), `elo ${c.link} × pallet`);
    for (const g of grip) mn(capsuleBoxGap(g, o), 'garra × pallet');
  }
  // the arm against itself (links that are not neighbours) and the whole gripper against the base, shoulder and upper
  // arm: the same parts as the collision bench
  const segs = robotSegs(r, 0);
  for (const s of segs) for (const t of segs) if (t.link - s.link >= 3 && (t.link < 7 || s.link <= 2)) mn(capsuleGap(s, t) - 0.005, `próprio braço: ${s.name.split('· ')[1]} × ${t.name.split('· ')[1]}`);
  const tv = r.carried;
  if (tv) {
    tv.obj.updateWorldMatrix(true, false);
    const [w, d] = SIZES[tv.inch];
    const o: Obstacle = { name: 'TV', box: new THREE.Box3(new THREE.Vector3(-w / 2, -TV_T / 2 - 0.045, -d / 2), new THREE.Vector3(w / 2, TV_T / 2, d / 2)), inv: tv.obj.matrixWorld.clone().invert() };
    for (const c of caps) if (c.link <= 5) mn(capsuleBoxGap(c, o), `elo ${c.link} × TV carregada`);
    // the TV against the pedestal, the belts, the lift units, the other pedestal, the test pallets and (once it is off
    // them) the TVs still on the jig: its corners and edges
    const offJig = tv.obj.getWorldPosition(new THREE.Vector3()).y > tvSlab.box.max.y + 0.12;
    const corners = [ped, env[0], env[1], ...r.env, ...dyn, ...(offJig ? [tvSlab] : [])];
    const box = o.box, M = tv.obj.matrixWorld, p = new THREE.Vector3();
    for (let i = 0; i <= 4; i++) for (let k = 0; k <= 4; k++) for (const y of [box.min.y, box.max.y]) {
      p.set(box.min.x + (box.max.x - box.min.x) * i / 4, y, box.min.z + (box.max.z - box.min.z) * k / 4).applyMatrix4(M);
      for (const e of corners) mn(e.box.containsPoint(p) ? -0.01 : e.box.distanceToPoint(p), `TV carregada × ${e.name}`);
    }
  }
  return min;
}

// (the taught program is checked without the test pallets: they move; the bench checks them every step)
const dyn: Obstacle[] = [], dock: Obstacle[] = [];

/** Smallest self-clearance along the straight joint path q0 → q1 (and at q1). */
let worstWhat = '';
function pathClearance(r: Transfer, q0: number[], q1: number[]) {
  let min = Infinity;
  // a sample every ~3° of the joint that moves most (a long base turn sweeps the TV a long way)
  const n = Math.max(8, Math.ceil(Math.max(...q0.map((v, i) => Math.abs(q1[i] - v))) / 0.05));
  for (let k = 1; k <= n; k++) {
    const u = k / n, c = selfClearance(r, q0.map((v, i) => v + (q1[i] - v) * u));
    if (c < min) { min = c; worstWhat = clearWhat; }
  }
  return min;
}

// ---------- the taught program ----------
// Like a real robot cell, each transfer runs a fixed program per TV size: the same joint positions every cycle, all in
// one posture (shoulder toward the work, elbow and wrist 2 on the positive side), checked for clearance once when it
// is taught. Pick: over the TV, down, lift. Swing: the base alone turns to the test side, then the wrist stands the
// TV up over its seat. Place: down into the groove, release, back off, up over the TVs. Return: the base turns back
// the same way, the arm settles over the jig.

/**
 * The one posture family of the whole cycle (the arm never flips between configurations): shoulder toward the work
 * (the upper arm not thrown back over the base), elbow joint positive; the wrist kept as it was from point to point.
 */
const inFamily = (q: number[]) => q[2] >= 0.12 && q[1] < 0.4 && q[1] > -Math.PI + 0.15;

/** Joint move time: big joints ~115°/s, wrist ~170°/s with the TV on the flange (UR30: 120°/s and 210°/s), plus settling. */
const jointDur = (a: number[], b: number[]) => {
  let big = 0, small = 0;
  a.forEach((v, i) => { const d = Math.abs(b[i] - v); if (i < 3) big = Math.max(big, d); else small = Math.max(small, d); });
  return 0.2 + Math.max(big / 2.0, small / 3.0);
};

/** The arm faces the work: seen from above, the elbow is on the flange's side of the shoulder (no reaching back over
 *  the top with the base turned the other way). */
const _fs = new THREE.Vector3(), _fe = new THREE.Vector3(), _ff = new THREE.Vector3();
function facing(r: Transfer, q: number[]) {
  const ur = r.arm.ur!;
  _fs.setFromMatrixPosition(urFK(ur, q, 2)); _fe.setFromMatrixPosition(urFK(ur, q, 3)); _ff.setFromMatrixPosition(urFK(ur, q, 6));
  // (a little lean back is fine: the work close to the base)
  const reach = Math.hypot(_ff.x - _fs.x, _ff.z - _fs.z);
  return (_fe.x - _fs.x) * (_ff.x - _fs.x) + (_fe.z - _fs.z) * (_ff.z - _fs.z) > -0.15 * reach;
}

const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
/** `q` with every joint but the base moved to the equivalent nearest `ref` (the base is set by the program). */
const near = (ref: number[], q: number[]) => q.map((v, i) => (i === 0 ? v : ref[i] + angDiff(ref[i], v)));

interface Key { q: number[]; pose: Pose }
interface Program {
  /** Back over the jig, high (the return ends here; the next pick goes down from it). */
  home: Key;
  /** Per TV slot on the jig: over it, at it, lifted with it; and the base turn from there to the test side. */
  above: Key[]; pick: Key[]; lift: Key[]; turn: number[];
  /** Per slot (the grip point differs): over the seat, in the seat, backed off, up over the TVs. */
  over: Key[]; seat: Key[]; back: Key[]; up: Key[];
  /** Where the swing ends: over the seat, or (when the wrist must change configuration between the pick and the place,
   *  as on the 75") high above it, where the TV clears the arm while the wrist turns. */
  high: Key[];
}
const programs = new Map<string, Program>();

/** Joints for `pose` in the posture family, nearest `ref` (or with the most clearance, without one). */
function teach(r: Transfer, pose: Pose, ref: number[] | null, wrist = 0): number[] {
  const ur = r.arm.ur!;
  let best: { score: number; q: number[] } | null = null;
  const seeds: number[][] = ref ? [ref] : [];
  for (const q0 of [-0.9, -0.4, 0.1].map(o => pose[0] + o)) for (const q1 of [-0.2, -0.7, -1.3, -1.9]) for (const q2 of [0.5, 1.2, 2.0, 2.6]) for (const q3 of [-2.0, -0.6, 0.8]) for (const q4 of [-1.6, -0.9, 0.9, 1.6]) seeds.push([q0, q1, q2, q3, q4, ref ? ref[5] : 0]);
  let minErr = Infinity, outFam: number[] | null = null;
  const outAll: number[][] = [];
  for (const s of seeds) {
    ur.q = s.slice();
    const e0 = urTrack(r.arm, pose, 60);
    minErr = Math.min(minErr, e0);
    if (e0 > 0.02 || urTrack(r.arm, pose, 100) > 0.003) continue;
    let q = ur.q.map(v => Math.atan2(Math.sin(v), Math.cos(v)));
    if (!inFamily(q) || !facing(r, q)) { if (!outAll.some(o => o.every((v, i) => Math.abs(v - q[i]) < 0.05))) outAll.push(q); outFam = q; continue; }
    if (ref) q = near(ref, q);
    const clear = selfClearance(r, q);
    // the wrist keeps its configuration from point to point (wrist 2 on the same side): no wrist roll on the way
    const want = wrist || (ref ? Math.sign(ref[4]) : 0);
    const flip = want && Math.sign(q[4]) !== want ? 50 : 0;
    const dist = (ref ? q.reduce((a, v, i) => a + (i === 0 ? 0 : Math.abs(v - ref[i])), 0) : 0) + flip;
    const score = (clear < 0.02 ? 100 - clear * 100 : 0) + dist - (ref ? 0 : Math.min(clear, 0.2) * 10);
    if (!best || score < best.score) best = { score, q };
  }
  if (!best) { console.warn(`transfer: sem postura para a pose ${pose.map(v => v.toFixed(2)).join(' ')} (erro mín. ${minErr.toFixed(3)}, fora da família: ${outAll.map(o => '[' + o.map(v => v.toFixed(2)).join(' ') + ']').join(' ')})`); void outFam; return ref ?? ur.q.slice(); }
  return best.q;
}

/** The program for this robot and TV size (taught once, then reused). */
function programOf(r: Transfer, inch: Inch): Program {
  const id = `${r.x}:${inch}`;
  const hit = programs.get(id);
  if (hit) return hit;
  const ur = r.arm.ur!, keep = ur.q.slice(), carried = r.carried;
  r.carried = null;
  const key = (pose: Pose, ref: number[] | null): Key => ({ q: teach(r, pose, ref), pose });
  // a stand-in for the TV in the cups, so the points taught with a TV in hand keep it clear of the arm
  const fake = { obj: new THREE.Group(), inch, screen: null as unknown as THREE.Mesh };
  const scene = r.arm.root.parent!;
  scene.add(fake.obj);
  const grab = (k: number, q: number[]) => {
    setJoints(r, q);
    r.arm.mount.updateWorldMatrix(true, false);
    scene.attach(fake.obj);
    fake.obj.position.set(r.x, TOP + JIG_TOP + TV_T / 2, Z_ASM + slotZ(inch, k));
    fake.obj.rotation.set(Math.PI, 0, 0);
    fake.obj.updateMatrixWorld();
    r.arm.mount.attach(fake.obj);
    r.carried = fake;
  };
  const above: Key[] = [], pick: Key[] = [], lift: Key[] = [], turn: number[] = [];
  const over: Key[] = [], seat: Key[] = [], back: Key[] = [], up: Key[] = [], high: Key[] = [];
  for (let k = 0; k < (inch <= 43 ? 2 : 1); k++) {
    r.carried = null;
    above.push(key(pickPose(r, inch, k, 0.2), k ? above[0].q : null));
    pick.push(key(pickPose(r, inch, k, 0), above[k].q));
    grab(k, pick[k].q);
    // lifted so the TV, lying flat, swings over the standing TVs of the pallets near the dock (32"/43": they come
    // one after the other)
    lift.push(key(pickPose(r, inch, k, liftDy(inch)), pick[k].q));
    over.push(key(placePose(r, inch, k, PLACE_ABOVE, 0), k ? over[0].q : lift[k].q));
    seat.push(key(placePose(r, inch, k, 0, 0), over[k].q));
    high.push(Math.sign(over[k].q[4]) === Math.sign(lift[k].q[4]) ? over[k] : key(placePose(r, inch, k, PLACE_ABOVE + 0.5, 0), over[k].q));
    // the base turn: through the downstream side (the pallets queued for the dock wait upstream; the ones that left
    // are on their way), unless only the other way is clear
    const d = angDiff(lift[k].q[0], high[k].q[0]);
    let best: { score: number; turn: number } | null = null;
    for (const tt of [d, d > 0 ? d - 2 * Math.PI : d + 2 * Math.PI]) {
      const mid = [lift[k].q[0] + tt, ...lift[k].q.slice(1)], end = [lift[k].q[0] + tt, ...near(mid, high[k].q).slice(1)];
      const clear = Math.min(pathClearance(r, lift[k].q, mid), pathClearance(r, mid, end));
      setJoints(r, [lift[k].q[0] + tt / 2, ...lift[k].q.slice(1)]);
      const downstream = r.arm.mount.getWorldPosition(new THREE.Vector3()).x > r.arm.root.position.x;
      const score = (clear < 0.02 ? 100 - clear * 100 : 0) + (downstream ? 0 : 5) + 0.1 * Math.abs(tt);
      if (!best || score < best.score) best = { score, turn: tt };
    }
    turn.push(best!.turn);
    r.carried = null;
    back.push(key(placePose(r, inch, k, 0, -0.1), seat[k].q)); // cups off the TV back
    // up until the cup bars are over the TV's top edge: the turn back passes over every TV on the test belt
    up.push(key(placePose(r, inch, k, gripOf(inch) + 0.2, -0.1), back[k].q));
  }
  scene.attach(fake.obj);
  fake.obj.parent?.remove(fake.obj);  r.carried = carried;
  setJoints(r, keep);
  const home = key(pickPose(r, inch, 0, 0.45), above[0].q);
  const p: Program = { home, above, pick, lift, turn, over, seat, back, up, high };
  programs.set(id, p);
  return p;
}
/** Joint move through `pts` (the first is where the arm is); `dur` overrides the time of a single leg. */
function startJm(r: Transfer, pts: number[][], pose: Pose, dur?: number) {
  const legs = pts.slice(1).map((q, i) => (dur != null && pts.length === 2 ? dur : jointDur(pts[i], q) - 0.2));
  r.jm = { pts, legs, t: 0, dur: (dur != null && pts.length === 2 ? 0 : 0.2) + legs.reduce((a, c) => a + c, 0) };
  r.pose = pose.slice();
}
/** Joint move to a taught point (the base keeps its winding). */
const jto = (r: Transfer, k: () => Key, dur?: number, ready = false): Step[] => [
  { fn: () => {
    const q0 = r.arm.ur!.q.slice(), t = k(), q1 = near(q0, t.q);
    q1[0] = q0[0] + angDiff(q0[0], t.q[0]);
    startJm(r, [q0, q1], t.pose, dur);
  }, ready },
  { until: () => !r.jm, ready },
];

/** Swing: the base alone turns by `turn`, then the arm settles into the taught point `k`. */
const swing = (r: Transfer, k: () => Key, turn: () => number, ready = false): Step[] => [
  { fn: () => {
    const q0 = r.arm.ur!.q.slice(), b = q0[0] + turn(), mid = [b, ...q0.slice(1)], end = near(mid, k().q);
    end[0] = b;
    startJm(r, [q0, mid, end], k().pose);
  }, ready },
  { until: () => !r.jm, ready },
];

/** Advance a joint move, or follow the Cartesian pose (MoveL). */
function driveArm(r: Transfer, dt: number, iters: number) {
  if (r.jm) {
    const m = r.jm;
    m.t += dt;
    // one ease over the whole move, shared out over the legs by their times
    let s = ease(Math.min(1, m.t / m.dur)) * m.legs.reduce((a, b) => a + b, 0), k = 0;
    while (k < m.legs.length - 1 && s > m.legs[k]) { s -= m.legs[k]; k++; }
    const u = m.legs[k] > 0 ? Math.min(1, s / m.legs[k]) : 1, a = m.pts[k], b = m.pts[k + 1];
    setJoints(r, a.map((v, i) => v + (b[i] - v) * u));
    if (m.t >= m.dur) r.jm = null;
  } else urTrack(r.arm, r.pose, iters);
}

/**
 * Pick: TV lies screen-down on the jig. Tool horizontal pointing away from the robot (tilt 90°, yaw 180°): the cups hang
 * CUP_Z below the bracket and sit HOOK_D beyond the flange, on the back cover, GRIP from the TV edge nearest the robot
 * (that edge becomes the top). A 32"/43" pair lies across the jig: the robots take the near TV first, then the far one.
 */
function pickPose(r: Transfer, inch: Inch, k: number, dy: number): Pose {
  const d = SIZES[inch][1];
  const p = poseAt(r.arm, r.x, Z_ASM + slotZ(inch, k) - (d / 2 - gripOf(inch)) - HOOK_D, PICK_Y + CUP_Z + dy);
  return [r.wrap(p[0]), p[1], p[2], H, Math.PI];
}

/**
 * Place: TV upright in the pallet, screen toward the robots. Tool pointing down behind the TV, the hook reaching over its
 * top edge to the back cover. Relative to the arm this is the pick posture with the wrist pitched by 90°: on the way
 * only the base turns and the wrist tilts. `dz` < 0 backs the cups off the TV.
 */
function placePose(r: Transfer, inch: Inch, k: number, dy: number, dz: number): Pose {
  void k;
  const cupY = TOP + SEAT_Y + SIZES[inch][1] - gripOf(inch);
  const p = poseAt(r.arm, r.x, Z_PAL - TV_BACK - CUP_Z + dz, cupY + HOOK_D + dy);
  return [p[0], p[1], p[2], 0, 0];
}


/** Wait hovering over the pick point, not at a far home. */
export const readyPose = (w: World, r: Transfer) => pickPose(r, w.params.inch, 0, 0.2); // = over the first TV: no extra move

/**
 * Move time from joint distance — collaborative speeds with up to ~30 kg on the flange (all axes move together,
 * so the slowest axis sets the time: base 105°/s, reach and height 1 m/s, wrist 130–190°/s).
 */
export const moveDur = (a: Pose, b: Pose) =>
  0.3 + Math.max(Math.abs(b[0] - a[0]) * 0.55, Math.abs(b[1] - a[1]) * 1.0, Math.abs(b[2] - a[2]) * 1.0, Math.abs((b[3] || 0) - (a[3] || 0)) * 0.45, Math.abs((b[4] || 0) - (a[4] || 0)) * 0.3);

function startJob(w: World, r: Transfer) {
  const jig = r.job!, inch = jig.inch, k = jig.tvs.findIndex(Boolean), d = SIZES[inch][1], P = programOf(r, inch);
  let base0 = 0;
  r.seq.length = 0; // drop a pending move to the ready pose (one under way is finished first)
  r.state = 'pick';
  r.seq.push(
    { until: () => !r.jm },
    // over the TV, down onto it, lift it (every move goes to a taught point, the way the program was checked)
    ...jto(r, () => P.above[k], 0.6), ...jto(r, () => P.pick[k], 0.5), { dur: 0.3 },
    { fn: () => { const tv = jig.tvs[k]!; r.arm.mount.attach(tv.obj); r.carried = tv; jig.tvs[k] = null; } },
    { toFn: () => P.lift[k].pose, dur: 0.6 }, // straight up (MoveL): the TV clears the other one of the pair
    { fn: () => {
      if (!hasTV(jig)) { jig.ledMat.emissive.setHex(0x000000); jig.hold = null; r.job = null; }
      else if (!isLastR(w, r) && modeOf(w, jig) !== 'B') { giveToLast(w, jig, tvCount(jig)); jig.hold = null; r.job = null; } // the other TV goes on to robot 2
      r.state = 'waitPallet';
    } },
    { until: () => !!r.pallet && r.pallet.hold === r.placeSt },
    { fn: () => { r.state = 'place'; base0 = r.arm.ur!.q[0]; } },
    // the base turns to the test side with the TV lying flat, the wrist stands it up over its seat; straight down
    ...swing(r, () => P.high[k], () => P.turn[k]),
    ...(P.high[k] !== P.over[k] ? jto(r, () => P.over[k], 0.6) : []),
    ...jto(r, () => P.seat[k], 0.8), { dur: 0.3 },
    { fn: () => {
      const tv = r.carried!, pal = r.pallet!;
      pal.obj.attach(tv.obj);
      tv.obj.position.set(0, SEAT_Y + d / 2, 0); // seated (its turn is the one the gripper gave it)
      pal.tvs.push(tv);
      r.carried = null;
      tvPower(tv, 'swoosh');
      w.stats.moved++;
      r.count++;
      // the pallet leaves at once; nothing else enters the dock until the plate has backed off
      r.leaving = pal; r.zoneBusy = true; pal.hold = null; r.pallet = null; r.need--;
    } },
    ...jto(r, () => P.back[k], 0.3), // the cups back off the TV
    // the hook stays behind the TV until its pallet has taken it on (the next pallet waits one slot before the dock)
    { until: () => !w.test.items.includes(r.leaving!) || r.leaving!.obj.position.x - SIZES[inch][0] / 2 > r.x + 0.35 },
    { fn: () => { r.leaving = null; r.zoneBusy = false; r.state = 'idle'; } },
    // (the return is not cut short by the next job: the arm always comes back the way it was taught)
    ...jto(r, () => P.up[k], 0.6), // up, the hook over the top of the TVs
    // back the same way round, over the jig
    ...swing(r, () => P.home, () => base0 + angDiff(P.lift[k].q[0], P.home.q[0]) - r.arm.ur!.q[0]),
  );
}
/** Lift over the jig before the swing: for the pairs, the TV's underside clears a TV of the same size standing on a pallet. */
const liftDy = (inch: Inch) => (inch <= 43 ? Math.max(0.4, TOP + SEAT_Y + SIZES[inch][1] + 0.06 - (PICK_Y - TV_T - 0.045)) : 0.4);

/** Height of the TV over its seat before it goes straight down into the pallet. */
const PLACE_ABOVE = 0.15;

export function updateRobots(w: World, dt: number) {
  for (const r of w.robots) {
    if (!r.zoneBusy) for (const it of w.test.items) if (it.hold === r.gateSt) it.hold = null; // dock clear: let the queue in
    if (!r.enabled) { // switched off: park and stay out of the flow
      runSeq(r, dt); solve(r.arm, r.pose); driveArm(r, dt, 6); r.arm.ledMat.emissive.setHex(LED.off);
      continue;
    }
    // the last robot always keeps one empty pallet docked or on its way, so it never waits for one;
    // an upstream robot never parks an empty pallet, which would block the pallets of the robot after it
    if (isLastR(w, r) && r.need === 0) r.addNeed(1);
    if (r.state === 'idle' && r.job && r.seq.every(s => s.ready)) startJob(w, r);
    runSeq(r, dt); solve(r.arm, r.pose); driveArm(r, dt, 14);
    const waiting = r.state === 'waitPallet' || r.state === 'idle';
    r.totT += dt;
    if (!waiting) r.busyT += dt;
    else if (r.state === 'waitPallet') r.palT += dt;
    r.arm.ledMat.emissive.setHex(waiting ? LED.wait : LED.run);
  }
}

/**
 * Pallet dispatch with priority to Transfer 1: its pallets go first, and Transfer 2 never has more than two
 * empty pallets on their way, so its queue rarely backs up onto Transfer 1's station.
 */
export function dispatchPallets(w: World) {
  const [r1, r2] = w.robots;
  const unmet = (r: Transfer) => (r.enabled ? r.need - (r.pallet ? 1 : 0) : 0);
  const inTransit = () => w.test.items.filter(it => it.released && !it.tvs.length && !w.robots.some(r => r.pallet === it)).length;
  while (w.palletBuffer.length) {
    const t = inTransit();
    const want = Math.max(0, unmet(r1)) + Math.min(2, Math.max(0, unmet(r2)));
    if (t >= want) break;
    const p = w.palletBuffer.shift()!;
    p.released = true;
    p.hold = null;
  }
}

/** Put a robot back to its waiting pose with nothing in hand (line restart): straight into the taught posture. */
export function resetTransfer(w: World, r: Transfer) {
  if (r.carried) { r.carried.obj.parent?.remove(r.carried.obj); r.carried = null; }
  Object.assign(r, { seq: [], state: 'idle', job: null, pallet: null, need: 0, leaving: null, zoneBusy: false, jm: null });
  if (!r.arm.ur) return;
  const k = r.enabled ? programOf(r, w.params.inch).home : { q: teach(r, r.home, null), pose: r.home };
  setJoints(r, k.q);
  r.pose = k.pose.slice();
}
/**
 * Clearance of every leg of the taught program (with a stand-in TV on the legs that carry one), robot by robot and
 * slot by slot: the smallest gap along each leg and between what. For the bench and the tests.
 */
export function programReport(w: World): string[] {
  const t0 = performance.now(), out: string[] = [];
  const inch = w.params.inch;
  w.robots.forEach((r, ri) => {
    const P = programOf(r, inch), ur = r.arm.ur!, keep = ur.q.slice(), carried = r.carried;
    const scene = r.arm.root.parent!, fake = { obj: new THREE.Group(), inch, screen: null as unknown as THREE.Mesh };
    scene.add(fake.obj);
    const leg = (name: string, a: number[], b: number[]) => out.push(`T${ri + 1} ${name}: ${(pathClearance(r, a, b) * 1000).toFixed(0)} mm — ${worstWhat}`);
    P.lift.forEach((_, k) => {
      const s = `[TV ${k + 1}]`;
      r.carried = null;
      leg(`${s} espera no alto → sobre a TV`, P.home.q, near(P.home.q, P.above[k].q));
      leg(`${s} sobre → pega`, P.above[k].q, P.pick[k].q);
      setJoints(r, P.pick[k].q);
      r.arm.mount.updateWorldMatrix(true, false);
      scene.attach(fake.obj);
      fake.obj.position.set(r.x, TOP + JIG_TOP + TV_T / 2, Z_ASM + slotZ(inch, k));
      fake.obj.rotation.set(Math.PI, 0, 0);
      fake.obj.updateMatrixWorld();
      r.arm.mount.attach(fake.obj);
      r.carried = fake;
      leg(`${s} pega → sobe (com TV)`, P.pick[k].q, P.lift[k].q);
      const b = P.lift[k].q[0] + P.turn[k], mid = [b, ...P.lift[k].q.slice(1)], high = [b, ...near(mid, P.high[k].q).slice(1)];
      const over = [b, ...near(high, P.over[k].q).slice(1)];
      leg(`${s} giro da base (com TV)`, P.lift[k].q, mid);
      if (P.high[k] !== P.over[k]) { leg(`${s} punho troca no alto (com TV)`, mid, high); leg(`${s} desce sobre o suporte (com TV)`, high, over); }
      const deg = (i: number) => Math.round(Math.abs(over[i] - P.lift[k].q[i]) * 180 / Math.PI);
      out.push(`T${ri + 1} ${s} juntas da pega à colocação: base ${deg(0)}°, ombro ${deg(1)}°, cotovelo ${deg(2)}°, punho 1 ${deg(3)}°, punho 2 ${deg(4)}°, punho 3 ${deg(5)}°`);
      if (P.high[k] === P.over[k]) leg(`${s} punho põe de pé (com TV)`, mid, over);
      const seat = [b, ...near(over, P.seat[k].q).slice(1)];
      leg(`${s} desce no suporte (com TV)`, over, seat);
      leg(`${s} ponto: no suporte (com TV)`, seat, seat);
      leg(`${s} ponto: sobre o suporte (com TV)`, over, over);
      r.carried = null;
      scene.attach(fake.obj);
      const back = [b, ...near(seat, P.back[k].q).slice(1)], up = [b, ...near(back, P.up[k].q).slice(1)];
      leg(`${s} recua`, seat, back);
      leg(`${s} sobe`, back, up);
      const b0 = P.lift[k].q[0] + angDiff(P.lift[k].q[0], P.home.q[0]);
      const mid2 = [b0, ...up.slice(1)], home = [b0, ...near(mid2, P.home.q).slice(1)];
      leg(`${s} volta: giro da base`, up, mid2);
      leg(`${s} volta: assenta alto sobre o gabarito`, mid2, home);
      leg(`${s} desce para a próxima pega`, home, near(home, P.above[0].q));
    });
    fake.obj.parent?.remove(fake.obj);
    r.carried = carried;
    setJoints(r, keep);
  });
  out.push(`(relatório em ${Math.round(performance.now() - t0)} ms)`);
  return out;
}