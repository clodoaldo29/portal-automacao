// Plant flow engine: lots released at the receiving dock follow the route through the machines, waiting in each
// area's WIP shelf, and are carried between areas by the fleet (operators with carts, or AMRs).
// Discrete events in minutes; pure TypeScript (no DOM, no three.js), deterministic for a given seed.
import { createRng, EventQueue } from '../../sim/des';
import { createLaneGraph, pointAlong, type LaneGraph, type P2, type Route } from '../../sim/paths';
import { DOCK_IN, EQUIPMENT, LANES, PARKING, RACKS, equip, type Equip } from './layout';
import {
  FAMILIES, FAMILY_INFO, STEPS, WAFERS_PER_LOT, scenarioSetup, stepMinutes,
  type Family, type Params, type ScenarioId, type StepDef,
} from './process';

export interface Machine {
  idx: number;
  eq: Equip;
  /** Equipment working with this one as a cell (handler of an ATE). */
  linked?: Equip;
  step: Step;
  slots: number;
  lots: Lot[];
  node: number;
  /** Stopped by a failure (andon red). A failure due while a lot runs waits for that lot to finish. */
  down: boolean;
  failPending: boolean;
  busyInt: number;
  downInt: number;
  done: number;
  stops: number;
}

export interface Step {
  idx: number;
  def: StepDef;
  machines: Machine[];
  queue: Lot[];
  minutes: number;
  rack: P2;
  rackNode: number;
  /** Lots assigned to a carrier and on their way here. */
  enRoute: number;
  busyInt: number;
  downInt: number;
  qInt: number;
  done: number;
  waitSum: number;
}

export type LotState = 'pickup' | 'moving' | 'queue' | 'process';

export interface Lot {
  id: number;
  fam: Family;
  /** Step indices this lot goes through. */
  route: number[];
  /** Position in route of the step it is at (−1 before the first). */
  ri: number;
  state: LotState;
  /** Node where it waits for pickup. */
  at: number;
  machine: Machine | null;
  carrier: Carrier | null;
  released: number;
  since: number;
  procTime: number;
}

export type CarrierState = 'idle' | 'toPickup' | 'load' | 'toDrop' | 'unload' | 'record' | 'other';

export interface Carrier {
  id: number;
  state: CarrierState;
  node: number;
  move: { route: Route; t0: number; t1: number } | null;
  lot: Lot | null;
  busyInt: number;
  moves: number;
  dist: number;
}

interface Request { lot: Lot; from: number; to: Step; t: number }

export interface StepMetrics {
  key: string; name: string; area: string; stage: number; machines: number;
  /** Busy share of total time, and share of time not stopped. */
  util: number; avail: number;
  queueAvg: number; waitAvgMin: number; done: number;
}

export interface Metrics {
  scenario: ScenarioId;
  days: number;
  lotsOut: number;
  lotsPerDay: number;
  wafersPerDay: number;
  chipsPerMonth: number;
  leadTimeH: number;
  wipAvg: number;
  /** Minutes a lot waits from "ready to move" until the carrier arrives, on average. */
  transportWaitMin: number;
  /** Share of lead time spent being processed. */
  flowEfficiency: number;
  fleetUtil: number;
  movesPerDay: number;
  kmPerDay: number;
  bottleneck: string;
  /** OEE of the bottleneck step: availability × performance (busy ÷ available time) × quality (no scrap modelled: 100%). */
  oee: { availability: number; performance: number; quality: number; oee: number };
  steps: StepMetrics[];
}

export interface EngineOptions { params: Params; scenario: ScenarioId; seed?: number }

const graphCache: { g: LaneGraph | null } = { g: null };

/** Graph of lanes with every load port, WIP shelf, the dock and parking spots as named points. */
export function plantGraph(): LaneGraph {
  if (graphCache.g) return graphCache.g;
  const pts: Record<string, P2> = { dock: DOCK_IN };
  for (const s of STEPS) {
    pts[`rack:${s.area}`] = RACKS[s.area];
    for (const t of s.tags) pts[`${s.area}-${t}`] = equip(s.area, t).access!;
  }
  PARKING.forEach((p, i) => (pts[`park:${i}`] = p));
  graphCache.g = createLaneGraph(LANES, pts);
  return graphCache.g;
}

