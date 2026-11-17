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
import { LED, makeCobot, poseAt, solve, urTrack } from '../../sim/robots/ur-arm';
import { runSeq, type Pose } from '../../sim/sequencer';
import {
  CUP_Z, GRIP, HOOK_D, ITEM_GAP, PAL_W, PICK_Y, ROBOT_Z, SEAT_Y, SIZES, TOP, TRANSFER_PED, TV_BACK, Z_ASM, Z_PAL, slotX, type Inch,
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
const viaPose = (r: Transfer): Pose => [0, 0.5, 2.3 - r.arm.shoulderY, H / 2, 1.5 * Math.PI];

/**
 * Pick: TV lies screen-down on the jig. Tool horizontal (tilt 90°, yaw 180°): the cups hang CUP_Z below the flange
 * and sit D beyond it, on the back cover, GRIP from the TV edge nearest the robot (that edge becomes the top).
 */
function pickPose(r: Transfer, inch: Inch, k: number, dy: number): Pose {
  const d = SIZES[inch][1];
  const p = poseAt(r.arm, r.x + slotX(inch, k), Z_ASM - (d / 2 - GRIP) - r.D, PICK_Y + CUP_Z + dy);
  return [r.wrap(p[0]), p[1], p[2], H, Math.PI];
}

/** Place: TV upright in the pallet, screen toward the robots (+z). Tool pointing down behind the TV. */
function placePose(r: Transfer, inch: Inch, dy: number, dz: number): Pose {
  const d = SIZES[inch][1], cupY = TOP + SEAT_Y + d - GRIP;
  const p = poseAt(r.arm, r.x, Z_PAL - TV_BACK - CUP_Z + dz, cupY + r.D + dy);
  // The tool must end facing the same world direction (yaw 0 ≡ 2π). Pick the equivalent that keeps the
  // tool's yaw relative to the arm what it was at the pick, so the base swing does the turning and the
  // wrist does not add a full 360° spin.
  const relPick = Math.PI - pickPose(r, 50, 0, 0)[0];
  const yaw = [0, 2 * Math.PI, -2 * Math.PI].reduce((best, y) => (Math.abs(y - p[0] - relPick) < Math.abs(best - p[0] - relPick) ? y : best));
  return [p[0], p[1], p[2], 0, yaw];
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
  r.seq.length = 0; // drop a pending move to the ready pose
  r.state = 'pick';
  r.seq.push(
    { toFn: () => pickPose(r, inch, k, 0.2), durFn: moveDur }, { toFn: () => pickPose(r, inch, k, 0), dur: 0.5 }, { dur: 0.3 },
    { fn: () => { const tv = jig.tvs[k]!; r.arm.mount.attach(tv.obj); r.carried = tv; jig.tvs[k] = null; } },
    { toFn: () => pickPose(r, inch, k, 0.4), dur: 0.6 },
    { fn: () => {
      if (!hasTV(jig)) { jig.ledMat.emissive.setHex(0x000000); jig.hold = null; r.job = null; }
      else if (!isLastR(w, r) && modeOf(w, jig) !== 'B') { giveToLast(w, jig, tvCount(jig)); jig.hold = null; r.job = null; } // the other TV goes on to robot 2
      r.state = 'waitPallet';
    } },
    { until: () => !!r.pallet && r.pallet.hold === r.placeSt },
    { fn: () => { r.state = 'place'; } },
    { toFn: () => viaPose(r), durFn: moveDur }, // high over the gap between the belts, TV half turned
    { toFn: () => placePose(r, inch, 0.1, 0.45), durFn: moveDur }, // TV upright 45 cm in front of the pallet
    { toFn: () => placePose(r, inch, 0, 0), dur: 0.75 }, { dur: 0.3 }, // slide it in over the front lip, between the side guides
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
    { toFn: () => viaPose(r), durFn: moveDur }, // hook back to the front, now that the TV has gone
    { fn: () => { r.zoneBusy = false; r.leaving = null; r.state = 'idle'; } },
    { toFn: () => readyPose(w, r), durFn: moveDur, ready: true },
  );
}

export function updateRobots(w: World, dt: number) {
  for (const r of w.robots) {
    if (!r.zoneBusy) for (const it of w.test.items) if (it.hold === r.gateSt) it.hold = null; // dock clear: let the queue in
    if (!r.enabled) { // switched off: park and stay out of the flow
      runSeq(r, dt); solve(r.arm, r.pose); urTrack(r.arm, r.pose, 6); r.arm.ledMat.emissive.setHex(LED.off);
      continue;
    }
    // the last robot always keeps one empty pallet docked or on its way, so it never waits for one;
    // an upstream robot never parks an empty pallet, which would block the pallets of the robot after it
    if (isLastR(w, r) && r.need === 0) r.addNeed(1);
    if (r.state === 'idle' && r.job && r.seq.every(s => s.ready)) startJob(w, r);
    runSeq(r, dt); solve(r.arm, r.pose); urTrack(r.arm, r.pose, 14);
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
  Object.assign(r, { seq: [], state: 'idle', job: null, pallet: null, need: 0, leaving: null, zoneBusy: false });
  r.seq.push({ toFn: () => (r.enabled ? readyPose(w, r) : r.home), durFn: moveDur, ready: true });
}
