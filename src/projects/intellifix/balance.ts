// Intellifix AI: splitting the screws between the two UR10e, their order, and the pallet cycle (pure, no three.js).
//
// Split: 32"/43" — each robot screws the TV on its side. 50"+ — each robot takes the screws on its half of the TV
// (z > 0 robot 1, z < 0 robot 2), then the counts are evened out by handing over the points nearest the centre line.
// No collision: the band |z| < CELL.zone around the belt centre is shared, one robot at a time. Robot 1 does its
// shared-zone screws first and robot 2 last; robot 2 waits if robot 1 is still there (the wait shows in the plan).
//
// Times: study of 2026-11-19 (vendor and integrator figures; to be confirmed by a time study on LTV01 and the
// screwdriver supplier's guaranteed cycle).
import { inZone, requiredCycleS, robotBase, robotHome, screwPoints, tvsPerPallet, type ScrewPoint, type TvModel } from './model';

export type Feed = 'blow' | 'pick';

export interface TimingParams {
  /** Per screw, without the move: approach and touch, run down and final torque, retract. */
  screwS: number;
  /** Extra for a self-tapping screw. */
  selfTapS: number;
  /** Pallet exchange: out of the cell and the next one in, with a pre-stop before the cell. */
  exchangeS: number;
  /** Vision locating the TV(s) before the robots start. */
  visionS: number;
  /** Screw feeding: blown to the nose while driving ('blow') or the robot fetches it at the feeder ('pick'). */
  feed: Feed;
  /** Extra per screw when the robot fetches it at the feeder. */
  pickS: number;
  /** UR10e tool moves between points: top speed, acceleration, settling. */
  vmax: number; amax: number; settleS: number;
}

export const DEFAULT_TIMING: TimingParams = {
  screwS: 1.8, selfTapS: 0.8, exchangeS: 3.5, visionS: 0.8, feed: 'blow', pickS: 1.2, vmax: 1.0, amax: 3.0, settleS: 0.1,
};

