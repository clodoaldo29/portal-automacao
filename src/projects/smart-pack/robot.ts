// Station 1: JAKA Zu 50 with the OnRobot VGP30 straight on the flange. The TV stands in the test pallet as on the
// Transfer Flow test belt, its back toward this robot: the plate takes the middle of the back, lifts the TV out of the
// pallet; on the way to the bagging belt the base turns and the wrist turns the TV over (half a turn about the tool axis)
// while it still stands, clear of the arm; then the tool goes from horizontal to pointing down and the TV lies
// screen-down as on the assembly belt: width along the line, top edge toward the robot, label (bottom) on the far side.
import * as THREE from 'three';
import { station } from '../../sim/line';
import { capsuleGap, linkCapsules } from '../../sim/robots/collision';
import { vgp30Direct } from '../../sim/robots/grippers';
import { LED, makeCobot, poseAt, upgradeArm, type Cobot } from '../../sim/robots/ur-arm';
import { ZU50, urIK } from '../../sim/robots/ur-kinematics';
import { runSeq, type Pose } from '../../sim/sequencer';
import { elbowLift } from '../transfer-flow/transfers';
import type { Transfer } from '../transfer-flow/types';
import { DROP_X, GRIP_D, LYING_Y, PAL_W, PICK_X, ROBOT, SEAT_Y, SIZES, TV_BACK, Y_PACK, Y_TEST, Z_EDGE, Z_PACK, Z_TEST } from './config';
import { TV_LYING, makeBag } from './products';
import type { PackItem, Robot, World } from './types';

const H = Math.PI / 2;

// ---------- following the pose ----------
// The pose is [φ, reach, height over the shoulder, tool tilt, tool yaw, tool roll]: the shared pose plus a roll about the
// tool axis (wrist 3), which turns the TV over while it still stands, away from the arm.
const _tp = new THREE.Vector3(), _tq = new THREE.Quaternion(), _qa = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);
const TOOL0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)); // gripper frame → tool0 axes
function solveTo(arm: Cobot, [phi, r, yRel, tilt, yaw, roll = 0]: Pose, iters: number) {
  const ur = arm.ur!, b = arm.root.position;
  _tp.set(b.x + r * Math.cos(phi), arm.shoulderY + yRel, b.z - r * Math.sin(phi));
  _tq.setFromAxisAngle(AY, yaw).multiply(_qa.setFromAxisAngle(AX, tilt)).multiply(_qa.setFromAxisAngle(AY, roll)).multiply(TOOL0);
  const err = urIK(ur, _tp, _tq, iters);
  ur.joints.forEach((j, i) => { j.rotation.z = ur.q[i]; });
  return err;
}
/** Smallest gap between links of the arm that are not neighbours (negative: the wrist folded onto the forearm …). */
function selfGap(arm: Cobot) {
  const caps = linkCapsules(arm, 0);
  let min = Infinity;
  for (const s of caps) for (const t of caps) if (t.link - s.link >= 3) min = Math.min(min, capsuleGap(s, t));
  return min;
}
const lift = (arm: Cobot) => elbowLift({ arm } as unknown as Transfer);
const cooldown = new WeakMap<Robot, number>();
/**
 * Follow the pose with the elbow up and the arm clear of itself, as the Transfer Flow transfers do (the same rule, for a
 * pose with roll): when the elbow goes down, the arm is stuck stretched, or the wrist folds onto the arm, the joints are
 * solved again from elbow-up postures and the best one is kept.
 */
