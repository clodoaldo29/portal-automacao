// Memory Flow 3D · post-dicing AI inspection cell: the proposal for area P01C, shown in place inside the plant.
//
// URL options (for tests and demos):
//   ?bench=30   run that many simulated minutes at once with the default parameters and publish the result in
//               window.__cellBench (skips the original robot meshes and the HDRI)
import * as THREE from 'three';
import { pct } from '../../../sim/kpi';
import { createLabels, type LabelDef } from '../../../sim/labels';
import { createMaterials } from '../../../sim/materials';
import { buildRoom } from '../../../sim/room';
import { useHDRI, useUR10eMeshes } from '../../../sim/robots/ur-arm';
import { createStage } from '../../../sim/stage';
import { $ } from '../../../sim/ui/dom';
import { createShotModal } from '../../../sim/ui/shot-modal';
import { createViews, type ViewDef } from '../../../sim/views';
import { FONT } from '../config';
import { W, buildPlant } from '../plant3d';
import { mountProjectsMenu } from '../projects-menu';
import { DEFAULT_PARAMS, INS_AI_MINUTES, STEPS } from '../process';
import { DEFAULT_CELL_PARAMS, SLOTS, cellRates, createCell, type CellParams } from './cell';
import { CLASSES, drawWafer } from './wafer';

const query = new URLSearchParams(location.search);
const benchMin = Math.max(0, Number(query.get('bench')) || 0);

/**
 * Two pages use this file: inside the plant (projetos/memory-flow-3d/inspecao/, the cell in P01C) and on its own
 * (projetos/adata-inspecao-pos-corte/, <body data-standalone="1">: the cell alone on an ESD floor, no plant).
 */
const standalone = document.body.dataset.standalone === '1';
/** Where the cell goes: P01C, in place of the manual benches INS01 and INS02 (origin when standalone). */
const [OX, OZ] = standalone ? [0, 0] : W(35.9, 55.4);
const origin = new THREE.Vector3(OX, 0, OZ);
const V = (x: number, y: number, z: number): [number, number, number] => [OX + x, y, OZ + z];

const stageEl = $('stage');
const stage = createStage(stageEl, { shadowFrustum: { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 60 }, fog: { near: 40, far: 140 }, floor: { w: 260, d: 220 }, cameraFar: 400, maxDistance: 70 });
// sharp shadows around the cell: the sun follows it
stage.sun.position.set(OX + 6, 30, OZ + 12);
stage.sun.target.position.copy(origin);
stage.scene.add(stage.sun.target);
const M = createMaterials();
if (standalone) buildRoom(stage.scene, { w: 6, d: 5, x: 0.6, z: -0.2, band: 0x2f6fb0, name: 'Front-end · inspeção pós-corte', font: FONT });
else {
  buildPlant(stage.scene, { exclude: e => e.area === 'P01C' && (e.tag === 'INS01' || e.tag === 'INS02'), status: false });
}
const cell = createCell(stage.scene, M, origin, FONT);

// ---------- labels ----------
const LABELS: LabelDef[] = [
  { lines: standalone ? ['Inspeção pós-corte com IA'] : ['Inspeção pós-corte com IA', 'proposta · P01C'], x: OX, y: 2.75, z: OZ - 0.2 },
  { lines: ['UR10e · garra de garfo'], x: OX - 0.6, y: 2.25, z: OZ - 1.0 },
  { lines: ['Cassete de entrada'], x: OX - 0.92, y: 1.55, z: OZ + 0.15 },
  { lines: ['Cassete de saída'], x: OX + 0.92, y: 1.55, z: OZ + 0.15 },
  { lines: ['Mesa XY + câmera'], x: OX, y: 1.95, z: OZ + 0.55 },
];
const labels = createLabels(stage.scene, FONT, { scale: 0.42 });
labels.build(LABELS);
document.fonts?.load(`600 44px "Barlow Semi Condensed"`).then(() => { labels.build(LABELS); cell.drawHmi(); }).catch(() => {});
stage.hiddenInReflection.objects = () => labels.sprites;
stage.hiddenInReflection.restore = () => labels.restore();
stage.finalizeShadows();

