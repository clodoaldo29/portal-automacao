// Station 1: JAKA Zu 50 with the OnRobot VGP30 straight on the flange. It takes the TV standing in the test pallet by
// the middle of its back (the back faces the robot), lifts it out of the pallet, turns with the base toward the packing
// line while the tool goes from horizontal to pointing down, and lays the TV screen-down on the bagger infeed.
import * as THREE from 'three';
import { station } from '../../sim/line';
import { vgp30Direct } from '../../sim/robots/grippers';
import { LED, makeCobot, poseAt, upgradeArm, urTrack } from '../../sim/robots/ur-arm';
import { ZU50 } from '../../sim/robots/ur-kinematics';
import { runSeq, type Pose } from '../../sim/sequencer';
import { DROP_X, GRIP_D, LYING_Y, PICK_X, ROBOT, SEAT_Y, SIZES, TV_BACK, Y_PACK, Y_TEST, Z_EDGE, Z_PACK, Z_TEST } from './config';
import { TV_LYING, makeBag } from './products';
import type { PackItem, Robot, World } from './types';

const H = Math.PI / 2;

export function createRobot(w: World): Robot {
  const arm = makeCobot(w.scene, w.M, { x: ROBOT.x, z: ROBOT.z, L1: 0.64, L2: 0.5, ped: ROBOT.ped, pedW: 0.3 });
  vgp30Direct(arm.mount, w.M, { d: GRIP_D });
  arm.tool.rotation.order = 'YXZ';
  const r: Robot = { arm, seq: [], pose: [], state: 'idle', pallet: null, carried: null, busyT: 0, maxErr: 0 };
  r.pose = readyPose(w, r);
  upgradeArm(w.scene, arm, r.pose, ZU50);
  station(w.test, w.test.track.sAtX(0, PICK_X), it => !!it.tv, it => { r.pallet = it; });
  return r;
}

/** Plate on the middle of the TV's back in the test pallet, tool horizontal toward the TV (+z); dz backs off, dy lifts. */
function pickPose(w: World, r: Robot, dy: number, dz: number): Pose {
  const h = SIZES[w.params.inch][1];
  const p = poseAt(r.arm, PICK_X, Z_TEST - TV_BACK - GRIP_D - dz, Y_TEST + SEAT_Y + h / 2 + dy);
  return [p[0], p[1], p[2], -H, 0];
}
/** Centre of the TV lying on the infeed: its bottom edge on the line Z_EDGE (far side), whatever the size. */
export const lyingZ = (w: World) => Z_EDGE + SIZES[w.params.inch][1] / 2;
/**
 * Plate on the TV lying on the infeed, tool pointing down. Tool yaw 0, as at the pick: the TV keeps its heading (width
 * along the line) while the base turns half a turn, and lies as on the Transfer Flow assembly belt, top edge toward
 * the robot.
 */
function placePose(w: World, r: Robot, dy: number): Pose {
  const p = poseAt(r.arm, DROP_X, lyingZ(w), Y_PACK + LYING_Y + TV_BACK + GRIP_D + dy);
  return [p[0], p[1], p[2], 0, 0];
}
/** Half way: the arm toward the bagger side (+x), high, the TV half laid down. */
const viaPose = (r: Robot): Pose => [0, 1.05, 2.15 - r.arm.shoulderY, -H / 2, 0];
/** Waiting: 30 cm behind the pick point and a little higher, ready to go straight in. */
export const readyPose = (w: World, r: Robot): Pose => pickPose(w, r, 0.1, 0.3);

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
    { toFn: () => pickPose(w, r, 0, 0.12), durFn: moveDur },
    { toFn: () => pickPose(w, r, 0, 0), dur: 0.5 },
    { dur: 0.35 }, // vacuum builds up; the VGP30 sensor confirms the grip
    { fn: () => { const tv = pal.tv!; r.arm.mount.attach(tv.obj); r.carried = tv; pal.tv = null; } },
    { toFn: () => pickPose(w, r, 0.45, 0), dur: 0.8 * slow }, // straight up, out of the side guides
    { fn: () => { pal.hold = null; r.pallet = null; } }, // the empty pallet goes on to the return lift
    { toFn: () => viaPose(r), durFn: slowDur },
    { toFn: () => placePose(w, r, 0.3), durFn: slowDur },
    { until: () => dropFree(w) },
    { toFn: () => placePose(w, r, 0), dur: 0.7 * slow },
    { dur: 0.25 },
    { fn: () => release(w, r) },
    { toFn: () => placePose(w, r, 0.3), dur: 0.5 },
    { fn: () => { r.state = 'idle'; } },
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
  w.stats.picked++;
}

export function updateRobot(w: World, r: Robot, dt: number) {
  if (r.state === 'idle' && r.pallet && r.pallet.hold && r.seq.every(s => s.ready)) startJob(w, r);
  runSeq(r, dt);
  const err = urTrack(r.arm, r.pose, 14);
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