/** Point-to-point move of `d` metres with a trapezoidal (or triangular) speed profile, plus settling. */
export function moveS(d: number, t: TimingParams = DEFAULT_TIMING): number {
  if (d <= 0) return 0;
  const dAcc = (t.vmax * t.vmax) / t.amax; // accelerating + braking at top speed
  const run = d < dAcc ? 2 * Math.sqrt(d / t.amax) : d / t.vmax + t.vmax / t.amax;
  return run + t.settleS;
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** Which robot screws each point: [robot 1 points, robot 2 points]. */
export function split(model: TvModel, points: ScrewPoint[]): [ScrewPoint[], ScrewPoint[]] {
  if (tvsPerPallet(model.inch) === 2) return [points.filter(p => p.tv === 0), points.filter(p => p.tv === 1)];
  const r1: ScrewPoint[] = [], r2: ScrewPoint[] = [];
  for (const p of points) (p.z > 1e-9 ? r1 : p.z < -1e-9 ? r2 : r1.length <= r2.length ? r1 : r2).push(p);
  // even out the counts: the bigger side hands over its point nearest the centre line
  while (Math.abs(r1.length - r2.length) > 1) {
    const [from, to] = r1.length > r2.length ? [r1, r2] : [r2, r1];
    let k = 0;
    from.forEach((p, i) => { if (Math.abs(p.z) < Math.abs(from[k].z)) k = i; });
    to.push(from.splice(k, 1)[0]);
  }
  return [r1, r2];
}

/** Nearest-neighbour tour from `start`. */
function tour(start: { x: number; z: number }, pts: ScrewPoint[]): ScrewPoint[] {
  const left = [...pts], out: ScrewPoint[] = [];
  let at = start;
  while (left.length) {
    let k = 0;
    left.forEach((p, i) => { if (dist(at, p) < dist(at, left[k])) k = i; });
    at = left.splice(k, 1)[0];
    out.push(at as ScrewPoint);
  }
  return out;
}

/** Screwing order of one robot: robot 1 does its shared-zone screws first, robot 2 last. */
export function order(r: 0 | 1, pts: ScrewPoint[]): ScrewPoint[] {
  const home = robotHome(r), zone = pts.filter(inZone), rest = pts.filter(p => !inZone(p));
  if (r === 0) {
    const a = tour(home, zone);
    return [...a, ...tour(a.length ? a[a.length - 1] : home, rest)];
  }
  const a = tour(home, rest);
  return [...a, ...tour(a.length ? a[a.length - 1] : home, zone)];
}

export interface Task {
  p: ScrewPoint;
  /** Leaves the previous point (or home) toward this one; times from the end of the vision step. */
  moveStart: number;
  /** Over the point, ready to go down (the move includes the trip to the feeder when the robot fetches screws). */
  arrive: number;
  /** Screw done, tool retracted. */
  done: number;
}

export interface RobotPlan {
  points: ScrewPoint[];
  tasks: Task[];
  /** Back home after the last screw. */
  endS: number;
  /** Time spent waiting for the shared zone. */
  waitS: number;
  /** [enter, leave] of the shared zone, or null. */
  zone: [number, number] | null;
}

export interface CyclePlan {
  model: TvModel;
  screws: number;
  robots: [RobotPlan, RobotPlan];
  /** Pallet cycle: exchange + vision + the slower robot. */
  cycleS: number;
  requiredS: number;
  /** cycleS / requiredS (≤ 1 meets the cadence). */
  load: number;
  ok: boolean;
  /** TVs per hour the cell can do on this model. */
  uph: number;
  /** Farthest screw from its robot's base (must be within CELL.reach). */
  maxReach: number;
}

function runRobot(r: 0 | 1, pts: ScrewPoint[], t: TimingParams, zoneFreeAt: number): RobotPlan {
  const seq = order(r, pts), pick = t.feed === 'pick' ? t.pickS : 0;
  let at: { x: number; z: number } = robotHome(r), now = 0, waitS = 0, zIn = -1, zOut = -1;
  const tasks: Task[] = [];
  for (const p of seq) {
    if (inZone(p) && zIn < 0 && now < zoneFreeAt) { waitS += zoneFreeAt - now; now = zoneFreeAt; }
    const moveStart = now, move = moveS(dist(at, p), t) + pick;
    if (inZone(p) && zIn < 0) zIn = moveStart;
    if (!inZone(p) && zIn >= 0 && zOut < 0) zOut = moveStart + move; // left the zone on arrival here
    const arrive = now + move;
    now = arrive + t.screwS + (p.selfTap ? t.selfTapS : 0);
    tasks.push({ p, moveStart, arrive, done: now });
    at = p;
  }
  const back = moveS(dist(at, robotHome(r)), t);
  if (zIn >= 0 && zOut < 0) zOut = now + back;
  return { points: seq, tasks, endS: now + back, waitS, zone: zIn >= 0 ? [zIn, zOut] : null };
}

/** Plan one pallet of `model` (optionally with another number of screws per TV). */
export function plan(model: TvModel, t: TimingParams = DEFAULT_TIMING, screws = model.screws): CyclePlan {
  const [p1, p2] = split(model, screwPoints(model, screws));
  const r1 = runRobot(0, p1, t, 0);
  const r2 = runRobot(1, p2, t, r1.zone ? r1.zone[1] : 0);
  const cycleS = t.exchangeS + t.visionS + Math.max(r1.endS, r2.endS);
  const requiredS = requiredCycleS(model);
  const maxReach = Math.max(
    ...p1.map(p => dist(p, robotBase(0))),
    ...p2.map(p => dist(p, robotBase(1))),
  );
  return {
    model, screws, robots: [r1, r2], cycleS, requiredS, load: cycleS / requiredS, ok: cycleS <= requiredS,
    uph: (3600 * tvsPerPallet(model.inch)) / cycleS, maxReach,
  };
}