function track(r: Robot, iters: number) {
  const ur = r.arm.ur!;
  const err = solveTo(r.arm, r.pose, iters);
  const cd = cooldown.get(r) ?? 0;
  if (cd > 0) { cooldown.set(r, cd - 1); return err; }
  const wrap = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
  const stuck = err > 0.01 && Math.abs(wrap(ur.q[2])) < 0.15;
  if (lift(r.arm) >= 0 && !stuck && selfGap(r.arm) > 0.015) return err;
  cooldown.set(r, 15);
  const keep = ur.q.slice(), [, a, b, c] = keep;
  const arms: number[][] = [[keep[0], a + b, -b, c + b], [keep[0], a, -b, c], [keep[0], -1.2, 1.6, c], [keep[0], -1.8, 1.0, c]];
  const seeds = [keep, ...arms.flatMap(([q0, q1, q2, q3]) => [[q0, q1, q2, q3, keep[4], keep[5]], [q0, q1, q2, q3 + Math.PI, -keep[4], keep[5] + Math.PI]])];
  let best: { score: number; q: number[]; err: number } | null = null;
  for (const s of seeds) {
    ur.q = s.slice();
    const e = solveTo(r.arm, r.pose, 60), l = lift(r.arm);
    if (e > 0.003 || l < 0.05) continue;
    const gap = selfGap(r.arm);
    if (gap < 0.015) continue;
    const wrist = [3, 4, 5].reduce((acc, j) => acc + Math.abs(wrap(ur.q[j] - keep[j])), 0);
    const score = Math.min(gap, 0.05) * 20 + l - 0.3 * wrist;
    if (!best || score > best.score) best = { score, q: ur.q.slice(), err: e };
  }
  ur.q = best ? best.q.map((v, j) => (j === 0 ? v : keep[j] + wrap(v - keep[j]))) : keep;
  ur.joints.forEach((j, i) => { j.rotation.z = ur.q[i]; });
  return best ? best.err : err;
}

export function createRobot(w: World): Robot {
  const arm = makeCobot(w.scene, w.M, { x: ROBOT.x, z: ROBOT.z, L1: 0.64, L2: 0.5, ped: ROBOT.ped, pedW: 0.3 });
  vgp30Direct(arm.mount, w.M, { d: GRIP_D });
  arm.tool.rotation.order = 'YXZ';
  const r = { arm, seq: [], pose: [], state: 'idle', pallet: null, carried: null, lastPallet: null, lastPlaced: null, busyT: 0, maxErr: 0 } as unknown as Robot;
  r.pose = readyPose(w, r);
  upgradeArm(w.scene, arm, r.pose, ZU50);
  // interlock: while the plate is not back on the robot side of the pick point, the next pallet waits one slot before it
  r.gate = station(w.test, w.test.track.sAtX(0, PICK_X) - (PAL_W + 0.1) + 0.02, it => !!it.tv && !plateClear(r), () => {});
  station(w.test, w.test.track.sAtX(0, PICK_X), it => !!it.tv, it => { r.pallet = it; });
  return r;
}

/** Plate on the middle of the TV's back in the test pallet, tool horizontal toward the TV (+z); dz backs off, dy lifts. */
function pickPose(w: World, r: Robot, dy: number, dz: number): Pose {
  const h = SIZES[w.params.inch][1];
  const p = poseAt(r.arm, PICK_X, Z_TEST - TV_BACK - GRIP_D - dz, Y_TEST + SEAT_Y + h / 2 + dy);
  return [p[0], p[1], p[2], -H, 0, 0];
}
/** Centre of the TV lying on the infeed: its bottom edge on the line Z_EDGE (far side), whatever the size. */
export const lyingZ = (w: World) => Z_EDGE + SIZES[w.params.inch][1] / 2;
/** Plate on the TV lying on the infeed, tool pointing down (yaw π with the roll π: the TV's heading as at the pick). */
function placePose(w: World, r: Robot, dy: number): Pose {
  const p = poseAt(r.arm, DROP_X, lyingZ(w), Y_PACK + LYING_Y + TV_BACK + GRIP_D + dy);
  return [p[0], p[1], p[2], 0, Math.PI, Math.PI];
}
/** Half way: the arm toward the bagger side (+x), high, the tool still horizontal and the TV turned over (upside down). */
const viaPose = (r: Robot): Pose => [0, 1.05, 2.3 - r.arm.shoulderY, -H, H, Math.PI];
/** Waiting: 30 cm in front of the pick point and a little higher; the next TV comes in beyond the plate. */
export const readyPose = (w: World, r: Robot): Pose => pickPose(w, r, 0.1, 0.3);

/** Joint-speed move time (collaborative speeds with a TV on the flange; the slowest axis sets the time). */
const moveDur = (a: Pose, b: Pose) =>
  0.3 + Math.max(Math.abs(b[0] - a[0]) * 0.6, Math.abs(b[1] - a[1]) * 1.1, Math.abs(b[2] - a[2]) * 1.1, Math.abs(b[3] - a[3]) * 0.5, Math.abs(b[4] - a[4]) * 0.35, Math.abs((b[5] ?? 0) - (a[5] ?? 0)) * 0.35);

