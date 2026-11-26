// Smart Pack · Grupo Multi: TV packing after the functional test, stations 1 to 4 of the TO-BE flow (v4).
//
// URL options:
//   ?model=65   start with that model (lot)
//   ?bench=10   run 10 simulated minutes at once (default parameters) and publish window.__spBench;
//               &feed=max measures the capacity (TVs as fast as station 1 takes them)
import { pct } from '../../sim/kpi';
import { useHDRI } from '../../sim/robots/ur-arm';
import { $ } from '../../sim/ui/dom';
import { createPage } from '../../sim/ui/page';
import { DEFAULT_TIMING, FONT, INCHES, LABELS, SHADOW_FRUSTUM, TOUR, VIEWS, type Feed, type Inch } from './config';
import { setVia } from './robot';
import type { Params } from './types';
import { DEFAULT_PARAMS, createWorld, lineRate, resetLine, resetStats, startClearance, step } from './world';

const page = createPage({ stage: { shadowFrustum: SHADOW_FRUSTUM }, font: FONT });
const { stage, query } = page;
const benchMin = page.num('bench');

// ---------- parameters (saved in this browser) ----------
const PKEY = 'smartpack.params.v1';
const params: Params = { ...DEFAULT_PARAMS, timing: { ...DEFAULT_TIMING } };
if (!benchMin) {
  try {
    const s = JSON.parse(localStorage.getItem(PKEY) || 'null');
    if (s && typeof s === 'object') Object.assign(params, s, { timing: { ...DEFAULT_TIMING, ...(s.timing ?? {}) } });
  } catch { /* defaults */ }
}
const qModel = Number(query.get('model')) as Inch;
if (INCHES.includes(qModel)) params.inch = qModel;
if (!INCHES.includes(params.inch)) params.inch = DEFAULT_PARAMS.inch;
if (benchMin && query.get('feed') === 'max') params.feed = 'max'; // capacity: TVs as fast as station 1 takes them
const save = () => { if (!benchMin) try { localStorage.setItem(PKEY, JSON.stringify(params)); } catch { /* not saved */ } };

const qVia = (query.get('via') || '').split(',').map(Number); // (bench: try another via point, ?via=reach,height)
if (benchMin && qVia.length === 2 && qVia.every(Number.isFinite)) setVia(qVia[0], qVia[1]);
const { world: w, andons, lights, ceiling } = createWorld(stage, params);

// ---------- controls ----------
const modelSel = $<HTMLSelectElement>('model');
modelSel.value = String(params.inch);
// a model change is a lot change: the line restarts empty and the indicators from zero
modelSel.addEventListener('change', () => { params.inch = Number(modelSel.value) as Inch; save(); resetLine(w); warmUp(); panel(); });
const feedSel = $<HTMLSelectElement>('p-feed'), bagIn = $<HTMLInputElement>('p-bag');
const writeForm = () => { feedSel.value = params.feed; bagIn.value = String(params.timing.bagS); };
writeForm();
$<HTMLFormElement>('params').addEventListener('submit', e => {
  e.preventDefault();
  params.feed = (feedSel.value === 'max' ? 'max' : 'linha') as Feed;
  const b = Number(bagIn.value);
  params.timing.bagS = Number.isFinite(b) && bagIn.value !== '' ? Math.min(60, Math.max(4, b)) : DEFAULT_TIMING.bagS;
  writeForm();
  save();
  resetLine(w);
  warmUp();
  panel();
  $('p-status').textContent = 'Aplicado. A linha reiniciou e os indicadores foram zerados.';
});