export function createEngine(opts: EngineOptions) {
  const { params, scenario } = opts;
  const { fleet, aiInspection } = scenarioSetup(scenario, params);
  const rng = createRng(opts.seed ?? 1);
  const graph = plantGraph();
  const q = new EventQueue();

  const steps: Step[] = STEPS.map((def, idx) => ({
    idx, def, machines: [], queue: [], minutes: stepMinutes(def, params, aiInspection),
    rack: RACKS[def.area], rackNode: graph.nodeOf(`rack:${def.area}`), enRoute: 0, busyInt: 0, downInt: 0, qInt: 0, done: 0, waitSum: 0,
  }));
  const machines: Machine[] = [];
  for (const s of steps) {
    s.def.tags.forEach((t, i) => {
      const m: Machine = {
        idx: machines.length, eq: equip(s.def.area, t), linked: s.def.linked ? equip(s.def.area, s.def.linked[i]) : undefined,
        step: s, slots: s.def.slots ?? 1, lots: [], node: graph.nodeOf(`${s.def.area}-${t}`),
        down: false, failPending: false, busyInt: 0, downInt: 0, done: 0, stops: 0,
      };
      s.machines.push(m);
      machines.push(m);
    });
  }
  const carriers: Carrier[] = Array.from({ length: Math.max(0, Math.round(fleet.count)) }, (_, id) => ({
    id, state: 'idle', node: graph.nodeOf(`park:${id % PARKING.length}`), move: null, lot: null, busyInt: 0, moves: 0, dist: 0,
  }));

  const lots: Lot[] = [];
  const pending: Request[] = [];
  let nextId = 1;

  // ---- statistics (time integrals since the last reset) ----
  const st = { t0: 0, lastT: 0, wipInt: 0, out: 0, chips: 0, wafers: 0, leadSum: 0, procSum: 0, waitSum: 0, waits: 0 };
  function integrate() {
    const dt = q.now - st.lastT;
    if (dt <= 0) return;
    for (const s of steps) {
      let busy = 0, down = 0;
      for (const m of s.machines) {
        busy += m.lots.length;
        m.busyInt += m.lots.length * dt;
        if (m.down) { down += m.slots; m.downInt += dt; }
      }
      s.busyInt += busy * dt;
      s.downInt += down * dt;
      s.qInt += s.queue.length * dt;
    }
    for (const c of carriers) if (c.state !== 'idle') c.busyInt += dt;
    st.wipInt += lots.length * dt;
    st.lastT = q.now;
  }
  const ev = (dt: number, fn: () => void) => q.in(dt, () => { integrate(); fn(); });

  // ---- release ----
  const mixTot = FAMILIES.reduce((s, f) => s + Math.max(0, params.mix[f]), 0) || 1;
  function pickFamily(): Family {
    let r = rng() * mixTot;
    for (const f of FAMILIES) { r -= Math.max(0, params.mix[f]); if (r < 0) return f; }
    return FAMILIES[FAMILIES.length - 1];
  }
  const interval = 1440 / Math.max(0.1, params.release);
  function release() {
    const fam = pickFamily();
    const lot: Lot = {
      id: nextId++, fam, route: steps.filter(s => !s.def.only || s.def.only(fam)).map(s => s.idx), ri: -1, state: 'pickup',
      at: graph.nodeOf('dock'), machine: null, carrier: null, released: q.now, since: q.now, procTime: 0,
    };
    lots.push(lot);
    requestMove(lot, lot.at);
    ev(interval, release);
  }

  // ---- transport ----
  const travel = (r: Route) => r.length / (fleet.speed * 60) + r.doors * fleet.door;

  function requestMove(lot: Lot, from: number) {
    lot.state = 'pickup';
    lot.at = from;
    lot.since = q.now;
    pending.push({ lot, from, to: steps[lot.route[lot.ri + 1]], t: q.now });
    dispatch();
  }

  const usable = (m: Machine) => !m.down && !m.failPending;
  const freeSlots = (s: Step) => s.machines.reduce((n, m) => n + (usable(m) ? m.slots - m.lots.length : 0), 0);
  const starving = (s: Step) => s.machines.length > 0 && freeSlots(s) - s.queue.length - s.enRoute > 0;

  function dispatch() {
    while (pending.length) {
      const idle = carriers.filter(c => c.state === 'idle');
      if (!idle.length) return;
      let ri = 0;
      if (fleet.dispatch === 'starving') { const k = pending.findIndex(r => starving(r.to)); if (k >= 0) ri = k; }
      const req = pending[ri];
      let best = idle[0], bd = Infinity;
      for (const c of idle) { const d = graph.distance(c.node, req.from); if (d < bd) { bd = d; best = c; } }
      pending.splice(ri, 1);
      assign(best, req);
    }
  }

  function assign(c: Carrier, req: Request) {
    const { lot } = req;
    c.lot = lot;
    lot.carrier = c;
    req.to.enRoute++;
    const r1 = graph.route(c.node, req.from), d1 = travel(r1);
    const busyStart = q.now;
    c.state = 'toPickup';
    c.move = { route: r1, t0: q.now, t1: q.now + d1 };
    c.dist += r1.length;
    ev(d1, () => {
      c.node = req.from;
      c.move = null;
      c.state = 'load';
      st.waitSum += q.now - req.t;
      st.waits++;
      lot.state = 'moving';
      ev(fleet.load, () => {
        const r2 = graph.route(req.from, req.to.rackNode), d2 = travel(r2);
        c.state = 'toDrop';
        c.move = { route: r2, t0: q.now, t1: q.now + d2 };
        c.dist += r2.length;
        ev(d2, () => {
          c.node = req.to.rackNode;
          c.move = null;
          c.state = 'unload';
          ev(fleet.unload, () => {
            c.lot = null;
            c.moves++;
            req.to.enRoute--;
            arrive(lot, req.to);
            const work = q.now - busyStart + fleet.record;
            const other = fleet.share < 1 ? work * (1 - fleet.share) / Math.max(0.05, fleet.share) : 0;
            const free = () => { c.state = 'idle'; dispatch(); };
            if (fleet.record > 0) {
              c.state = 'record';
              ev(fleet.record, () => { if (other > 0) { c.state = 'other'; ev(other, free); } else free(); });
            } else if (other > 0) { c.state = 'other'; ev(other, free); } else free();
          });
        });
      });
    });
  }

  // ---- processing ----
  function arrive(lot: Lot, s: Step) {
    lot.carrier = null;
    lot.ri++;
    lot.state = 'queue';
    lot.since = q.now;
    lot.at = s.rackNode;
    s.queue.push(lot);
    tryStart(s);
  }

  function tryStart(s: Step) {
    while (s.queue.length) {
      let m: Machine | null = null;
      for (const x of s.machines) if (usable(x) && x.lots.length < x.slots && (!m || x.lots.length < m.lots.length)) m = x;
      if (!m && s.machines.length) return;
      const lot = s.queue.shift()!;
      s.waitSum += q.now - lot.since;
      lot.state = 'process';
      lot.machine = m;
      lot.since = q.now;
      if (m) m.lots.push(lot);
      const f = s.def.factor ? FAMILY_INFO[lot.fam][s.def.factor] : 1;
      const dur = s.minutes * f * (s.def.slots ? 1 : 0.9 + 0.2 * rng());
      ev(dur, () => finish(lot, s, m, dur));
    }
  }

  function finish(lot: Lot, s: Step, m: Machine | null, dur: number) {
    if (m) {
      m.lots.splice(m.lots.indexOf(lot), 1);
      m.done++;
      if (m.failPending && !m.lots.length) { m.failPending = false; stop(m); }
    }
    s.done++;
    lot.machine = null;
    lot.procTime += dur;
    if (lot.ri === lot.route.length - 1) {
      lots.splice(lots.indexOf(lot), 1);
      st.out++;
      st.wafers += WAFERS_PER_LOT;
      st.chips += WAFERS_PER_LOT * FAMILY_INFO[lot.fam].chipsPerWafer;
      st.leadSum += q.now - lot.released;
      st.procSum += lot.procTime;
    } else requestMove(lot, m ? m.node : s.rackNode);
    tryStart(s);
  }

  // ---- failures: exponential time between failures and repair, set by availability and MTTR ----
  const avail = Math.min(1, Math.max(0.5, params.avail));
  const mttr = Math.max(1, params.mttr);
  const mtbf = avail >= 0.999 ? Infinity : (mttr * avail) / (1 - avail);
  const expo = (mean: number) => -Math.log(1 - rng()) * mean;
  function scheduleFailure(m: Machine) {
    if (!isFinite(mtbf)) return;
    ev(expo(mtbf), () => { if (m.lots.length) m.failPending = true; else stop(m); });
  }
  function stop(m: Machine) {
    m.down = true;
    m.stops++;
    ev(expo(mttr), () => { m.down = false; scheduleFailure(m); tryStart(m.step); dispatch(); });
  }

  // ---- control ----
  function resetStats() {
    integrate();
    Object.assign(st, { t0: q.now, lastT: q.now, wipInt: 0, out: 0, chips: 0, wafers: 0, leadSum: 0, procSum: 0, waitSum: 0, waits: 0 });
    for (const s of steps) Object.assign(s, { busyInt: 0, downInt: 0, qInt: 0, done: 0, waitSum: 0 });
    for (const m of machines) Object.assign(m, { busyInt: 0, downInt: 0, done: 0, stops: 0 });
    for (const c of carriers) Object.assign(c, { busyInt: 0, moves: 0, dist: 0 });
  }

  /** Advance the plant to time t (minutes). */
  function advanceTo(t: number) {
    q.runUntil(t);
    integrate();
  }

  function metrics(): Metrics {
    const T = Math.max(1e-9, q.now - st.t0), days = T / 1440;
    const sm: StepMetrics[] = steps.map(s => {
      const slots = s.machines.reduce((n, m) => n + m.slots, 0);
      return {
        key: s.def.key, name: s.def.name, area: s.def.area, stage: s.def.stage, machines: s.machines.length,
        util: slots ? s.busyInt / (slots * T) : 0, avail: slots ? 1 - s.downInt / (slots * T) : 1,
        queueAvg: s.qInt / T, waitAvgMin: s.done ? s.waitSum / s.done : 0, done: s.done,
      };
    });
    const bott = sm.reduce((a, b) => (b.util > a.util ? b : a), sm[0]);
    const perf = bott.avail > 0 ? Math.min(1, bott.util / bott.avail) : 0;
    const moves = carriers.reduce((n, c) => n + c.moves, 0);
    return {
      scenario, days, lotsOut: st.out, lotsPerDay: st.out / days, wafersPerDay: st.wafers / days, chipsPerMonth: (st.chips / days) * 30,
      leadTimeH: st.out ? st.leadSum / st.out / 60 : 0, wipAvg: st.wipInt / T,
      transportWaitMin: st.waits ? st.waitSum / st.waits : 0, flowEfficiency: st.leadSum ? st.procSum / st.leadSum : 0,
      fleetUtil: carriers.length ? carriers.reduce((n, c) => n + c.busyInt, 0) / (carriers.length * T) : 0,
      movesPerDay: moves / days, kmPerDay: carriers.reduce((n, c) => n + c.dist, 0) / 1000 / days,
      bottleneck: bott.key,
      oee: { availability: bott.avail, performance: perf, quality: 1, oee: bott.avail * perf },
      steps: sm,
    };
  }

  /** Where a carrier is at time t (on its route, or parked at its node). */
  function carrierPos(c: Carrier, t: number) {
    if (c.move) {
      const s = Math.min(c.move.route.length, Math.max(0, (t - c.move.t0) * fleet.speed * 60));
      return pointAlong(c.move.route, s);
    }
    const p = graph.pos(c.node);
    return { x: p.x, z: p.z, dx: 0, dz: 0 };
  }

  machines.forEach(scheduleFailure);
  release();

  return {
    params, scenario, fleet, aiInspection, steps, machines, carriers, lots, graph,
    get now() { return q.now; },
    get pending() { return pending.length; },
    get statsStart() { return st.t0; },
    advanceTo, resetStats, metrics, carrierPos,
  };
}

export type Engine = ReturnType<typeof createEngine>;

/** Warm-up, then measure: the plant starts empty, so the first days are not representative. */
export const WARMUP_DAYS = 7;

export function runScenario(params: Params, scenario: ScenarioId, days = 14, seed = 1): Metrics {
  const e = createEngine({ params, scenario, seed });
  e.advanceTo(WARMUP_DAYS * 1440);
  e.resetStats();
  e.advanceTo((WARMUP_DAYS + days) * 1440);
  return e.metrics();
}

/** Equipment with a role in the route (for the 3D: which ones get a status light). */
export const ROUTE_EQUIPMENT = new Set(STEPS.flatMap(s => [...s.tags, ...(s.linked ?? [])].map(t => `${s.area}-${t}`)));
export const LAB_EQUIPMENT = EQUIPMENT.filter(e => e.counted && e.access && !ROUTE_EQUIPMENT.has(`${e.area}-${e.tag}`));
