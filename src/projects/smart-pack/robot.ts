// Station 1: JAKA Zu 50 with the hook and the OnRobot VGP30, as the Transfer Flow transfers — the same motion run
// backwards. The TV stands in the test pallet with its screen toward the robot (as on the Transfer Flow test belt): the
// hook comes down behind it, the cups take the middle of its back, it is lifted out of the pallet, the base turns
// toward the bagging belt while the tool goes from pointing down to horizontal, and the TV lies screen-down as on the
// assembly belt: width along the line, top edge toward the robot, label (bottom) on the far side.
import * as THREE from 'three';
import { station } from '../../sim/line';
import { hookVGP30 } from '../../sim/robots/grippers';
import { LED, makeCobot, poseAt, upgradeArm, urTrack } from '../../sim/robots/ur-arm';
import { ZU50 } from '../../sim/robots/ur-kinematics';
import { runSeq, type Pose } from '../../sim/sequencer';
import { CUP_Z, HOOK_D } from '../transfer-flow/config';
import { track as tfTrack } from '../transfer-flow/transfers';
import type { Transfer } from '../transfer-flow/types';
import { DROP_X, LYING_Y, PAL_W, PICK_X, ROBOT, SEAT_Y, SIZES, TV_BACK, Y_PACK, Y_TEST, Z_EDGE, Z_PACK, Z_TEST } from './config';
import { TV_LYING, makeBag } from './products';
import type { PackItem, Robot, World } from './types';

const H = Math.PI / 2;


export function createRobot(w: World): Robot {
  const arm = makeCobot(w.scene, w.M, { x: ROBOT.x, z: ROBOT.z, L1: 0.64, L2: 0.5, ped: ROBOT.ped, pedW: 0.3 });
  hookVGP30(arm.mount, w.M, { hookD: HOOK_D, cupZ: CUP_Z });
  arm.tool.rotation.order = 'YXZ';
  const r = { arm, seq: [], pose: [], state: 'idle', pallet: null, carried: null, lastPallet: null, lastPlaced: null, busyT: 0, maxErr: 0 } as unknown as Robot;
  r.pose = readyPose(w, r);
  upgradeArm(w.scene, arm, r.pose, ZU50);
  // interlock (as the Transfer Flow dock): while the hook is not waiting behind the pick point, the next pallet waits one
  // slot before it, so the hook never crosses a TV on its way back
  r.gate = station(w.test, w.test.track.sAtX(0, PICK_X) - (PAL_W + 0.1) + 0.02, it => !!it.tv && !hookReady(r), () => {});
  station(w.test, w.test.track.sAtX(0, PICK_X), it => !!it.tv, it => { r.pallet = it; });
  return r;
}

/**
 * Hook behind the TV standing in the test pallet: tool pointing down, the bracket HOOK_D long, the cups CUP_Z off it
 * facing the robot (yaw π) on the middle of the TV's back. dy lifts, dz backs the cups off the back.
 */
function pickPose(w: World, r: Robot, dy: number, dz: number): Pose {
  const h = SIZES[w.params.inch][1];
  const p = poseAt(r.arm, PICK_X, Z_TEST + TV_BACK + CUP_Z + dz, Y_TEST + SEAT_Y + h / 2 + HOOK_D + dy);
  return [p[0], p[1], p[2], 0, Math.PI];
}
/** Centre of the TV lying on the infeed: its bottom edge on the line Z_EDGE (far side), whatever the size. */
export const lyingZ = (w: World) => Z_EDGE + SIZES[w.params.inch][1] / 2;
/**
 * Hook over the TV lying on the infeed: tool horizontal toward the far side (tilt 90°, yaw 2π ≡ 0: written so the tool
 * keeps its heading relative to the arm while the base turns half a turn), the bracket over the TV, the cups facing down
 * on the middle of its back.
 */
function placePose(w: World, r: Robot, dy: number): Pose {
  const p = poseAt(r.arm, DROP_X, lyingZ(w) + HOOK_D, Y_PACK + LYING_Y + TV_BACK + CUP_Z + dy);
  return [p[0], p[1], p[2], H, 2 * Math.PI];
}
/** Half way, as the Transfer Flow transfers: the arm toward the bagger side (+x), high, the TV half laid down. */
const viaPose = (r: Robot): Pose => [0, VIA_R, VIA_Y - r.arm.shoulderY, H / 2, 1.5 * Math.PI];
let VIA_R = 0.5, VIA_Y = 2.5;
/** (bench) try another via point. */
export const setVia = (rr: number, y: number) => { VIA_R = rr; VIA_Y = y; };
/** Waiting behind the pick point, the cups 6 cm off the TV's back and a little higher: the next pallet passes in front of it. */
export const readyPose = (w: World, r: Robot): Pose => pickPose(w, r, 0.03, 0.06);

/** Joint-speed move time (collaborative speeds with a TV on the flange; the slowest axis sets the time). */
const moveDur = (a: Pose, b: Pose) =>
  0.3 + Math.max(Math.abs(b[0] - a[0]) * 0.6, Math.abs(b[1] - a[1]) * 1.1, Math.abs(b[2] - a[2]) * 1.1, Math.abs(b[3] - a[3]) * 0.5, Math.abs(b[4] - a[4]) * 0.35);

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
    { toFn: () => pickPose(w, r, 0, 0.06), durFn: moveDur }, // the hook behind the TV, cups 6 cm off its back
    { toFn: () => pickPose(w, r, 0, 0), dur: 0.5 },
    { dur: 0.35 }, // vacuum builds up; the VGP30 sensor confirms the grip
    { fn: () => { const tv = pal.tv!; r.arm.mount.attach(tv.obj); r.carried = tv; pal.tv = null; r.lastPallet = pal; } },
    { toFn: () => pickPose(w, r, 0.36, 0), dur: 0.7 * slow }, // straight up, out of the side guides (31 cm over the seat), the top of a 75" clear of the forearm
    { fn: () => { pal.hold = null; r.pallet = null; } }, // the empty pallet goes on to the return lift
    { toFn: () => viaPose(r), durFn: slowDur },
    { toFn: () => placePose(w, r, 0.25), durFn: slowDur },
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
  // elbow up and the arm clear of itself, as the Transfer Flow transfers (same arm, same hook)
  tfTrack(r as unknown as Transfer, 14);
  const err = urTrack(r.arm, r.pose, 1);
  if (hookReady(r)) for (const it of w.test.items) if (it.hold === r.gate) it.hold = null;
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

/** The hook is waiting behind the pick point (nothing left to do but wait for a pallet). */
const hookReady = (r: Robot) => r.state === 'idle' && r.seq.length === 0;
