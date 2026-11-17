// Discrete-event simulation core: a seeded random generator and a time-ordered event queue. No DOM, no three.js.
// Used when a model has to cover days of operation in milliseconds (factory flow, queues, logistics).

export type Rng = () => number;

/** Seeded uniform generator on [0, 1) (mulberry32): the same seed always gives the same run. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ev { t: number; seq: number; fn: () => void }

/** Binary heap of timed callbacks. Events at the same time run in the order they were scheduled. */
export class EventQueue {
  private h: Ev[] = [];
  private seq = 0;
  /** Current simulated time. */
  now = 0;

  /** Schedule fn at absolute time t (never earlier than now). */
  at(t: number, fn: () => void) {
    const e = { t: Math.max(t, this.now), seq: this.seq++, fn };
    const h = this.h;
    h.push(e);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(h[i], h[p])) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }

  /** Schedule fn dt after now. */
  in(dt: number, fn: () => void) { this.at(this.now + dt, fn); }

  get size() { return this.h.length; }

  /** Run every event due at or before t, then set the clock to t. */
  runUntil(t: number) {
    while (this.h.length && this.h[0].t <= t) {
      const e = this.pop();
      this.now = e.t;
      e.fn();
    }
    if (t > this.now) this.now = t;
  }

  private pop(): Ev {
    const h = this.h, top = h[0], last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < h.length && before(h[l], h[m])) m = l;
        if (r < h.length && before(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
}

const before = (a: Ev, b: Ev) => a.t < b.t || (a.t === b.t && a.seq < b.seq);