// ---------- views ----------
const VIEWS: Record<string, ViewDef> = {
  celula: { pos: V(2.5, 2.2, 3.2), target: V(0, 0.95, 0) },
  robo: { pos: V(-2.3, 2.1, -2.5), target: V(0, 1.0, 0.1) },
  mesa: { pos: V(0.75, 1.75, 1.45), target: V(0, 0.95, 0.35) },
  cassetes: { pos: V(-2.4, 1.7, 1.6), target: V(-0.9, 0.95, 0) },
  ...(standalone ? {} : { planta: { pos: V(14, 15, 24), target: V(0, 0, 0) } }),
  cima: { pos: V(0, 7, 0.01), target: V(0, 0, -0.2) },
};
const TOUR = {
  positions: [V(3.6, 2.6, 4.2), V(-3.4, 2.2, 2.6), V(-3.2, 2.4, -2.6), V(2.8, 2.3, -2.6), V(4.2, 2.0, 0.8)],
  targets: [V(0, 0.95, 0), V(-0.5, 1, 0.1), V(0, 1, -0.2), V(0.4, 1, 0.1), V(0, 0.95, 0.3)],
  seconds: 45,
};
const dock = ['celula', 'robo', 'mesa', 'cassetes', 'planta', 'cima', 'tour'].filter(n => document.getElementById('v-' + n));
const views = createViews(stage.camera, stage.controls, { views: VIEWS, tour: TOUR, onChange: n => dock.forEach(d => $('v-' + d).setAttribute('aria-pressed', String(d === n))) });
dock.filter(n => n !== 'tour').forEach(n => ($('v-' + n).onclick = () => views.go(n)));
/** The page opens on the cell (inside the plant too); "Na planta" shows it at its place. */
const FIRST = 'celula';
$('v-tour').onclick = () => (views.touring ? views.go(FIRST) : views.startTour());

// ---------- parameters ----------
const PKEY = 'memoryflow3d.cell.v1';
const pScan = $<HTMLInputElement>('p-scan'), pReject = $<HTMLInputElement>('p-reject'), pTarget = $<HTMLInputElement>('p-target');
const writeParams = (p: CellParams) => { pScan.value = String(p.scanS); pReject.value = String(p.rejectPct); pTarget.value = String(p.target); };
const num = (inp: HTMLInputElement, def: number, lo: number, hi: number) => { const v = Number(inp.value); return inp.value !== '' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; };
function loadParams() {
  if (benchMin) return;
  try {
    const s = JSON.parse(localStorage.getItem(PKEY) || 'null');
    if (s && typeof s === 'object') Object.assign(cell.params, { scanS: s.scanS ?? cell.params.scanS, rejectPct: s.rejectPct ?? cell.params.rejectPct, target: s.target ?? cell.params.target });
  } catch { /* defaults */ }
}
loadParams();
writeParams(cell.params);
$<HTMLFormElement>('params').addEventListener('submit', e => {
  e.preventDefault();
  const d = DEFAULT_CELL_PARAMS;
  cell.params.scanS = num(pScan, d.scanS, 10, 600);
  cell.params.rejectPct = num(pReject, d.rejectPct, 0.5, 50);
  cell.params.target = Math.round(num(pTarget, d.target, 1, 200));
  writeParams(cell.params);
  try { localStorage.setItem(PKEY, JSON.stringify({ scanS: cell.params.scanS, rejectPct: cell.params.rejectPct, target: cell.params.target })); } catch { /* not saved */ }
  cell.resetStats();
  $('p-status').textContent = `Aplicado: varredura de ${cell.params.scanS} s por wafer. Os indicadores recomeçaram do zero.`;
  kpi();
});
const tabs = [['tab-kpi', 'pane-kpi'], ['tab-par', 'pane-par']].map(([t, p]) => [$(t), $(p)] as const);
tabs.forEach(([t], i) => { t.onclick = () => tabs.forEach(([tt, pp], j) => { tt.setAttribute('aria-selected', String(i === j)); pp.hidden = i !== j; }); });

// ---------- controls ----------
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let playing = !reduced && !benchMin, speed = 1;
const playBtn = $('b-play');
const setPlay = (p: boolean) => { playing = p; playBtn.textContent = p ? 'Pausar' : 'Animar'; playBtn.setAttribute('aria-pressed', String(!p)); };
setPlay(playing);
playBtn.onclick = () => setPlay(!playing);
const speedBtn = $('b-speed');
speedBtn.onclick = () => { speed = speed >= 8 ? 1 : speed * 2; speedBtn.textContent = `${speed}×`; speedBtn.setAttribute('aria-pressed', String(speed > 1)); };
const wornBtn = $('b-worn');
wornBtn.onclick = () => { cell.params.worn = !cell.params.worn; wornBtn.setAttribute('aria-pressed', String(cell.params.worn)); };
const labelBtn = $('b-labels');
labelBtn.onclick = () => { labels.setVisible(!labels.visible); labelBtn.setAttribute('aria-pressed', String(labels.visible)); };
const kpiBtn = $('b-kpi'), kpiEl = $('kpi');
const setKpi = (o: boolean) => { kpiEl.classList.toggle('open', o); kpiBtn.setAttribute('aria-pressed', String(o)); };
kpiBtn.onclick = () => setKpi(!kpiEl.classList.contains('open'));
if (window.matchMedia?.('(max-width: 900px)').matches) setKpi(false);
const qBtn = $('b-quality');
const applyQuality = () => { stage.applyQuality(); qBtn.textContent = stage.state.high ? 'Qualidade alta' : 'Qualidade leve'; qBtn.setAttribute('aria-pressed', String(stage.state.high)); };
qBtn.onclick = () => { stage.state.high = !stage.state.high; applyQuality(); };
createShotModal(stage, labels, () => {}, (Wd, H) => `memory-flow-inspecao-${Wd}x${H}.png`);