/** The drop zone on the infeed is clear (the TV set before has moved at least one pitch on). */
export const dropFree = (w: World) => {
  const s = w.pack.track.sAtX(0, DROP_X);
  return !w.pack.items.some(it => it.s < s + w.pack.gap);
};

function startJob(w: World, r: Robot) {
  const pal = r.pallet!, inch = w.params.inch;
  const slow = inch >= 65 ? 1.3 : 1, slowDur = (a: Pose, b: Pose) => moveDur(a, b) * slow;
  r.state = 'busy';
  r.seq.length = 0;
  r.seq.push(
    { toFn: () => pickPose(w, r, 0, 0.12), durFn: moveDur },
    { toFn: () => pickPose(w, r, 0, 0), dur: 0.5 },
    { dur: 0.35 }, // vacuum builds up; the VGP30 sensor confirms the grip
    { fn: () => { const tv = pal.tv!; r.arm.mount.attach(tv.obj); r.carried = tv; pal.tv = null; r.lastPallet = pal; } },
    { toFn: () => pickPose(w, r, 0.45, 0), dur: 0.8 * slow }, // straight up, out of the side guides
    { fn: () => { pal.hold = null; r.pallet = null; } }, // the empty pallet goes on to the return lift
    { toFn: () => viaPose(r), durFn: slowDur },
    { toFn: () => placePose(w, r, 0.3), durFn: slowDur },
    { until: () => dropFree(w) },
    { toFn: () => placePose(w, r, 0), dur: 0.7 * slow },
    { dur: 0.25 },
    { fn: () => release(w, r) },
    { toFn: () => placePose(w, r, 0.3), dur: 0.5 },
    { fn: () => { r.state = 'idle'; r.lastPlaced = null; } },
    { toFn: () => viaPose(r), durFn: moveDur, ready: true },
    { toFn: () => readyPose(w, r), durFn: moveDur, ready: true },
  );
}

/** Let go of the TV on the infeed: it becomes an item of the packing line, with its (empty) bag ready. */
function release(w: World, r: Robot) {
  const tv = r.carried!;
  const obj = new THREE.Group();
  w.scene.add(obj);
  const s = w.pack.track.sAtX(0, DROP_X), p = w.pack.track.at(s);
  obj.position.set(p.x, w.pack.y, p.z);
  obj.updateMatrixWorld(true);
  obj.attach(tv.obj);
  tv.obj.position.set(0, LYING_Y, lyingZ(w) - Z_PACK);
  tv.obj.quaternion.copy(TV_LYING);
  const bag = makeBag(tv.inch);
  tv.obj.add(bag);
  const it: PackItem = { obj, s, hold: null, passed: new Set(), tv, bag, bagged: false };
  w.pack.items.push(it);
  r.carried = null;
  r.lastPlaced = tv;
  w.stats.picked++;
}

export function updateRobot(w: World, r: Robot, dt: number) {
  if (r.state === 'idle' && r.pallet && r.pallet.hold && r.seq.every(s => s.ready)) startJob(w, r);
  runSeq(r, dt);
  const err = track(r, 14);
  if (plateClear(r)) for (const it of w.test.items) if (it.hold === r.gate) it.hold = null;
  if (err > r.maxErr) r.maxErr = err;
  if (r.state === 'busy') r.busyT += dt;
  r.arm.ledMat.emissive.setHex(r.state === 'busy' ? LED.run : LED.wait);
}

/** Back to the waiting pose with nothing in hand (line restart). */
export function resetRobot(w: World, r: Robot) {
  if (r.carried) { r.carried.obj.parent?.remove(r.carried.obj); r.carried = null; }
  Object.assign(r, { seq: [], state: 'idle', pallet: null });
  r.seq.push({ toFn: () => readyPose(w, r), durFn: moveDur, ready: true });
}

/**
 * The robot has set its TV down and is on its way back (or waiting): the plate stays on the robot side of the test line
 * from here on, so the next pallet may come on to the pick point.
 */
const plateClear = (r: Robot) => r.state === 'idle';
