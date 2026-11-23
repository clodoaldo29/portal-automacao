// Intellifix AI · the cell in time: pallets on the roller conveyor (pre-stop, stop), vision, the two UR10e following
// the screw plan from balance.ts, torque/angle and visual check of every screw, verdict per TV (NOK: red light and
// retention for rework), Torque Flow records per serial number, and the indicators.
import * as THREE from 'three';
import { createRng } from '../../sim/des';
import { ease } from '../../sim/math';
import { makeLine, station, updateLine, type LineItem } from '../../sim/line';
import { capsuleBoxGap, capsuleGap, jointPoints, linkCapsules } from '../../sim/robots/collision';
import { poseAt, urTrack } from '../../sim/robots/ur-arm';
import { Track, line } from '../../sim/track';
import { DEFAULT_TIMING, plan, type CyclePlan, type TimingParams } from './balance';
import { BACK_Y, LAY, type Cell, type PalletObj } from './cell';
import { MODELS, requiredCycleS, robotHome, screwPoints, tvsPerPallet, type ScrewPoint, type TvModel } from './model';
import { TIP } from './tool';

export type FeedMode = 'linha' | 'max';
export interface SimParams {
  /** Model id (MODELS). */
  model: string;
  /** Screws per TV, per model id (missing: the PUR value). */
  screws: Record<string, number>;
  timing: TimingParams;
  /** Share of NOK screws. */
  nok: number;
  /** Rework time per NOK TV (operator at the cell, red light on). */
  reworkS: number;
  /** Pallets arrive at the line's cadence ('linha') or as fast as the cell takes them ('max', capacity test). */
  feed: FeedMode;
}
export const DEFAULT_SIM: SimParams = { model: 'TL056', screws: {}, timing: { ...DEFAULT_TIMING }, nok: 0.004, reworkS: 25, feed: 'linha' };
/** NOK share when "Simular NOK" is on. */
export const NOK_HIGH = 0.04;

export const CLASSES = {
  C01: 'OK', C02: 'Ausência de parafuso', C03: 'Parafuso parcialmente inserido', C04: 'Parafuso desalinhado', C05: 'Cabeça danificada', C06: 'Dano na região de fixação',
} as const;
export type Cls = keyof typeof CLASSES;
const NOK_MIX: [Cls, number][] = [['C02', 0.2], ['C03', 0.3], ['C04', 0.25], ['C05', 0.15], ['C06', 0.1]];
/** Acceptance windows: M4 in the plastic boss, and the self-tapping screw (PROVISIONAL, from each drawing later). */
export const WINDOW = { std: { t: [1.05, 1.35], a: [600, 900], t0: 1.2, a0: 720 }, tap: { t: [1.4, 1.8], a: [780, 1050], t0: 1.6, a0: 900 } } as const;

export interface ScrewResult { i: number; tv: number; robot: 0 | 1; torque: number; angle: number; cls: Cls; ok: boolean; selfTap: boolean }
export interface TvRecord { serial: string; model: string; ok: boolean; reworked: boolean; screws: number; nok: number; points: ScrewResult[]; t: number }

interface Pallet extends LineItem {
  p: PalletObj; model: TvModel; points: ScrewPoint[]; serials: string[]; res: (ScrewResult | null)[]; age: number;
}

export const modelOf = (id: string) => MODELS.find(m => m.id === id) ?? MODELS[2];
export const screwsOf = (params: SimParams, m: TvModel) => params.screws[m.id] ?? m.screws;

const newStats = () => ({
  t: 0, tvs: 0, tvsOk: 0, tvsNok: 0, screws: [0, 0], busy: [0, 0], zoneWait: 0, reworkT: 0, starvedT: 0, waitLineT: 0,
  pallets: 0, cycleSum: 0, lastRelease: -1, cls: { C01: 0, C02: 0, C03: 0, C04: 0, C05: 0, C06: 0 } as Record<Cls, number>,
  minArmArm: Infinity, minClear: Infinity, minClearAt: '', maxIkErr: 0,
});
export type SimStats = ReturnType<typeof newStats>;

