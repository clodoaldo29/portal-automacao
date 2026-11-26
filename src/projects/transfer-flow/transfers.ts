// Transfer 1 and Transfer 2 (JAKA Zu 50 with the hook gripper): take TVs from the assembly jigs and stand them,
// screen toward the robots, on the test pallets.
//
// Line logic (one TV per robot cycle, one TV per test pallet):
// · Robot 1 (upstream) takes one TV from a jig only when the work-split rule gives it one, then lets the jig go on.
// · The last enabled robot takes every TV that is left, holding the jig until it is empty. No good TV leaves the belt.
// · A robot's pallet need is known as soon as a TV is committed to it, so the buffer releases a pallet right away.
// · Pallets are not addressed: an empty pallet stops at the first robot that still needs one,
//   so robot 1 lets it go on to robot 2 when it already has its pallet. No pallet leaves empty.
import { station } from '../../sim/line';
import { hookVGP30, vgp30Direct } from '../../sim/robots/grippers';
import * as THREE from 'three';
import { LED, makeCobot, poseAt, solve, urTrack } from '../../sim/robots/ur-arm';
import { urFK } from '../../sim/robots/ur-kinematics';
import { capsuleGap, linkCapsules } from '../../sim/robots/collision';
import { ease } from '../../sim/math';
import { runSeq, type Pose } from '../../sim/sequencer';
import {
  ARM_DX, CUP_Z, DIRECT, DIRECT_D, gripOf, HOOK_D, ITEM_GAP, PAL_W, PICK_Y, ROBOT_Z, SEAT_Y, SIZES, TOP_TEST, TRANSFER_PED, TV_BACK, Z_ASM, Z_PAL, slotZ, type Inch,
} from './config';
import { TV_STANDING, tvPower } from './products';
import type { Jig, Mode, Pallet, Transfer, World } from './types';

const H = Math.PI / 2;

export const hasTV = (it: Jig | Pallet) => !!it.tvs && it.tvs.some(Boolean);
export const tvCount = (it: Jig) => it.tvs.filter(Boolean).length;

