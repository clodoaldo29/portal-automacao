// Transfer 1 and Transfer 2 (UR30 with the hook gripper): take TVs from the assembly jigs and stand them,
// screen toward the robots, on the test pallets.
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
import { capsuleBoxGap, linkCapsules, obstacleBox, type Obstacle } from '../../sim/robots/collision';
import { LED, makeCobot, poseAt, solve, urTrack } from '../../sim/robots/ur-arm';
import { urFK } from '../../sim/robots/ur-kinematics';
import { runSeq, type Pose, type Step } from '../../sim/sequencer';
import {
  BELT_ASM, BELT_TEST, CUP_Z, HOOK_D, gripOf, ITEM_GAP, JIG_L, JIG_TOP, JIG_W, LINE_X0, LINE_X1, PAL_W, PICK_Y, ROBOT_X1, ROBOT_X2, ROBOT_Z, SEAT_Y, SIZES, TOP,
  TRANSFER_PED, TV_BACK, TV_T,
  Z_ASM, Z_PAL, Z_TEST, slotZ, type Inch,
} from './config';
import { tvPower } from './products';
import type { Jig, Mode, Pallet, Transfer, World } from './types';

const H = Math.PI / 2;

export const hasTV = (it: Jig | Pallet) => !!it.tvs && it.tvs.some(Boolean);
export const tvCount = (it: Jig) => it.tvs.filter(Boolean).length;

