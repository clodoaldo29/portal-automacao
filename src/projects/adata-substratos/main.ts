// Project 02 · Adata Technology: intelligent inspection of substrates by computer vision (RGB + spectral).
//
// URL options: ?bench=10 runs 10 simulated minutes at once (default parameters, normal lot) and publishes
// window.__a02Bench.
import { pct } from '../../sim/kpi';
import type { LabelDef } from '../../sim/labels';
import { createMaterials } from '../../sim/materials';
import { buildRoom } from '../../sim/room';
import { useHDRI } from '../../sim/robots/ur-arm';
import { $ } from '../../sim/ui/dom';
import { createPage } from '../../sim/ui/page';
import { FONT } from '../memory-flow/config';
import { PLACEMENTS, buildPlantAround, inPlant, plantStage, plantView } from '../memory-flow/in-plant';
/** Inside the Memory Flow plant (projetos/memory-flow-3d/substratos/) or on its own page. */
const IN_PLANT = inPlant();
import { num } from '../memory-flow/ui/format';
import { DEFAULT_SUBSTRATE, createSubstrateCell, stripsPerHour } from './cell';
import { UNITS, UNIT_CLASSES, drawStrip, oxColor } from './substrate';

const page = createPage({ stage: { shadowFrustum: { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 60 }, ...(IN_PLANT ? plantStage : {}) }, font: FONT, labelScale: 0.32, labelNear: 1.0 });
const { stage } = page;
stage.renderer.toneMappingExposure = 0.9;
stage.camera.near = 0.03;
stage.camera.updateProjectionMatrix();
stage.controls.minDistance = 0.2;
const benchMin = page.num('bench');
if (IN_PLANT) buildPlantAround(stage.scene, PLACEMENTS.substratos);
else buildRoom(stage.scene, { w: 6.5, d: 5, band: 0x2f6fb0, name: 'Front-end · entrada de substratos', font: FONT });
const M = createMaterials();
const cell = createSubstrateCell(stage.scene, M, FONT);

/** Plant demand (provisional): about 5 million packages a month, one substrate unit each. */
const DEMAND_UNITS_H = 5e6 / 30 / 24;