// ---------- panel ----------
const rows = $<HTMLTableSectionElement>('st-rows');
const NAMES = ['1 · Robô de transferência', '2 · Ensacadora', '3 · Verticalização', '4 · Cobertura'];
const trs = NAMES.map(n => { const tr = rows.insertRow(); tr.insertCell().textContent = n; tr.insertCell(); tr.insertCell(); return tr; });
function panel() {
  const s = w.stats, T = Math.max(1, s.simT), measured = s.simT > 60 && s.packed > 1;
  const uph = measured ? (s.packed / s.simT) * 3600 : null, target = lineRate(w);
  $('k-rate').textContent = uph == null ? '—' : String(Math.round(uph));
  $('k-target').textContent = String(target);
  $('k-pct').textContent = uph == null ? '—' : pct(Math.min(1, uph / target));
  $('k-packed').textContent = String(s.packed);
  $('k-cycle').textContent = uph == null ? '—' : `${(3600 / uph).toFixed(1)} s`;
  $('k-takt').textContent = `${(3600 / target).toFixed(1)} s`;
  const r = w.robot;
  const state = [
    r.state === 'busy' ? (r.carried ? 'com a TV' : 'pegando / voltando') : 'aguardando TV',
    w.bagger.item ? 'ensacando' : 'livre',
    w.clamp.tv ? 'descendo a TV na base' : w.upender.tilted ? 'TV em pé' : w.upender.tv ? 'girando' : 'livre',
    w.gantry.cover ? (w.gantry.target ? 'cobrindo' : 'cobertura pronta') : w.gantry.seq.length ? 'pegando cobertura' : 'livre',
  ];
  const uses = [r.busyT / T, s.bagT / T, s.upT / T, s.gantryT / T];
  trs.forEach((tr, i) => { tr.cells[1].textContent = pct(Math.min(1, uses[i])); tr.cells[2].textContent = state[i]; });
  $('k-flow').textContent = `${s.picked} retiradas · ${s.bagged} ensacadas · ${s.boxed} na base · ${s.packed} cobertas`;
}

// ---------- start ----------
const warmUp = () => { for (let i = 0; i < 600; i++) step(w, 1 / 30); resetStats(w); }; // 20 s: the line is moving when it opens
warmUp();
page.start({
  first: 'linha', views: VIEWS, tour: TOUR, labels: LABELS,
  step: dt => step(w, dt),
  frame: () => {
    lights.bagger.state = w.bagger.item ? 'run' : 'wait';
    lights.upender.state = w.upender.seq.length || w.clamp.seq.length ? 'run' : 'wait';
    lights.gantry.state = w.gantry.seq.length ? 'run' : 'wait';
    andons.update(performance.now() / 1000);
    ceiling.visible = stage.camera.position.y < 12.4;
  },
  panel,
  shotName: (W, H) => `smart-pack-${w.params.inch}pol-${W}x${H}.png`,
});

declare global {
  interface Window {
    __sp: unknown;
    __spBench?: { inch: Inch; minutes: number; picked: number; bagged: number; boxed: number; packed: number; maxIkErr: number; minClear: number; minClearAt: string; near: string[]; ms: number };
  }
}
window.__sp = { world: w, stage, step: (dt: number) => step(w, dt), resetLine: () => resetLine(w), resetStats: () => resetStats(w), panel };
(window as unknown as { __capa: () => void }).__capa = () => { stage.camera.position.set(-4.2, 6.6, 6.0); stage.controls.target.set(5.2, 0.7, -2.4); stage.controls.update(); };

if (benchMin) {
  const t0 = performance.now();
  startClearance(w); // nothing may touch: the bench measures the smallest clearance of station 1 over the whole run
  for (let i = 0, n = Math.round(benchMin * 60 * 30); i < n; i++) step(w, 1 / 30);
  const s = w.stats, c = w.clear!;
  window.__spBench = {
    inch: w.params.inch, minutes: benchMin, picked: s.picked, bagged: s.bagged, boxed: s.boxed, packed: s.packed,
    maxIkErr: Math.round(w.robot.maxErr * 1e4) / 1e4, minClear: Math.round(c.min * 1000) / 1000, minClearAt: c.at,
    near: [...c.worst].sort((a, b) => a[1] - b[1]).slice(0, 10).map(([k, v]) => `${Math.round(v * 1000)} mm · ${k.replace(/ \d+\]/, ']')}`),
    ms: Math.round(performance.now() - t0),
  };
} else {
  const base = import.meta.env.BASE_URL;
  useHDRI(stage.renderer, stage.scene, `${base}assets/env/empty_warehouse_01_1k.hdr`).catch(err => console.warn('HDRI not loaded; keeping the modelled hall lighting', err));
}