/** 'auto': 'B' in every size (jigs alternate, each robot empties its own). */
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
  // 0.8 m column: the Zu 50 shoulder sits ~1.10 m high; its long arm still lowers a 75" from above
  const arm = makeCobot(w.scene, w.M, { x: x - ARM_DX, z: ROBOT_Z, L1: 0.64, L2: 0.5, ped: TRANSFER_PED, pedW: 0.3 });
  if (DIRECT) vgp30Direct(arm.mount, w.M, { d: DIRECT_D }); else hookVGP30(arm.mount, w.M, { hookD: HOOK_D, cupZ: CUP_Z });
  arm.tool.rotation.order = 'YXZ';
  w.floorRect(x - ARM_DX - 0.4, ROBOT_Z - 0.4, x - ARM_DX + 0.4, ROBOT_Z + 0.4, 0.04);
  // rest (start, arm switched off): half open, hook level (direct plate: facing down), clear of the arm
  const home: Pose = DIRECT ? [phi.home, 0.8, 0.0, 0, 0] : [phi.home, 0.8, 0.0, H, Math.PI];
  const r: Transfer = {
    arm, x, D: DIRECT ? DIRECT_D : HOOK_D, wrap: p => (phi.wrapPositive && p < 0 ? p + 2 * Math.PI : p),
    enabled: true, count: 0, seq: [], state: 'idle', job: null, pallet: null, need: 0, carried: null, leaving: null, zoneBusy: false, path: [], jm: null,
    busyT: 0, totT: 0, palT: 0, home, pose: home.slice(),
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

/** Via point of every swing: arm pointing downstream, flange high over the gap between the belts, TV half turned. */
// (direct plate: 1.1 m out and 1.7 m up, the elbow above the wrist: the TV at the flange stays clear of the arm; it passes
// through the gap between the belts)
const viaPose = (r: Transfer): Pose => (DIRECT ? [0, 1.1, 1.7 - r.arm.shoulderY, H / 2, 0] : [0, 0.5, 2.3 - r.arm.shoulderY, H / 2, 1.5 * Math.PI]);

/**
 * Pick: TV lies screen-down on the jig. Tool horizontal (tilt 90°, yaw 180°): the cups hang CUP_Z below the flange
 * and sit D beyond it, on the back cover, GRIP from the TV edge nearest the robot (that edge becomes the top).
 */
/** Direct plate: how far above the TV's centre it holds it (toward its top edge). The 32"/43" are light and low in the
 *  pallet: held 13 cm below their top edge, the wrist works higher and does not fold onto the forearm. */
const directOff = (inch: Inch) => (inch <= 43 ? SIZES[inch][1] / 2 - 0.13 : 0);

function pickPose(r: Transfer, inch: Inch, k: number, dy: number): Pose {
  const d = SIZES[inch][1];
  if (DIRECT) { // plate straight down on the middle of the back (tool pointing down, the TV's width along the plate)
    const p = poseAt(r.arm, r.x, Z_ASM + slotZ(inch, k) - directOff(inch), PICK_Y + r.D + dy);
    return [r.wrap(p[0]), p[1], p[2], 0, 0];
  }
  // (the base colchão holds a 32"/43" pair across the belt: TV k at slotZ; the hook takes the edge nearest the robot)
  // the tool pitched down a little (PICK_TILT) about the cup row: the wrist rides higher over the jig foam
  const s = Math.sin(tiltOf(inch)), c = Math.cos(tiltOf(inch));
  const p = poseAt(r.arm, r.x, Z_ASM + slotZ(inch, k) - (d / 2 - gripOf(inch)) - r.D * c + CUP_Z * s, PICK_Y + r.D * s + CUP_Z * c + dy);
  return [r.wrap(p[0]), p[1], p[2], H - tiltOf(inch), Math.PI];
}

/** Place: TV upright in the pallet, screen toward the robots (+z). Tool pointing down behind the TV. */
function placePose(r: Transfer, inch: Inch, dy: number, dz: number): Pose {
  const d = SIZES[inch][1], cupY = TOP_TEST + SEAT_Y + d - gripOf(inch);
  if (DIRECT) { // plate on the back, which faces the robots: tool pointing away from them (tilt 90°), the TV between
    const p = poseAt(r.arm, r.x, Z_PAL + TV_BACK + r.D + dz, TOP_TEST + SEAT_Y + d / 2 + directOff(inch) + dy);
    return [p[0], p[1], p[2], H, 0];
  }
  // the tool pitched back by PICK_TILT (the TV was taken with the tool pitched forward): the TV stands exactly upright
  const s = Math.sin(tiltOf(inch)), c = Math.cos(tiltOf(inch));
  const p = poseAt(r.arm, r.x, Z_PAL - TV_BACK - r.D * s - CUP_Z * c + dz, cupY + r.D * c - CUP_Z * s + dy);
  // The tool must end facing the same world direction (yaw 0 ≡ 2π). Pick the equivalent that keeps the
  // tool's yaw relative to the arm what it was at the pick, so the base swing does the turning and the
  // wrist does not add a full 360° spin.
  const relPick = Math.PI - pickPose(r, 50, 0, 0)[0];
  const yaw = [0, 2 * Math.PI, -2 * Math.PI].reduce((best, y) => (Math.abs(y - p[0] - relPick) < Math.abs(best - p[0] - relPick) ? y : best));
  return [p[0], p[1], p[2], -tiltOf(inch), yaw];
}

/** Wait hovering over the pick point, not at a far home. */
/**
 * Wait over the first TV, higher and a little further out than the pick: the arm half open, the hook clear of the
 * upper arm (from here it goes straight down onto the TV).
 */
/** Tool pitch at the pick (~10°, the wrist over the jig foam), given back at the place; the 65"/75" do without it (their
 *  wrist is high enough, and at the place the tall TV would come close to the arm). */
const tiltOf = (inch: Inch) => { void inch; return 0; }; // (no pitch: the four cups lie flat on the TV back)
export const readyPose = (w: World, r: Transfer): Pose => {
  const inch = w.params.inch, d = SIZES[inch][1];
  if (DIRECT) { const p = poseAt(r.arm, r.x, Z_ASM + slotZ(inch, 0) - WAIT_OUT, PICK_Y + r.D + WAIT_UP); return [r.wrap(p[0]), p[1], p[2], 0, 0]; }
  const p = poseAt(r.arm, r.x, Z_ASM + slotZ(inch, 0) - (d / 2 - gripOf(inch)) - r.D + WAIT_OUT, PICK_Y + CUP_Z + WAIT_UP);
  return [r.wrap(p[0]), p[1], p[2], H, Math.PI];
};
const WAIT_UP = 0.45, WAIT_OUT = 0.15;

/**
 * Move time from joint distance — collaborative speeds with up to ~30 kg on the flange (all axes move together,
 * so the slowest axis sets the time: base 105°/s, reach and height 1 m/s, wrist 130–190°/s).
 */
export const moveDur = (a: Pose, b: Pose) =>
  0.3 + Math.max(Math.abs(b[0] - a[0]) * 0.55, Math.abs(b[1] - a[1]) * 1.0, Math.abs(b[2] - a[2]) * 1.0, Math.abs((b[3] || 0) - (a[3] || 0)) * 0.45, Math.abs((b[4] || 0) - (a[4] || 0)) * 0.3);

function startJob(w: World, r: Transfer) {
  const jig = r.job!, inch = jig.inch, k = jig.tvs.findIndex(Boolean), d = SIZES[inch][1];
  r.seq.length = 0; // drop a pending move to the ready pose
  r.state = 'pick';
  // 65"/75": slower and smoother while the TV is in the air (the cups hold it mostly by friction once it stands up;
  // these models have time to spare against their line rate)
  const slow = inch >= 65 ? 1.5 : 1, slowDur = (a: Pose, b: Pose) => moveDur(a, b) * slow;
  r.seq.push(
    { toFn: () => pickPose(r, inch, k, 0.2), durFn: moveDur }, { toFn: () => pickPose(r, inch, k, 0), dur: 0.5 }, { dur: 0.3 },
    { fn: () => { const tv = jig.tvs[k]!; r.arm.mount.attach(tv.obj); r.carried = tv; jig.tvs[k] = null; } },
    { toFn: () => pickPose(r, inch, k, 0.4), dur: 0.6 * slow },
    { fn: () => {
      if (!hasTV(jig)) { jig.ledMat.emissive.setHex(0x000000); jig.hold = null; r.job = null; }
      else if (!isLastR(w, r) && modeOf(w, jig) !== 'B') { giveToLast(w, jig, tvCount(jig)); jig.hold = null; r.job = null; } // the other TV goes on to robot 2
      r.state = 'waitPallet';
    } },
    { until: () => !!r.pallet && r.pallet.hold === r.placeSt },
    { fn: () => { r.state = 'place'; } },
    { toFn: () => viaPose(r), durFn: slowDur }, // high over the gap between the belts, TV half turned
    ...(DIRECT
      // direct plate: the TV upright 30 cm over its seat (in its final plane, away from the arm), then straight down
      ? [{ toFn: () => placePose(r, inch, 0.3, 0), durFn: slowDur }, { toFn: () => placePose(r, inch, 0, 0), dur: 0.9 * slow }]
      // hook: TV upright 45 cm in front of the pallet, then slide it in over the front lip, between the side guides
      : [{ toFn: () => placePose(r, inch, 0.1, 0.45), durFn: slowDur }, { toFn: () => placePose(r, inch, 0, 0), dur: 0.75 * slow }]),
    { dur: 0.3 },
    { fn: () => {
      const tv = r.carried!, pal = r.pallet!;
      pal.obj.attach(tv.obj);
      tv.obj.position.set(0, SEAT_Y + d / 2, 0);
      tv.obj.quaternion.copy(TV_STANDING);
      pal.tvs.push(tv);
      r.carried = null;
      tvPower(tv, 'swoosh');
      w.stats.moved++;
      r.count++;
      // the pallet leaves at once and carries the TV away from the hook; nothing else may enter the dock meanwhile
      r.leaving = pal; r.zoneBusy = true; pal.hold = null; r.pallet = null; r.need--;
    } },
    { toFn: () => placePose(r, inch, 0, DIRECT ? 0.1 : -0.1), dur: 0.3 }, // cups back off the TV
    // the hook's plate (at the TV's mid-height, behind it, inside the side guides) waits until the whole pallet has
    // gone past it; the direct plate is on the robot side of the TV and goes straight back
    { until: () => DIRECT || !w.test.items.includes(r.leaving!) || r.leaving!.obj.position.x - PAL_W / 2 > r.x + 0.25 },
    { fn: () => { r.state = 'return'; } },
    // the way back is the way there in reverse: in front of the pallet (a little higher: the hook clears the pallet),
    // the high via, the TV's lift point, over the jig
    { toFn: () => (DIRECT ? placePose(r, inch, 0.4, 0.1) : placePose(r, inch, 0.3, 0.45)), durFn: moveDur }, // (direct: straight up)
    { toFn: () => viaPose(r), durFn: moveDur },
    { fn: () => { r.zoneBusy = false; r.leaving = null; r.state = 'idle'; } },
    { toFn: () => pickPose(r, inch, k, 0.4), durFn: moveDur, ready: true },
    { toFn: () => readyPose(w, r), durFn: moveDur, ready: true },
  );
}
/** Follow the pose, or play the joint move under way. */
function drive(r: Transfer, dt: number, iters: number) {
  const m = r.jm, ur = r.arm.ur;
  if (m && ur) {
    m.t += dt;
    const u = ease(Math.min(1, m.t / m.dur));
    ur.q = m.q0.map((v, j) => v + (m.q1[j] - v) * u);
    ur.joints.forEach((jn, j) => { jn.rotation.z = ur.q[j]; });
    if (m.t >= m.dur) r.jm = null;
  } else { r.jm = null; track(r, iters); }
}

export function updateRobots(w: World, dt: number) {
  for (const r of w.robots) {
    if (!r.zoneBusy) for (const it of w.test.items) if (it.hold === r.gateSt) it.hold = null; // dock clear: let the queue in
    if (!r.enabled) { // switched off: park and stay out of the flow
      runSeq(r, dt); solve(r.arm, r.pose); drive(r, dt, 6); r.arm.ledMat.emissive.setHex(LED.off);
      continue;
    }
    // the last robot always keeps one empty pallet docked or on its way, so it never waits for one;
    // an upstream robot never parks an empty pallet, which would block the pallets of the robot after it
    if (isLastR(w, r) && r.need === 0) r.addNeed(1);
    // the TV is only picked up once the empty pallet is in the dock: never held in the air waiting for it
    const docked = !!r.pallet && r.pallet.hold === r.placeSt;
    if (r.state === 'idle' && r.job && docked && r.seq.every(s => s.ready)) startJob(w, r);
    runSeq(r, dt); solve(r.arm, r.pose); drive(r, dt, 14);
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
  Object.assign(r, { seq: [], state: 'idle', job: null, pallet: null, need: 0, leaving: null, zoneBusy: false, path: [], jm: null });
  r.seq.push({ toFn: () => (r.enabled ? readyPose(w, r) : r.home), durFn: moveDur, ready: true });
}

// ---------- elbow always up ----------
// The arm follows its pose with an iterative solver started from where it is; on some moves it can slip into the
// elbow-down solution (the arm bending under itself). Every step it is checked and, if so, solved again from
// elbow-up postures.
const _sh = new THREE.Vector3(), _el = new THREE.Vector3(), _wr = new THREE.Vector3(), _d = new THREE.Vector3();
/** Height of the elbow over the shoulder → wrist line (negative: elbow down). */
export function elbowLift(r: Transfer) {
  const ur = r.arm.ur;
  if (!ur) return 1;
  _sh.setFromMatrixPosition(urFK(ur, ur.q, 2)); _el.setFromMatrixPosition(urFK(ur, ur.q, 3)); _wr.setFromMatrixPosition(urFK(ur, ur.q, 4));
  _d.subVectors(_wr, _sh);
  const t = THREE.MathUtils.clamp(_el.clone().sub(_sh).dot(_d) / Math.max(1e-9, _d.lengthSq()), 0, 1);
  return _el.y - (_sh.y + _d.y * t);
}
/** Smallest gap between the arm's own links that are not neighbours (negative: the wrist folded onto the forearm …),
 *  for the joints in ur.q (drawn joints are set to them). */
function selfGap(r: Transfer) {
  const ur = r.arm.ur!;
  ur.joints.forEach((j, i) => { j.rotation.z = ur.q[i]; });
  const caps = linkCapsules(r.arm, 0);
  let min = Infinity;
  for (const s of caps) for (const t of caps) if (t.link - s.link >= 3) min = Math.min(min, capsuleGap(s, t));
  return min;
}
// (light on purpose: only when the elbow is really down or the arm touches itself, a few seeds, at most every 15
// steps per robot)
const cooldown = new WeakMap<Transfer, number>();
function track(r: Transfer, iters: number) {
  const err = urTrack(r.arm, r.pose, iters);
  const cd = cooldown.get(r) ?? 0;
  if (cd > 0) cooldown.set(r, cd - 1);
  if (cd > 0) return;
  // solved again when the elbow went down, when the arm is stuck short of the pose (stretched straight: the solver
  // cannot get out of that by itself), when the wrist folded onto the arm, or when wrist 2 slipped to the other side
  // (through the wrist singularity at the pick, tool level): with wrist 2 negative the arm reaches the pallet stretched
  const ur = r.arm.ur!, wrap = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
  const stuck = err > 0.01 && Math.abs(wrap(ur.q[2])) < 0.15;
  const wristOk = (q: number[]) => DIRECT || wrap(q[4]) > -0.05; // (a hook rule: the direct plate takes either side)
  if (elbowLift(r) >= 0 && !stuck && wristOk(ur.q) && selfGap(r) > 0.015) return;
  cooldown.set(r, 15);
  const keep = ur.q.slice(), [, a, b, c] = keep;
  let best: { score: number; q: number[] } | null = null;
  // the same arm with the elbow mirrored (shoulder and wrist 1 take up the difference), and two plain postures
  // (and, for an arm stuck reaching backwards, the base turned to face the work); each with the wrist as it is and
  // with the other wrist solution (wrist 1 and 3 half a turn, wrist 2 mirrored)
  const arms: number[][] = [[keep[0], a + b, -b, c + b], [keep[0], a, -b, c], [keep[0], -1.2, 1.6, c], [keep[0], -1.8, 1.0, c]];
  if (stuck) for (const b0 of [keep[0] + Math.PI, keep[0] - Math.PI]) arms.push([b0, -1.2, 1.6, c], [b0, -1.6, 2.0, c]);
  const seeds = [keep, ...arms.flatMap(([q0, q1, q2, q3]) => [[q0, q1, q2, q3, keep[4], keep[5]], [q0, q1, q2, q3 + Math.PI, -keep[4], keep[5] + Math.PI]])];
  for (const s of seeds) {
    ur.q = s.slice();
    const err = urTrack(r.arm, r.pose, 60), lift = elbowLift(r);
    if (err > 0.003 || lift < 0.05 || !wristOk(ur.q) || Math.abs(ur.q[0]) > 2 * Math.PI) continue;
    const gap = selfGap(r);
    if (gap < 0.015) continue; // never into a posture that touches itself
    // elbow up, clear of itself, and the wrist as it was as far as possible
    const wrist = [3, 4, 5].reduce((s, j) => s + Math.abs(wrap(ur.q[j] - keep[j])), 0);
    const score = Math.min(gap, 0.05) * 20 + lift - 0.3 * wrist;
    if (!best || score > best.score) best = { score, q: ur.q.slice() };
  }
  // joints that came out a full turn away go back to the turn they were on (no 360° spins, elbow in range)
  ur.q = best ? best.q.map((v, j) => (j === 0 ? v : keep[j] + wrap(v - keep[j]))) : keep;
  ur.joints.forEach((j, i) => { j.rotation.z = ur.q[i]; });
}
