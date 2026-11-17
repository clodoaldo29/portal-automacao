// Motion sequencer: a robot (or any actor) runs a queue of steps on its pose vector.
// A step either calls a function, waits for a condition, or interpolates the pose to a target over a duration.
import { ease } from './math';

export type Pose = number[];

export interface Step {
  /** Run once and continue. */
  fn?: () => void;
  /** Wait until this returns true. */
  until?: () => boolean;
  /** Target pose (fixed), or computed when the step starts. */
  to?: Pose;
  toFn?: () => Pose;
  /** Duration in seconds (fixed), or computed from the start and target poses. */
  dur?: number;
  durFn?: (from: Pose, to: Pose) => number;
  /** Marks a step after which the actor may take a new job (it only moves to a waiting pose). */
  ready?: boolean;
  started?: boolean;
  from?: Pose;
  t?: number;
}

export interface Actor {
  seq: Step[];
  pose: Pose;
}

export function runSeq(a: Actor, dt: number) {
  while (a.seq.length) {
    const st = a.seq[0];
    if (st.fn) { a.seq.shift(); st.fn(); continue; }
    if (st.until) { if (!st.until()) return; a.seq.shift(); continue; }
    if (!st.started) {
      st.started = true;
      st.from = a.pose.slice();
      st.t = 0;
      if (st.toFn) st.to = st.toFn();
      if (st.durFn) st.dur = st.durFn(st.from, st.to!);
    }
    st.t! += dt;
    const u = st.dur! > 0 ? Math.min(1, st.t! / st.dur!) : 1;
    if (st.to) {
      const e = ease(u), from = st.from!, to = st.to;
      a.pose = from.map((v, k) => v + (to[k] - v) * e);
    }
    if (u < 1) return;
    a.seq.shift();
    dt = 0;
  }
}