/** `canExit`: integrated flow, the pallet waits at the end of the conveyor until the Transfer Flow belt can take it. */
export function createSim(cell: Cell, scene: THREE.Scene, params: SimParams, opts: { onExit?: (tvs: number, model: TvModel) => void; canExit?: () => boolean } = {}) {
  const { X, Z, arms, tools } = cell;
  let stats = newStats();
  const rng = createRng(7);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng() + 1e-12)) * Math.cos(2 * Math.PI * rng());
  let serialN = 0;
  const log: TvRecord[] = [];

  // ---------- conveyor ----------
  const track = new Track([line(X(LAY.x0), Z(0), X(cell.x1), Z(0))], false);
  const L = makeLine<Pallet>({
    track, speed: 0.6, gap: LAY.pal.l + 0.05, tex: null, y: LAY.top,
    onExit: it => { scene.remove(it.p.g); opts.onExit?.(it.serials.length, it.model); },
  });
  const sOf = (x: number) => x - LAY.x0;
  let claim: Pallet | null = null, atStop: Pallet | null = null, atPre: Pallet | null = null;
  station(L, sOf(LAY.preX), it => { if (claim) return true; claim = it; return false; }, it => { atPre = it; });
  station(L, sOf(LAY.stopX), () => true, it => { atStop = it; startJob(it); });
  const endSt = opts.canExit ? station(L, track.length - 1e-4, () => !opts.canExit!(), () => {}) : null;
  const setSpeed = () => { L.speed = (LAY.stopX - LAY.preX) / Math.max(1, params.timing.exchangeS); };
  setSpeed();

  // ---------- the job at the stop ----------
  type Phase = 'empty' | 'vision' | 'work' | 'rework';
  let phase: Phase = 'empty', phaseT = 0, job: { it: Pallet; plan: CyclePlan; next: number[]; nokTvs: number } | null = null;
  let stopperDownT = 0;

  function makePalletItem(): Pallet {
    const model = modelOf(params.model), n = screwsOf(params, model), points = screwPoints(model, n);
    const p = cell.makePallet(model, points);
    const serials = Array.from({ length: tvsPerPallet(model.inch) }, () => `${model.id}-${String(++serialN).padStart(6, '0')}`);
    return { obj: p.g, s: 0, hold: null, passed: new Set(), p, model, points, serials, res: points.map(() => null), age: 0 };
  }

  function startJob(it: Pallet) {
    const n = it.points.length / tvsPerPallet(it.model.inch);
    job = { it, plan: plan(it.model, params.timing, n), next: [0, 0], nokTvs: 0 };
    phase = 'vision'; phaseT = 0;
  }

  /** Torque, angle and visual class of one screw (drawn when it is driven). */
  function driveResult(pt: ScrewPoint, robot: 0 | 1, i: number): ScrewResult {
    const w = pt.selfTap ? WINDOW.tap : WINDOW.std;
    let cls: Cls = 'C01', torque = w.t0 + gauss() * 0.035, angle = w.a0 + gauss() * 28;
    if (rng() < params.nok) {
      let u = rng();
      for (const [c, p] of NOK_MIX) { if ((u -= p) <= 0) { cls = c; break; } }
      if (cls === 'C01') cls = 'C06';
      if (cls === 'C02') { torque = 0.04; angle = 0; }
      else if (cls === 'C03') { angle = w.a[0] - 140 - rng() * 120; }
      else if (cls === 'C04') { torque = w.t[1] + 0.12 + rng() * 0.2; angle = w.a[0] - 60 - rng() * 80; }
    }
    const inWin = torque >= w.t[0] && torque <= w.t[1] && angle >= w.a[0] && angle <= w.a[1];
    return { i, tv: pt.tv, robot, torque, angle, cls, ok: cls === 'C01' && inWin, selfTap: pt.selfTap };
  }
  const indexOf = (it: Pallet, pt: ScrewPoint) => it.points.findIndex(q => q.tv === pt.tv && q.idx === pt.idx);

  function finishJob() {
    const it = job!.it, n = it.points.length / it.serials.length;
    let nokTvs = 0;
    it.serials.forEach((serial, tv) => {
      const pts = it.res.filter((r): r is ScrewResult => !!r && r.tv === tv), nok = pts.filter(r => !r.ok).length;
      if (nok) nokTvs++;
      stats.tvs++; if (nok) stats.tvsNok++; else stats.tvsOk++;
      log.unshift({ serial, model: it.model.id, ok: !nok, reworked: false, screws: n, nok, points: pts.sort((a, b) => a.i - b.i), t: stats.t });
    });
    if (log.length > 12) log.length = 12;
    job!.plan.robots.forEach((r, k) => { stats.busy[k] += r.endS - r.waitS; stats.zoneWait += r.waitS; });
    job!.nokTvs = nokTvs;
    if (nokTvs) { phase = 'rework'; phaseT = 0; } else release();
  }

  function release() {
    const it = job!.it;
    // rework done: the NOK screws are corrected by the operator (marks turn green); the record keeps the first result
    it.res.forEach((r, i) => { if (r && !r.ok) { it.p.marks[i].material = cell.markMats.ok; it.p.screws[i].visible = true; } });
    if (job!.nokTvs) log.filter(r => it.serials.includes(r.serial) && !r.ok).forEach(r => { r.reworked = true; });
    it.hold = null;
    if (stats.lastRelease >= 0) { stats.cycleSum += stats.t - stats.lastRelease; stats.pallets++; }
    stats.lastRelease = stats.t;
    atStop = null; claim = null; job = null; phase = 'empty'; phaseT = 0;
    stopperDownT = 0.6;
    if (atPre) { claim = atPre; atPre.hold = null; atPre = null; }
  }

  // ---------- robots ----------
  const travel = LAY.travel, homeLift = LAY.homeLift;
  const feederLocal = cell.feeders.map(f => ({ x: f.x - X(LAY.stopX), z: f.z - Z(0) }));
  interface ToolState { x: number; z: number; lift: number; drive: boolean; flash: boolean }
  function toolAt(r: 0 | 1, tau: number): ToolState {
    const home = robotHome(r);
    if (!job || phase !== 'work' || tau <= 0) return { x: home.x, z: home.z, lift: homeLift, drive: false, flash: phase === 'vision' && phaseT > params.timing.visionS * 0.3 && phaseT < params.timing.visionS * 0.7 };
    const rp = job.plan.robots[r];
    let px = home.x, pz = home.z, pl = homeLift, lastDone = 0;
    for (const t of rp.tasks) {
      if (tau < t.moveStart) return { x: px, z: pz, lift: pl, drive: false, flash: false };
      if (tau < t.arrive) {
        const u = ease((tau - t.moveStart) / (t.arrive - t.moveStart));
        if (params.timing.feed === 'pick') { // via the feeder outlet
          const f = feederLocal[r];
          if (u < 0.5) { const v = u * 2; return { x: px + (f.x - px) * v, z: pz + (f.z - pz) * v, lift: pl + (homeLift + 0.1 - pl) * v, drive: false, flash: false }; }
          const v = (u - 0.5) * 2;
          return { x: f.x + (t.p.x - f.x) * v, z: f.z + (t.p.z - f.z) * v, lift: homeLift + 0.1 + (travel - homeLift - 0.1) * v, drive: false, flash: false };
        }
        return { x: px + (t.p.x - px) * u, z: pz + (t.p.z - pz) * u, lift: pl + (travel - pl) * u + 0.04 * Math.sin(Math.PI * u), drive: false, flash: false };
      }
      if (tau < t.done) {
        const d = tau - t.arrive, D = t.done - t.arrive;
        if (d < 0.3) return { x: t.p.x, z: t.p.z, lift: travel * (1 - ease(d / 0.3)), drive: false, flash: false };
        if (d < D - 0.2) return { x: t.p.x, z: t.p.z, lift: 0, drive: true, flash: false };
        return { x: t.p.x, z: t.p.z, lift: travel * ease((d - (D - 0.2)) / 0.2), drive: false, flash: d > D - 0.12 };
      }
      px = t.p.x; pz = t.p.z; pl = travel; lastDone = t.done;
    }
    if (tau < rp.endS) {
      const u = ease((tau - lastDone) / Math.max(1e-6, rp.endS - lastDone));
      return { x: px + (home.x - px) * u, z: pz + (home.z - pz) * u, lift: pl + (homeLift - pl) * u, drive: false, flash: false };
    }
    return { x: home.x, z: home.z, lift: homeLift, drive: false, flash: false };
  }
  const toolNow: ToolState[] = [toolAt(0, 0), toolAt(1, 0)];
  let ik = true, ikIters = 12, clearEvery = 0, check = false;
  function moveArms(dt: number) {
    const tau = phase === 'work' ? phaseT : 0;
    for (const r of [0, 1] as const) {
      const ts = toolAt(r, tau);
      toolNow[r] = ts;
      if (!ik) continue;
      const arm = arms[r];
      const err = urTrack(arm, [...poseAt(arm, X(LAY.stopX + ts.x), Z(ts.z), BACK_Y + TIP + ts.lift), 0, 0], ikIters);
      if (stats.t > 2 && err > stats.maxIkErr) stats.maxIkErr = err;
      tools[r].spin(dt, ts.drive);
    }
    if (!ik || !check) return;
    // collision check every 2nd step: the arms as drawn and the screwdrivers with their cameras, against each other
    // and against everything in the cell
    if (++clearEvery % 2) return;
    const c = measureClearance();
    if (c.arm < stats.minArmArm) stats.minArmArm = c.arm;
    if (c.min < stats.minClear) { stats.minClear = c.min; stats.minClearAt = c.at; }
  }

  // ---------- collision check ----------
  const LINK = ['base', 'ombro', 'braço', 'antebraço', 'punho 1', 'punho 2', 'punho 3'];
  // the back cover itself (the slab of the pallet obstacle reaches the back bumps): the tool body must stay above it
  const coverTop = BACK_Y + 0.005;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  /** Screwdriver in the flange frame: body with transducer, spindle, nose (touches the screw), camera with ring. */
  const TOOL_PARTS: [string, number, number, number, number, number][] = [
    ['parafusadeira', 0, -0.01, -0.235, 0.045, 0], ['bico', 0, -0.25, -0.30, 0.024, 1],
    ['nariz', 0, -0.30, -TIP + 0.012, 0.02, 2], ['câmera', -0.07, -0.17, -0.245, 0.04, 0],
  ];
  function robotCaps(r: 0 | 1) {
    const caps: { a: THREE.Vector3; b: THREE.Vector3; r: number; name: string; link: number; tip: number }[] =
      linkCapsules(arms[r], 0.01).map(c => ({ ...c, name: `robô ${r + 1} · ${LINK[c.link]}`, tip: 0 }));
    const m = arms[r].mount;
    m.updateWorldMatrix(true, false);
    for (const [name, x, y0, y1, rad, tip] of TOOL_PARTS) {
      caps.push({ a: _a.set(x, y0, 0).applyMatrix4(m.matrixWorld).clone(), b: _b.set(x, y1, 0).applyMatrix4(m.matrixWorld).clone(), r: rad + 0.005, name: `robô ${r + 1} · ${name}`, link: 7, tip });
    }
    return caps;
  }
  /** Smallest clearance now: overall, and between the two robots; `worst` keeps every pair below 5 cm. */
  function measureClearance(worst?: Map<string, number>) {
    let min = Infinity, at = '', arm = Infinity;
    const note = (d: number, what: string) => {
      if (d < min) { min = d; at = what; }
      if (worst && d < 0.05) worst.set(what, Math.min(worst.get(what) ?? Infinity, d));
    };
    const caps = [robotCaps(0), robotCaps(1)];
    for (const r of [0, 1] as const) for (const c of caps[r]) for (const o of cell.obstacles) {
      if (o.name === `pedestal do robô ${r + 1}` && c.link <= 1) continue; // its own base on its own pedestal
      if (o.name === 'pallet e TVs' && c.link === 7) { // the tool: only the nose touches the screw head
        if (c.tip === 2) continue;
        const top = o.box.max.y;
        o.box.max.y = coverTop;
        note(capsuleBoxGap(c, o), `${c.name} × tampa traseira da TV`);
        o.box.max.y = top;
        continue;
      }
      note(capsuleBoxGap(c, o), `${c.name} × ${o.name}`);
    }
    // each arm against itself: links that are not neighbours, and the screwdriver against the base, shoulder, arms
    for (const r of [0, 1] as const) for (const s of caps[r]) for (const t of caps[r]) {
      if (s.link < t.link && t.link - s.link >= 3 && (t.link < 7 || s.link <= 3)) note(capsuleGap(s, t), `${s.name} × ${t.name}`);
    }
    for (const s of caps[0]) for (const t of caps[1]) {
      const d = capsuleGap(s, t);
      if (d < arm) arm = d;
      note(d, `${s.name} × ${t.name}`);
    }
    return { min, at, arm };
  }

  // ---------- feeding ----------
  let feedT = 0, backlog = 0;
  function feed(dt: number) {
    const model = modelOf(params.model);
    if (params.feed === 'linha') {
      feedT += dt;
      const takt = requiredCycleS(model);
      while (feedT >= takt) { feedT -= takt; backlog++; }
    } else backlog = Math.max(backlog, 1);
    const minS = L.items.reduce((m, it) => Math.min(m, it.s), Infinity);
    if (backlog > 0 && minS >= L.gap - 1) { // the next pallet rises in the entry lift (s < 0) while the belt has room
      const it = makePalletItem();
      it.s = -1; L.items.push(it); backlog--;
    }
    if (params.feed === 'linha' && backlog > 0) stats.waitLineT += dt; // the line upstream waits for the cell
  }

  // ---------- step ----------
  function step(dt: number) {
    stats.t += dt;
    feed(dt);
    if (endSt) for (const it of L.items) if (it.hold === endSt && opts.canExit!()) it.hold = null;
    updateLine(L, dt);
    for (const it of L.items) { it.age += dt; if (it.s < 0) it.obj.position.y = LAY.top - 0.8 * Math.min(1, -it.s); }
    phaseT += dt;
    if (phase === 'empty') { if (!claim) stats.starvedT += dt; }
    else if (phase === 'vision' && phaseT >= params.timing.visionS) { phase = 'work'; phaseT = 0; }
    else if (phase === 'work') {
      // screws completed in this step
      for (const r of [0, 1] as const) {
        const tasks = job!.plan.robots[r].tasks;
        while (job!.next[r] < tasks.length && phaseT >= tasks[job!.next[r]].done) {
          const t = tasks[job!.next[r]++], i = indexOf(job!.it, t.p), res = driveResult(t.p, r, i);
          job!.it.res[i] = res;
          stats.screws[r]++; stats.cls[res.cls]++;
          const p = job!.it.p;
          p.screws[i].visible = res.cls !== 'C02';
          p.marks[i].material = res.ok ? cell.markMats.ok : cell.markMats.nok;
          p.marks[i].visible = true;
        }
        const t = tasks[job!.next[r]];
        if (t && phaseT >= t.arrive + 0.3) job!.it.p.screws[indexOf(job!.it, t.p)].visible = true; // the screw goes in
      }
      if (phaseT >= Math.max(job!.plan.robots[0].endS, job!.plan.robots[1].endS)) finishJob();
    } else if (phase === 'rework') {
      stats.reworkT += dt;
      if (phaseT >= params.reworkS * job!.nokTvs) release();
    }
    if (stopperDownT > 0) stopperDownT -= dt;
    moveArms(dt);
  }

  // ---------- visuals once per frame ----------
  const hoseMat = new THREE.MeshStandardMaterial({ color: 0x2a6fdb, roughness: 0.5, metalness: 0.05 });
  const hoses = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.BufferGeometry(), hoseMat); m.castShadow = true; scene.add(m); return m; });
  const _pt = new THREE.Vector3();
  let hmiT = 1;
  function frame(dt: number, time: number) {
    cell.andons.update(time);
    cell.andon.state = phase === 'rework' ? 'alarm' : phase === 'empty' ? 'wait' : 'run';
    cell.stoppers[1].position.y = LAY.top - 0.01 - (stopperDownT > 0 ? 0.05 : 0);
    cell.stoppers[0].position.y = LAY.top - 0.01 - (atPre ? 0 : claim ? 0.05 : 0);
    cell.sensorLeds[0].material = atPre ? cell.sensorOn : cell.sensorOff;
    cell.sensorLeds[1].material = atStop ? cell.sensorOn : cell.sensorOff;
    for (const r of [0, 1] as const) {
      tools[r].flash(toolNow[r].flash);
      // feed hose: feeder outlet → up the pedestal → clipped along the upper arm and the forearm → screwdriver nose
      // (as on a real cell: a loose hose would sweep through the other arm)
      tools[r].port.getWorldPosition(_pt);
      const f = cell.feeders[r], base = arms[r].root.position, j = jointPoints(arms[r]);
      const up = (p: THREE.Vector3, dy: number) => p.clone().setY(p.y + dy);
      const pts = [f.clone(), new THREE.Vector3(f.x * 0.4 + base.x * 0.6, LAY.ped - 0.1, f.z * 0.4 + base.z * 0.6)];
      if (j.length) pts.push(up(j[1], 0.12), up(j[2].clone().lerp(j[3], 0.5), 0.1), up(j[3], 0.1), up(j[4], 0.08), up(j[5], 0.03));
      pts.push(_pt.clone());
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      hoses[r].geometry.dispose();
      hoses[r].geometry = new THREE.TubeGeometry(curve, 24, 0.006, 6, false);
    }
    if ((hmiT += dt) > 0.5) {
      hmiT = 0;
      const m = modelOf(params.model), last = log[0];
      const state = phase === 'rework' ? 'NOK · RETIDO P/ RETRABALHO' : phase === 'vision' ? 'VISÃO · LOCALIZANDO TV' : phase === 'work' ? 'PARAFUSANDO' : 'AGUARDANDO PALLET';
      const color = phase === 'rework' ? '#ef4444' : phase === 'empty' ? '#f59e0b' : '#22c55e';
      cell.drawHmi({ title: 'INTELLIFIX AI · LTV01', state, color, rows: [
        ['Modelo', `${m.id} · ${m.inch}″`], ['Parafusos', `${screwsOf(params, m)} por TV`],
        ['Nº de série', job ? job.it.serials.map(s => s.slice(-6)).join(' / ') : '—'],
        ['Último', last ? `${last.serial.slice(-6)} ${last.ok ? 'OK' : 'NOK'}` : '—'],
      ] });
    }
  }

  function reset() {
    for (const it of L.items) scene.remove(it.p.g);
    L.items.length = 0;
    claim = atStop = atPre = null; job = null; phase = 'empty'; phaseT = 0; backlog = 0; feedT = 0;
    setSpeed();
    stats = newStats();
    log.length = 0;
  }
  function resetStats() { stats = newStats(); log.length = 0; }

  function robotState(r: 0 | 1) {
    if (phase === 'vision') return 'visão: localizando a TV';
    if (phase === 'rework') return 'em casa · retrabalho';
    if (phase !== 'work' || !job) return 'em casa';
    const rp = job.plan.robots[r], tau = phaseT;
    if (tau >= rp.endS) return 'em casa';
    const k = rp.tasks.findIndex(t => tau < t.done);
    if (k < 0) return 'voltando para casa';
    const t = rp.tasks[k];
    if (tau < t.moveStart) return 'aguarda a faixa central';
    return `${tau < t.arrive ? 'indo ao' : 'parafusando o'} ponto ${k + 1}/${rp.tasks.length}`;
  }

  return {
    step, frame, reset, resetStats, setSpeed, robotState, L, log,
    get stats() { return stats; },
    get phase() { return phase; },
    get job() { return job; },
    setIk(on: boolean, iters = 12) { ik = on; ikIters = iters; },
    /** Collision check during the run (bench, tests); `measure` checks now. */
    setCheck(on: boolean) { check = on; },
    measure: (worst?: Map<string, number>) => measureClearance(worst),
  };
}
export type Sim = ReturnType<typeof createSim>;