// ---------- panel ----------
const f1 = (v: number, d = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const manualMin = STEPS.find(s => s.key === 'INS')!.minutes; // manual inspection, minutes per lot on one bench
const cmpBody = $<HTMLTableSectionElement>('cmp-rows');
const cmpRows = ['Bancada manual (1)', 'Bancadas INS01 + INS02', 'Célula com IA'].map(n => { const tr = cmpBody.insertRow(); tr.insertCell().textContent = n; tr.insertCell(); tr.insertCell(); return tr; });
cmpRows[2].className = 'total';
const defBody = $<HTMLTableSectionElement>('def-rows');
const defRows = CLASSES.slice(1).map(c => {
  const tr = defBody.insertRow();
  const td = tr.insertCell(), i = document.createElement('i');
  i.className = 'pill'; i.style.cssText = `display:inline-block;margin-right:6px;background:${c.color}`;
  td.append(i, c.name);
  tr.insertCell(); tr.insertCell();
  return tr;
});
const stList = $('st-list');
const stRows = ['Robô UR10e', 'Mesa e câmera', 'Lote', 'AMR'].map(name => {
  const li = document.createElement('li');
  li.innerHTML = '<i class="pill"></i><span></span><em></em>';
  li.querySelector('span')!.textContent = name;
  stList.appendChild(li);
  return { pill: li.querySelector('.pill') as HTMLElement, em: li.querySelector('em') as HTMLElement };
});
const setSt = (i: number, s: string, t: string) => { stRows[i].pill.dataset.s = s; stRows[i].em.textContent = t; };
const waferCanvas = $<HTMLCanvasElement>('wafer'), wg = waferCanvas.getContext('2d')!;
const legend = $('wafer-legend');
let lastDrawn: unknown = null;

function kpi() {
  const s = cell.stats, r = cellRates(s), st = cell.state;
  $('k-wph').textContent = r.wph ? f1(r.wph) : '—';
  $('k-cycle').textContent = r.cycleS ? `${f1(r.cycleS, 0)} s` : '—';
  $('k-lot').textContent = r.lotMin ? `${f1(r.lotMin, 0)} min` : '—';
  $('k-lot-l').textContent = `Minutos por lote de ${SLOTS} (na planta: ${DEFAULT_PARAMS.insAi ?? INS_AI_MINUTES})`;
  $('k-wafers').textContent = String(s.wafers);
  const manualWph = (SLOTS / manualMin) * 60;
  const rowVals: [number | null, number | null][] = [[manualWph, manualMin], [manualWph * 2, manualMin / 2], [r.wph, r.lotMin]];
  rowVals.forEach(([w, m], i) => { cmpRows[i].cells[1].textContent = w ? f1(w) : '—'; cmpRows[i].cells[2].textContent = m ? f1(m, 0) : '—'; });
  $('cmp-note').textContent = r.wph
    ? `Uma célula faz o trabalho de ${f1(r.wph / manualWph)} bancadas manuais (${f1(manualMin / SLOTS, 0)} min por wafer no microscópio, valor provisório da planta). Os defeitos ficam registrados die a die no mapa do wafer.`
    : 'Medindo: a taxa aparece depois de 4 minutos e 3 wafers.';
  const dies = Math.max(1, s.dies);
  defRows.forEach((tr, i) => { tr.cells[1].textContent = String(s.counts[i + 1]); tr.cells[2].textContent = s.dies ? `${f1((s.counts[i + 1] / dies) * 100, 2)}%` : '—'; });
  $('k-yield').textContent = s.dies ? `${f1((s.counts[0] / dies) * 100)}%` : '—';
  $('k-ng').textContent = String(s.ng);
  $('k-review').textContent = s.wafers ? f1(s.review / s.wafers) : '—';
  $('k-dies').textContent = s.wafers ? String(Math.round(s.dies / s.wafers)) : '—';
  // OEE: availability = outside the cassette swap; performance = wafers/h ÷ target; quality = approved ÷ inspected
  const av = s.t > 0 ? 1 - s.swapT / s.t : 1;
  const pf = r.wph ? Math.min(1, r.wph / cell.params.target) : null, q = s.wafers ? s.ok / s.wafers : null;
  $('o-av').textContent = pct(av);
  $('o-pf').textContent = pf == null ? '—' : pct(pf);
  $('o-q').textContent = q == null ? '—' : pct(q);
  $('o-oee').textContent = pf == null || q == null ? '—' : pct(av * pf * q);
  // last wafer
  const m = st.stage === 'scan' || st.stage === 'done' ? st.map : st.last;
  if (m !== lastDrawn || st.stage === 'scan') {
    drawWafer(wg, 300, m, st.stage === 'scan' ? st.prog : 1, { background: '#0d2744' });
    lastDrawn = m;
    legend.textContent = '';
    if (m) {
      const v = document.createElement('li');
      v.className = 'verdict';
      v.style.color = st.stage === 'scan' ? '#7dd3fc' : m.ng ? '#ef4444' : '#22c55e';
      v.textContent = st.stage === 'scan' ? 'Analisando…' : m.ng ? 'Reprovado' : 'Aprovado';
      legend.appendChild(v);
      for (let i = 1; i < 5; i++) { const li = document.createElement('li'); const sw = document.createElement('i'); sw.style.background = CLASSES[i].color; li.append(sw, `${CLASSES[i].name} ${m.counts[i]}`); legend.appendChild(li); }
      const li = document.createElement('li'); li.textContent = `Revisão humana ${m.review}`; legend.appendChild(li);
    }
  }
  const robotBusy = st.held || st.stage === 'loading' || st.stage === 'done';
  setSt(0, robotBusy ? 'run' : 'wait', st.held ? 'Levando wafer' : st.stage === 'done' ? 'Retirando wafer' : st.stage === 'loading' ? 'Carregando a mesa' : 'Aguardando a varredura');
  setSt(1, st.stage === 'scan' ? 'run' : 'wait', st.stage === 'scan' ? `Varrendo · ${Math.round(st.prog * 100)}%` : st.stage === 'done' ? 'Resultado pronto' : 'Sem wafer');
  setSt(2, 'run', `Lote ${st.lot} · ${SLOTS - st.next - 1} de ${SLOTS} retirados`);
  setSt(3, st.amr === 'away' ? 'off' : st.amr === 'docked' ? 'run' : 'wait', st.amr === 'away' ? 'Fora da célula' : st.amr === 'docked' ? 'Trocando cassetes' : st.amr === 'coming' ? 'A caminho' : 'Levando o lote');
}

// ---------- start ----------
let fitted = false;
new ResizeObserver(() => { stage.resize(); if (!fitted) { views.go(FIRST, true); fitted = true; } }).observe(stageEl);
applyQuality();
views.go(FIRST, true);
for (let i = 0; i < 300; i++) cell.step(1 / 30); // 10 s: the robot is already moving when the page opens
cell.resetStats();

declare global {
  interface Window {
    __cell: unknown;
    __cellBench?: { minutes: number; wafers: number; lots: number; ng: number; maxIkErr: number; minClear: number; minClearAt: string; ms: number };
  }
}
window.__cell = { cell, stage, views };
/** Portal cover (tests/e2e/capa.spec.ts): a wafer under the camera, the arm at work. */
(window as unknown as { __capa: () => void }).__capa = () => {
  for (let i = 0; i < 30 * 70; i++) cell.step(1 / 30);
  stage.camera.position.set(...V(2.2, 2.3, 2.9)); stage.controls.target.set(...V(0, 0.95, -0.05)); stage.controls.update();
};

if (benchMin) {
  const t0 = performance.now();
  for (let i = 0, n = Math.round(benchMin * 60 * 30); i < n; i++) cell.step(1 / 30);
  const s = cell.stats;
  window.__cellBench = { minutes: benchMin, wafers: s.wafers, lots: s.lots, ng: s.ng, maxIkErr: Math.round(s.maxIkErr * 1e4) / 1e4, minClear: Math.round(s.minClear * 1000) / 1000, minClearAt: s.minClearAt, ms: Math.round(performance.now() - t0) };
} else {
  const base = import.meta.env.BASE_URL;
  useUR10eMeshes([cell.arm], `${base}assets/ur10e/`).catch(err => console.warn('UR10e meshes not loaded; keeping the modelled arm', err));
  useHDRI(stage.renderer, stage.scene, `${base}assets/env/empty_warehouse_01_1k.hdr`).catch(err => console.warn('HDRI not loaded', err));
}

// ---------- loop ----------
const clock = new THREE.Clock();
let kpiT = 0;
function frame() {
  const raw = Math.min(clock.getDelta(), 0.05);
  if (playing) { const dt = raw * speed, n = Math.ceil(speed); for (let i = 0; i < n; i++) cell.step(dt / n); }
  cell.andons.update(performance.now() / 1000);
  if ((kpiT += raw) > 0.25) { kpiT = 0; kpi(); }
  views.update(raw);
  stage.controls.update();
  stage.renderer.render(stage.scene, stage.camera);
  requestAnimationFrame(frame);
}
kpi();
requestAnimationFrame(frame);
mountProjectsMenu(); // the projects menu, on the page inside the plant