// ---------- parameters ----------
const PKEY = 'adata02.params.v1';
const f = (id: string) => $<HTMLInputElement>(id);
const v = (id: string, d: number, lo: number, hi: number) => { const x = Number(f(id).value); return f(id).value !== '' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
function writeForm() {
  const p = cell.params;
  f('p-ox').value = String(p.limits.oxLimit); f('p-xout').value = String(Math.round(p.limits.xoutMax * 100));
  f('p-speed').value = String(Math.round(p.speed * 1000)); f('p-target').value = String(p.target);
}
if (!benchMin) {
  try { const s = JSON.parse(localStorage.getItem(PKEY) || 'null'); if (s && typeof s === 'object') { Object.assign(cell.params, s, { oxidized: false }); cell.params.limits = { ...DEFAULT_SUBSTRATE.limits, ...s.limits }; } } catch { /* defaults */ }
}
writeForm();
$<HTMLFormElement>('params').addEventListener('submit', e => {
  e.preventDefault();
  const d = DEFAULT_SUBSTRATE, p = cell.params;
  p.limits = { oxLimit: v('p-ox', d.limits.oxLimit, 0.1, 0.9), xoutMax: v('p-xout', d.limits.xoutMax * 100, 1, 50) / 100 };
  p.speed = v('p-speed', d.speed * 1000, 10, 200) / 1000; p.target = Math.round(v('p-target', d.target, 10, 3000));
  writeForm();
  try { localStorage.setItem(PKEY, JSON.stringify({ speed: p.speed, target: p.target, limits: p.limits })); } catch { /* not saved */ }
  cell.resetStats();
  $('p-status').textContent = 'Aplicado. As próximas tiras usam os novos limites; indicadores zerados.';
});
const oxBtn = $('b-ox');
oxBtn.onclick = () => { cell.params.oxidized = !cell.params.oxidized; oxBtn.setAttribute('aria-pressed', String(cell.params.oxidized)); };

// ---------- panel ----------
const cRgb = $<HTMLCanvasElement>('c-rgb').getContext('2d')!, cSpec = $<HTMLCanvasElement>('c-spec').getContext('2d')!;
{
  const lg = $('cls-legend');
  for (let i = 1; i < UNIT_CLASSES.length; i++) { const li = document.createElement('li'), sw = document.createElement('i'); sw.style.background = UNIT_CLASSES[i].color; li.append(sw, UNIT_CLASSES[i].name); lg.appendChild(li); }
  const li = document.createElement('li'), sw = document.createElement('i');
  sw.style.background = `linear-gradient(90deg, ${oxColor(0)}, ${oxColor(0.3)}, ${oxColor(0.6)})`;
  sw.style.width = '40px';
  li.append(sw, 'Índice de oxidação (baixo → alto)');
  lg.appendChild(li);
}
const defBody = $<HTMLTableSectionElement>('def-rows');
const defRows = UNIT_CLASSES.slice(1).map(c => {
  const tr = defBody.insertRow(), td = tr.insertCell(), i = document.createElement('i');
  i.className = 'pill'; i.style.cssText = `display:inline-block;margin-right:6px;background:${c.color}`;
  td.append(i, c.name + (c.spectral ? ' (espectral)' : ''));
  tr.insertCell(); tr.insertCell();
  return tr;
});
const capBody = $<HTMLTableSectionElement>('cap-rows');
const capRows = ['Demanda da planta', 'Capacidade da máquina', 'Ocupação na demanda'].map(n => { const tr = capBody.insertRow(); tr.insertCell().textContent = n; tr.insertCell(); return tr; });
capRows[2].className = 'total';
let drawnFor: unknown = null;

function panel() {
  const s = cell.stats, st = cell.state, sph = stripsPerHour(s);
  $('k-sph').textContent = sph ? num(sph, 0) : '—';
  $('k-uph').textContent = sph ? num(sph * UNITS, 0) : '—';
  $('k-strips').textContent = String(s.strips);
  $('k-ng').textContent = String(s.ng);
  const strip = st.current ?? st.last;
  if (strip && (strip !== drawnFor || strip.spec < 1)) {
    drawStrip(cRgb, 480, 148, strip.res, strip.rgb, 'rgb');
    drawStrip(cSpec, 480, 148, strip.res, strip.spec, 'spec');
    drawnFor = strip;
    $('strip-note').textContent = strip.spec < 1
      ? `Tira ${strip.seq}: passando pelas câmeras.`
      : `Tira ${strip.seq}: ${strip.res.xouts} de ${UNITS} unidades X-out, índice de oxidação médio ${num(strip.res.oxMean, 2)}. ${strip.res.ng ? 'Vai para o magazine NG.' : 'Segue para a montagem, com o mapa X-out no MES.'}`;
  }
  const n = Math.max(1, s.units);
  defRows.forEach((tr, i) => { tr.cells[1].textContent = String(s.byClass[i + 1]); tr.cells[2].textContent = s.units ? `${num((s.byClass[i + 1] / n) * 100, 2)}%` : '—'; });
  $('k-ox').textContent = s.strips ? num(s.oxSum / s.strips, 2) : '—';
  $('k-xout').textContent = s.units ? pct(s.xouts / s.units) : '—';
  capRows[0].cells[1].textContent = `${num(DEMAND_UNITS_H, 0)} unidades/h (${num(DEMAND_UNITS_H / UNITS, 0)} tiras/h)`;
  capRows[1].cells[1].textContent = sph ? `${num(sph * UNITS, 0)} unidades/h` : 'medindo…';
  capRows[2].cells[1].textContent = sph ? pct(DEMAND_UNITS_H / (sph * UNITS)) : '—';
  $('cap-note').textContent = 'Inspeção de 100% das tiras, com a tira em movimento. Na entrada manual, por amostragem, a oxidação inicial não aparece a olho; o índice espectral mostra a tendência do lote antes da montagem (valores provisórios).';
  const pf = sph ? Math.min(1, sph / cell.params.target) : null, q = s.units ? (s.units - s.xouts) / s.units : null;
  $('o-av').textContent = pct(1);
  $('o-pf').textContent = pf == null ? '—' : pct(pf);
  $('o-q').textContent = q == null ? '—' : pct(q);
  $('o-oee').textContent = pf == null || q == null ? '—' : pct(pf * q);
}

// ---------- start ----------
const LABELS: LabelDef[] = [
  { lines: ['Magazine de entrada'], x: -1.25, y: 1.45, z: 0 },
  { lines: ['Câmera RGB'], x: -0.05, y: 1.55, z: 0 },
  { lines: ['Câmera multiespectral'], x: 0.25, y: 1.65, z: 0 },
  { lines: ['Magazine OK'], x: 1.3, y: 1.45, z: -0.02 },
  { lines: ['Magazine NG'], x: 1.3, y: 1.3, z: 0.25 },
];
for (let i = 0; i < 150; i++) cell.step(1 / 30);
cell.resetStats();
page.start({
  first: 'maquina',
  views: {
    maquina: { pos: [1.2, 1.8, 2.1], target: [0, 1.0, 0] },
    cameras: { pos: [0.15, 1.2, 0.55], target: [0.1, 0.97, 0] },
    entrada: { pos: [-1.6, 1.4, 0.8], target: [-1.1, 1.0, 0] },
    saida: { pos: [1.7, 1.4, 0.9], target: [1.15, 1.0, 0.1] },
    ...(IN_PLANT ? { planta: plantView } : {}),
    cima: { pos: [0, 3.4, 0.01], target: [0, 0.95, 0] },
  },
  tour: { positions: [[1.3, 1.8, 2.0], [-1.7, 1.5, 0.9], [0.2, 1.25, 0.6], [1.8, 1.5, 0.9], [0.4, 2.0, -1.6]], targets: [[0, 1, 0], [-1.1, 1, 0], [0.1, 0.97, 0], [1.2, 1, 0.1], [0, 1, 0]], seconds: 40 },
  labels: LABELS,
  speeds: [1, 2, 4, 8],
  step: dt => cell.step(dt),
  frame: () => cell.andons.update(performance.now() / 1000),
  panel,
  shotName: (w, h) => `adata-02-substratos-${w}x${h}.png`,
});

declare global { interface Window { __a02: unknown; __a02Bench?: { minutes: number; strips: number; ng: number; xouts: number; ms: number } } }
window.__a02 = { cell, stage, panel };
(window as unknown as { __capa: () => void }).__capa = () => {
  for (let i = 0; i < 30 * 30; i++) cell.step(1 / 30); // a few strips on the rails
  stage.camera.position.set(1.55, 2.1, 1.85); stage.controls.target.set(0.25, 0.98, 0); stage.controls.update();
};
if (benchMin) {
  const t0 = performance.now();
  for (let i = 0, n = Math.round(benchMin * 60 * 30); i < n; i++) cell.step(1 / 30);
  const s = cell.stats;
  window.__a02Bench = { minutes: benchMin, strips: s.strips, ng: s.ng, xouts: s.xouts, ms: Math.round(performance.now() - t0) };
} else {
  useHDRI(stage.renderer, stage.scene, `${import.meta.env.BASE_URL}assets/env/empty_warehouse_01_1k.hdr`).catch(err => console.warn('HDRI not loaded', err));
}