/** 'auto': pair jigs (32"/43") → 'B' (jigs alternate, each robot empties its own); single-TV jigs → 'free'. */
export const modeOf = (w: World, it: Jig): Exclude<Mode, 'auto'> => (w.params.mode === 'auto' ? (it.tvs.length === 2 ? 'B' : 'free') : w.params.mode);

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
  // slim 1.5 m column: the UR30 shoulder sits ~1.74 m high, enough to lower a 75" from above and still pick at the belt
  const arm = makeCobot(w.scene, w.M, { x, z: ROBOT_Z, L1: 0.64, L2: 0.5, ped: TRANSFER_PED, pedW: 0.3 });
  hookGripper(arm.mount, w.M, { hookD: HOOK_D, cupZ: CUP_Z });
  arm.tool.rotation.order = 'YXZ';
  w.floorRect(x - 0.4, ROBOT_Z - 0.4, x + 0.4, ROBOT_Z + 0.4, 0.04);
  const home: Pose = [phi.home, 0.55, -0.45, H, Math.PI];
  const r: Transfer = {
    arm, x, D: HOOK_D, wrap: p => (phi.wrapPositive && p < 0 ? p + 2 * Math.PI : p),
    enabled: true, count: 0, seq: [], state: 'idle', job: null, pallet: null, need: 0, carried: null, leaving: null, zoneBusy: false,
    busyT: 0, totT: 0, palT: 0, home, pose: home.slice(), jm: null,
    // fixed things a move is planned against, besides the belts and the jig: the lift units at the belt ends and the
    // other transfer's pedestal
    env: [
      ...[[LINE_X0, Z_ASM], [LINE_X1, Z_ASM], [w.testX0, Z_TEST], [LINE_X1, Z_TEST]].map(([lx, lz], i) =>
        obstacleBox('elevador', lx + (i % 2 ? 0.15 : -0.15), 1.2, lz, 2.6 + 0.1, 2.4, 1.7 + 0.1)),
      ...[ROBOT_X1, ROBOT_X2].filter(px => Math.abs(px - x) > 0.5).map(px => obstacleBox('pedestal do outro transfer', px, TRANSFER_PED / 2, ROBOT_Z, 0.36, TRANSFER_PED, 0.36)),
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
  // interlock: while the hook is still behind the TV plane, the next pallet waits one slot before the dock
  r.gateSt = station(test, test.track.sAtX(0, x) - (PAL_W + ITEM_GAP) + 0.02, it => !!r.zoneBusy && it !== r.leaving, () => {});
  r.placeSt = station(test, test.track.sAtX(0, x), it => {
    if (r.enabled && it.released && !it.tvs.length && r.need > 0 && !r.pallet) { r.pallet = it; return true; }
    return false;
  }, () => {});
  return r;
}

/**
 * Via point of every swing: arm pointing downstream, flange high and 0.8 m out, tool horizontal — a TV in the hook
 * stays lying flat and away from the robot's own body while the base turns.
 */
const viaPose = (r: Transfer): Pose => [0, 0.6, 2.45 - r.arm.shoulderY, H, 1.5 * Math.PI];

// ---------- joint moves (MoveJ), elbow up ----------
// The big moves run in joint space, like a real robot's MoveJ, always in the ELBOW-UP posture: the arm stays above the
// TV it carries and away from its own pedestal. Only the short approaches (down to the TV, into the pallet, back off)
// are straight-line moves (MoveL), which keep the posture they start from.

/**
 * The equivalent of joint angle q1 nearest q0, within the UR joint range: ±360° for every joint, ±180° for the elbow
 * (it cannot turn through itself).
 */
const wrapTo = (q0: number, q1: number, i = 0) => {
  if (i === 2) return Math.atan2(Math.sin(q1), Math.cos(q1));
  let q = q0 + Math.atan2(Math.sin(q1 - q0), Math.cos(q1 - q0));
  if (q > 2 * Math.PI) q -= 2 * Math.PI;
  if (q < -2 * Math.PI) q += 2 * Math.PI;
  return q;
};
const elbowY = (r: Transfer, q: number[]) => urFK(r.arm.ur!, q, 3).elements[13];
function setJoints(r: Transfer, q: number[]) {
  const ur = r.arm.ur!;
  ur.q = q.slice();
  ur.joints.forEach((j, i) => { j.rotation.z = q[i]; });
}

/**
 * Clearance of the robot with itself in joints `q`: its arm (from the upper arm on) and its pedestal against the TV
 * it carries, and the arm against its own pedestal. (Everything else is checked by the cell's collision bench.)
 */
function selfClearance(r: Transfer, q: number[]): number {
  setJoints(r, q);
  const caps = linkCapsules(r.arm, 0.015), b = r.arm.root.position;
  const ped: Obstacle = obstacleBox('pedestal', b.x, TRANSFER_PED / 2, b.z, 0.36, TRANSFER_PED, 0.36);
  let min = Infinity;
  for (const c of caps) if (c.link >= 2) min = Math.min(min, capsuleBoxGap(c, ped));
  // the fixed things around: both belts (up to the roller top) and the jig foam at this robot's pick stop; the arm
  // and the gripper must clear them (the cups only touch the TV)
  // the TVs lying on the jig at this robot's stop (the cups touch the one being picked; the bracket and bars may not)
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
  const grip = [{ a: W(0, -0.04, 0), b: W(0, -HOOK_D + 0.02, 0), r: 0.05 }, { a: W(-0.28, -HOOK_D, 0.035), b: W(0.28, -HOOK_D, 0.035), r: 0.04 },
    ...[-0.25, 0.25].map(sx => ({ a: W(sx, -HOOK_D - 0.14, 0.035), b: W(sx, -HOOK_D + 0.14, 0.035), r: 0.035 }))];
  for (const o of env) {
    for (const c of caps) if (c.link >= 2) min = Math.min(min, capsuleBoxGap(c, o));
    for (const g of grip) min = Math.min(min, capsuleBoxGap(g, o));
  }
  for (const g of grip) min = Math.min(min, capsuleBoxGap(g, ped), capsuleBoxGap(g, tvSlab));
  // the cup stems: not against the TVs (the cups sit on one), against everything else
  for (const sx of [-0.25, 0.25]) for (const sy of [-0.12, 0.12]) {
    const s = { a: W(sx, -HOOK_D + sy, 0.05), b: W(sx, -HOOK_D + sy, CUP_Z - 0.03), r: 0.025 };
    for (const o of [...env, ped]) min = Math.min(min, capsuleBoxGap(s, o));
  }
  for (const c of caps) if (c.link >= 2) min = Math.min(min, capsuleBoxGap(c, tvSlab));
  const tv = r.carried;
  if (tv) {
    tv.obj.updateWorldMatrix(true, false);
    const [w, d] = SIZES[tv.inch];
    const o: Obstacle = { name: 'TV', box: new THREE.Box3(new THREE.Vector3(-w / 2, -TV_T / 2 - 0.045, -d / 2), new THREE.Vector3(w / 2, TV_T / 2, d / 2)), inv: tv.obj.matrixWorld.clone().invert() };
    for (const c of caps) if (c.link <= 5) min = Math.min(min, capsuleBoxGap(c, o));
    // the TV against the pedestal, the lift units and the other pedestal: its corners and edges
    const box = o.box, M = tv.obj.matrixWorld, p = new THREE.Vector3();
    for (let i = 0; i <= 4; i++) for (let k = 0; k <= 4; k++) for (const y of [box.min.y, box.max.y]) {
      p.set(box.min.x + (box.max.x - box.min.x) * i / 4, y, box.min.z + (box.max.z - box.min.z) * k / 4).applyMatrix4(M);
      for (const e of [ped, ...r.env]) min = Math.min(min, e.box.containsPoint(p) ? -0.01 : e.box.distanceToPoint(p));
    }
  }
  return min;
}

/** Smallest self-clearance along the straight joint path q0 → q1 (and at q1). */
function pathClearance(r: Transfer, q0: number[], q1: number[]) {
  let min = Infinity;
  for (let k = 1; k <= 10; k++) { const u = k / 10; min = Math.min(min, selfClearance(r, q0.map((v, i) => v + (q1[i] - v) * u))); }
  return min;
}

/**
 * Joints for `pose`: among the IK solutions (many seeds), the one whose joint path from here keeps the arm, the TV it
 * carries and the pedestal apart, preferring the elbow up and the shortest move.
 */
const planCache = new Map<string, number[]>();
function ikElbowUp(r: Transfer, pose: Pose): number[] {
  const ur = r.arm.ur!, cur = ur.q.slice(), sh = r.arm.shoulderY;
  // the cycle repeats: the same move from the same joints is planned once
  const key = [r.x, r.carried?.inch ?? 0, ...pose.map(v => v.toFixed(3)), ...cur.map(v => v.toFixed(2))].join();
  const hit = planCache.get(key);
  if (hit) return hit.slice();
  const q = planIk(r, pose, cur, sh);
  if (planCache.size > 4000) planCache.clear();
  planCache.set(key, q);
  return q.slice();
}

function planIk(r: Transfer, pose: Pose, cur: number[], sh: number): number[] {
  const ur = r.arm.ur!;
  // the posture it is in already, when it reaches the pose with the elbow up and a clear path
  ur.q = cur.slice();
  if (urTrack(r.arm, pose, 140) < 0.004) {
    const q = ur.q.map((v, i) => wrapTo(cur[i], v, i));
    if (elbowY(r, q) - sh > 0.1 && pathClearance(r, cur, q) > 0.03) { setJoints(r, cur); return q; }
  }
  const seeds = [cur];
  for (const q0 of [cur[0], cur[0] + Math.PI / 2, cur[0] - Math.PI / 2]) for (const q1 of [-0.9, -1.6, -2.3]) for (const q2 of [-2.2, -1.2, 1.2, 2.2]) for (const q3 of [-2.2, -0.8, 0.8]) for (const q4 of [-1.57, 1.57]) {
    seeds.push([q0, q1, q2, q3, q4, cur[5]]);
  }
  const cands: { score: number; q: number[] }[] = [];
  for (const s of seeds) {
    ur.q = s.slice();
    let err = urTrack(r.arm, pose, 60);
    if (err > 0.02) continue;
    err = urTrack(r.arm, pose, 80);
    if (err > 0.004) continue;
    const q = ur.q.map((v, i) => wrapTo(cur[i], v, i)), up = elbowY(r, q) - sh;
    if (cands.some(c => c.q.every((v, i) => Math.abs(v - q[i]) < 0.05))) continue; // same solution
    const dist = q.reduce((a, v, i) => a + Math.abs(v - cur[i]) * (i < 3 ? 1 : 0.5), 0);
    cands.push({ score: (up < 0.05 ? 2 : 0) - Math.min(up, 0.5) + 0.12 * dist, q });
  }
  cands.sort((a, b) => a.score - b.score);
  let best: { score: number; q: number[] } | null = null;
  for (const c of cands.slice(0, 12)) {
    const clear = pathClearance(r, cur, c.q);
    const score = c.score + (clear < 0.02 ? 50 + (0.02 - clear) * 100 : 0);
    if (!best || score < best.score) best = { score, q: c.q };
  }
  setJoints(r, cur);
  return (best ?? { q: cur }).q;
}

/** Joint move time: big joints ~115°/s, wrist ~170°/s with the TV on the flange (UR30: 120°/s and 210°/s), plus settling. */
const jointDur = (a: number[], b: number[]) => {
  let big = 0, small = 0;
  a.forEach((v, i) => { const d = Math.abs(b[i] - v); if (i < 3) big = Math.max(big, d); else small = Math.max(small, d); });
  return 0.2 + Math.max(big / 2.0, small / 3.0);
};

/** The same posture with every joint inside its range (the Cartesian moves can wind the joints past it). */
const normJoints = (q: number[]) => q.map((v, i) => wrapTo(0, v, i));

/**
 * Joint path to `pose`: straight in joint space when that is clear; otherwise through one intermediate posture (the
 * high via point, the arm raised where it is, or the wrist turned first), the one that keeps the most clearance.
 */
const pathCache = new Map<string, number[][]>();
function planPath(r: Transfer, pose: Pose): number[][] {
  const q0 = r.arm.ur!.q.slice();
  const key = [r.x, r.carried?.inch ?? 0, ...pose.map(v => v.toFixed(3)), ...q0.map(v => v.toFixed(2))].join();
  const hit = pathCache.get(key);
  if (hit) return hit.map(q => q.slice());
  const q1 = ikElbowUp(r, pose);
  let best = { clear: pathClearance(r, q0, q1), path: [q1] };
  if (best.clear < 0.02) {
    setJoints(r, q0);
    const mids = [ikElbowUp(r, viaPose(r)), [q0[0], -1.75, 1.9, q0[3], q0[4], q0[5]], [q0[0], q0[1], q0[2], q1[3], q1[4], q1[5]],
      [(q0[0] + q1[0]) / 2, -1.75, 1.9, (q0[3] + q1[3]) / 2, q0[4], q0[5]]];
    for (const m of mids) {
      const c = Math.min(pathClearance(r, q0, m), pathClearance(r, m, q1));
      if (c > best.clear) best = { clear: c, path: [m, q1] };
    }
  }
  setJoints(r, q0);
  if (pathCache.size > 4000) pathCache.clear();
  pathCache.set(key, best.path);
  return best.path.map(q => q.slice());
}

/**
 * MoveJ through `poseFns()` in turn (steps for the sequencer): each leg planned from where the previous one ends, and
 * the legs blended into one move, like the blend radius of a UR program: the arm does not stop at the via points (the
 * joint path is the same polyline that was checked for clearance).
 */
const moveJ = (r: Transfer, poseFns: (() => Pose) | (() => Pose)[], ready = false): Step[] => [
  { fn: () => {
    const q0 = normJoints(r.arm.ur!.q), pts = [q0];
    setJoints(r, q0);
    let pose: Pose = r.pose;
    for (const f of Array.isArray(poseFns) ? poseFns : [poseFns]) {
      pose = f();
      for (const q of planPath(r, pose)) { pts.push(q); setJoints(r, q); }
    }
    setJoints(r, q0);
    const legs = pts.slice(1).map((q, i) => jointDur(pts[i], q) - 0.2);
    r.jm = { pts, legs, t: 0, dur: 0.2 + legs.reduce((a, b) => a + b, 0) };
    r.pose = pose.slice();
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
 * Pick: TV lies screen-down on the jig. Tool horizontal (tilt 90°, yaw 180°): the cups hang CUP_Z below the flange
 * and sit D beyond it, on the back cover, GRIP from the TV edge nearest the robot (that edge becomes the top).
 * A 32"/43" pair lies across the jig: the robots take the near TV first, then the far one over the empty seat.
 */
function pickPose(r: Transfer, inch: Inch, k: number, dy: number): Pose {
  const d = SIZES[inch][1];
  const p = poseAt(r.arm, r.x, Z_ASM + slotZ(inch, k) - (d / 2 - gripOf(inch)) - r.D, PICK_Y + CUP_Z + dy);
  return [r.wrap(p[0]), p[1], p[2], H, Math.PI];
}

/** Place: TV upright in the pallet, screen toward the robots (+z). Tool pointing down behind the TV. */
function placePose(r: Transfer, inch: Inch, dy: number, dz: number): Pose {
  const d = SIZES[inch][1], cupY = TOP + SEAT_Y + d - gripOf(inch);
  const p = poseAt(r.arm, r.x, Z_PAL - TV_BACK - CUP_Z + dz, cupY + r.D + dy);
  // The tool must end facing the same world direction (yaw 0 ≡ 2π). Pick the equivalent that keeps the
  // tool's yaw relative to the arm what it was at the pick, so the base swing does the turning and the
  // wrist does not add a full 360° spin.
  const relPick = Math.PI - pickPose(r, 50, 0, 0)[0];
  const yaw = [0, 2 * Math.PI, -2 * Math.PI].reduce((best, y) => (Math.abs(y - p[0] - relPick) < Math.abs(best - p[0] - relPick) ? y : best));
  return [p[0], p[1], p[2], 0, yaw];
}

/**
 * Carry: on the test side, the TV still lying flat (tool horizontal, pointing away from the robot), its cups right
 * over the place where they will be with the TV upright, PLACE_ABOVE + 0.1 higher. From here the TV is stood up by
 * turning the tool about the cup row: its far part swings down, away from the robot.
 */
function carryPose(r: Transfer, inch: Inch): Pose {
  const d = SIZES[inch][1], cupY = TOP + SEAT_Y + d - gripOf(inch);
  const p = poseAt(r.arm, r.x, Z_PAL - TV_BACK + r.D, cupY + PLACE_ABOVE + 0.1 + CUP_Z);
  return [p[0], p[1], p[2], H, 0];
}

/** Wait hovering over the pick point, not at a far home. */
export const readyPose = (w: World, r: Transfer) => pickPose(r, w.params.inch, 0, 0.25);

/**
 * Move time from joint distance — collaborative speeds with up to ~30 kg on the flange (all axes move together,
 * so the slowest axis sets the time: base 105°/s, reach and height 1 m/s, wrist 130–190°/s).
 */
export const moveDur = (a: Pose, b: Pose) =>
  0.3 + Math.max(Math.abs(b[0] - a[0]) * 0.55, Math.abs(b[1] - a[1]) * 1.0, Math.abs(b[2] - a[2]) * 1.0, Math.abs((b[3] || 0) - (a[3] || 0)) * 0.45, Math.abs((b[4] || 0) - (a[4] || 0)) * 0.3);

function startJob(w: World, r: Transfer) {
  const jig = r.job!, inch = jig.inch, k = jig.tvs.findIndex(Boolean), d = SIZES[inch][1];
  r.seq.length = 0; // drop a pending move to the ready pose (one under way is finished: it was planned clear)
  r.state = 'pick';
  r.seq.push(
    { until: () => !r.jm },
    // over the TV, then down to it (planned too: the wrist must clear the jig at the pick)
    ...moveJ(r, () => pickPose(r, inch, k, 0.2)), ...moveJ(r, () => pickPose(r, inch, k, 0)), { dur: 0.3 },
    { fn: () => { const tv = jig.tvs[k]!; r.arm.mount.attach(tv.obj); r.carried = tv; jig.tvs[k] = null; } },
    { toFn: () => pickPose(r, inch, k, 0.4), dur: 0.6 },
    { fn: () => {
      if (!hasTV(jig)) { jig.ledMat.emissive.setHex(0x000000); jig.hold = null; r.job = null; }
      else if (!isLastR(w, r) && modeOf(w, jig) !== 'B') { giveToLast(w, jig, tvCount(jig)); jig.hold = null; r.job = null; } // the other TV goes on to robot 2
      r.state = 'waitPallet';
    } },
    { until: () => !!r.pallet && r.pallet.hold === r.placeSt },
    { fn: () => { r.state = 'place'; } },
    // one blended move: downstream and high with the TV lying flat and away from the robot; to the test side, still
    // flat, cups over their place; stood up right above its seat (never toward the pedestal)
    ...moveJ(r, [() => viaPose(r), () => carryPose(r, inch), () => placePose(r, inch, PLACE_ABOVE, 0)]),
    { toFn: () => placePose(r, inch, 0, 0), dur: 0.8 }, { dur: 0.3 }, // straight down into the groove, between the side guides
    { fn: () => {
      const tv = r.carried!, pal = r.pallet!;
      pal.obj.attach(tv.obj);
      tv.obj.position.set(0, SEAT_Y + d / 2, 0);
      tv.obj.rotation.set(-Math.PI / 2, 0, Math.PI);
      pal.tvs.push(tv);
      r.carried = null;
      tvPower(tv, 'swoosh');
      w.stats.moved++;
      r.count++;
      // the pallet leaves at once and carries the TV away from the hook; nothing else may enter the dock meanwhile
      r.leaving = pal; r.zoneBusy = true; pal.hold = null; r.pallet = null; r.need--;
    } },
    { toFn: () => placePose(r, inch, 0, -0.1), dur: 0.3 }, // cups back off the TV
    { until: () => !w.test.items.includes(r.leaving!) || r.leaving!.obj.position.x - SIZES[inch][0] / 2 > r.x + 0.35 },
    { fn: () => { r.state = 'return'; } },
    ...moveJ(r, () => viaPose(r)), // hook back to the front, now that the TV has gone
    { fn: () => { r.zoneBusy = false; r.leaving = null; r.state = 'idle'; } },
    ...moveJ(r, () => readyPose(w, r), true),
  );
}

/** Height of the TV over its seat before it goes straight down into the pallet. */
const PLACE_ABOVE = 0.3;

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

/** Put a robot back to its waiting pose with nothing in hand (line restart). */
export function resetTransfer(w: World, r: Transfer) {
  if (r.carried) { r.carried.obj.parent?.remove(r.carried.obj); r.carried = null; }
  Object.assign(r, { seq: [], state: 'idle', job: null, pallet: null, need: 0, leaving: null, zoneBusy: false, jm: null });
  r.seq.push(...moveJ(r, () => (r.enabled ? readyPose(w, r) : r.home), true));
}
