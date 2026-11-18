// Project 03 · Adata Technology: 3D dimensional inspection and validation of reworked ICs.
//
// URL options: ?bench=10 runs 10 simulated minutes at once (default parameters, normal rework) and publishes
// window.__a03Bench.
import { pct } from '../../sim/kpi';
import type { LabelDef } from '../../sim/labels';
import { createMaterials } from '../../sim/materials';
import { buildRoom } from '../../sim/room';
import { useHDRI } from '../../sim/robots/ur-arm';
import { $ } from '../../sim/ui/dom';
import { createPage } from '../../sim/ui/page';
import { FONT } from '../memory-flow/config';
import { PLACEMENTS, buildPlantAround, inPlant, plantStage, plantView } from '../memory-flow/in-plant';
import { mountProjectsMenu } from '../memory-flow/projects-menu';
/** Inside the Memory Flow plant (projetos/memory-flow-3d/retrabalho/) or on its own page. */
const IN_PLANT = inPlant();
import { num } from '../memory-flow/ui/format';
import { DEFAULT_REWORK, PER_TRAY, createReworkCell, icsPerHour } from './cell';
import { DEFECTS, drawIc } from './ics';

const page = createPage({ stage: { shadowFrustum: { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 60 }, ...(IN_PLANT ? plantStage : {}) }, font: FONT, labelScale: 0.3, labelNear: 0.9 });
const { stage } = page;
stage.renderer.toneMappingExposure = 0.9;
stage.camera.near = 0.02;
stage.camera.updateProjectionMatrix();
stage.controls.minDistance = 0.12;
const benchMin = page.num('bench');
if (IN_PLANT) buildPlantAround(stage.scene, PLACEMENTS.retrabalho);
else buildRoom(stage.scene, { w: 6, d: 5, band: 0x8e5bb5, name: 'Qualidade · inspeção 3D', font: FONT });
const M = createMaterials();
const cell = createReworkCell(stage.scene, M, FONT);

/** Manual check at the microscope today (provisional): about 20 s per IC, visual only. */
const MANUAL_S = 20;

// ---------- parameters ----------
const PKEY = 'adata03.params.v1';
const f = (id: string) => $<HTMLInputElement>(id);
const v = (id: string, d: number, lo: number, hi: number) => { const x = Number(f(id).value); return f(id).value !== '' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
function writeForm() {
  const p = cell.params;
  f('p-dtol').value = String(Math.round(p.tol.dTol * 1000)); f('p-cop').value = String(Math.round(p.tol.copMax * 1000)); f('p-off').value = String(Math.round(p.tol.offMax * 1000));
  f('p-scan').value = String(p.scanS); f('p-target').value = String(p.target);
}
if (!benchMin) {
  try { const s = JSON.parse(localStorage.getItem(PKEY) || 'null'); if (s && typeof s === 'object') { Object.assign(cell.params, s, { bad: false }); cell.params.tol = { ...DEFAULT_REWORK.tol, ...s.tol }; } } catch { /* defaults */ }
}
writeForm();
$<HTMLFormElement>('params').addEventListener('submit', e => {
  e.preventDefault();
  const d = DEFAULT_REWORK, p = cell.params;
  p.tol = { dTol: v('p-dtol', d.tol.dTol * 1000, 10, 200) / 1000, copMax: v('p-cop', d.tol.copMax * 1000, 20, 200) / 1000, offMax: v('p-off', d.tol.offMax * 1000, 20, 200) / 1000 };
  p.scanS = v('p-scan', d.scanS, 0.2, 10); p.target = Math.round(v('p-target', d.target, 100, 20000));
  writeForm();
  try { localStorage.setItem(PKEY, JSON.stringify({ scanS: p.scanS, target: p.target, tol: p.tol })); } catch { /* not saved */ }
  cell.resetStats();
  $('p-status').textContent = 'Aplicado. As próximas medições usam as novas tolerâncias; indicadores zerados.';
});
const badBtn = $('b-bad');
badBtn.onclick = () => { cell.params.bad = !cell.params.bad; badBtn.setAttribute('aria-pressed', String(cell.params.bad)); };

// ---------- panel ----------
const icCanvas = $<HTMLCanvasElement>('ic'), icG = icCanvas.getContext('2d')!;
const trayCanvas = $<HTMLCanvasElement>('tray'), trayG = trayCanvas.getContext('2d')!;
const icData = $('ic-data');
const defBody = $<HTMLTableSectionElement>('def-rows');
const defRows = DEFECTS.map(d => {
  const tr = defBody.insertRow(), td = tr.insertCell(), i = document.createElement('i');
  i.className = 'pill'; i.style.cssText = `display:inline-block;margin-right:6px;background:${d.color}`;
  td.append(i, d.name); tr.insertCell(); tr.insertCell();
  return tr;
});
const cmpBody = $<HTMLTableSectionElement>('cmp-rows');
const cmpRows = ['Microscópio (1 pessoa)', 'Inspeção 3D automática'].map(n => { const tr = cmpBody.insertRow(); tr.insertCell().textContent = n; tr.insertCell(); tr.insertCell(); return tr; });
cmpRows[1].className = 'total';
function li(text: string, color?: string, cls?: string) { const l = document.createElement('li'); if (cls) l.className = cls; if (color) l.style.color = color; l.textContent = text; icData.appendChild(l); }

function panel() {
  const s = cell.stats, st = cell.state, iph = icsPerHour(s);
  $('k-iph').textContent = iph ? num(iph, 0) : '—';
  $('k-cycle').textContent = iph ? `${num(3600 / iph, 2)} s` : '—';
  $('k-trays').textContent = String(s.trays);
  $('k-ics').textContent = String(s.ics);
  // current package
  const ic = st.phase === 'scan' && st.current ? st.current : st.last, scanning = st.phase === 'scan' && !!st.current;
  drawIc(icG, 240, 320, ic, scanning ? st.prog : 1, { background: '#0d2744' });
  icData.textContent = '';
  if (ic) {
    li(scanning ? 'Medindo…' : ic.ok ? 'Aprovado' : 'Reprovado', scanning ? '#7dd3fc' : ic.ok ? '#22c55e' : '#ef4444', 'verdict');
    li(`Coplanaridade ${(ic.coplanarity * 1000).toFixed(0)} µm`);
    li(`Diâmetro ${(ic.dMin * 1000).toFixed(0)}–${(ic.dMax * 1000).toFixed(0)} µm`);
    li(`Posição máx. ${(ic.offMax * 1000).toFixed(0)} µm`);
    li(`Ausentes ${ic.missing} · Pontes ${ic.bridges}`);
    if (!scanning && !ic.ok) ic.defects.forEach(d => { const def = DEFECTS.find(x => x.id === d)!; li(def.name, def.color); });
  }
  // tray map
  trayG.fillStyle = '#0d2744'; trayG.fillRect(0, 0, 400, 170);
  const res = cell.results();
  for (let i = 0; i < PER_TRAY; i++) {
    const c = i % 20, r = Math.floor(i / 20), x = 8 + c * 19.2, y = 8 + r * 19.5;
    trayG.fillStyle = i === st.currentIdx && scanning ? '#7dd3fc' : !res[i] ? '#3a4556' : res[i]!.ok ? '#22c55e' : '#ef4444';
    trayG.fillRect(x, y, 15, 16);
  }
  // defects
  const n = Math.max(1, s.ics);
  defRows.forEach((tr, i) => { const c = s.byClass[DEFECTS[i].id]; tr.cells[1].textContent = String(c); tr.cells[2].textContent = s.ics ? `${num((c / n) * 100, 2)}%` : '—'; });
  $('k-yield').textContent = s.ics ? pct(s.ok / s.ics) : '—';
  $('k-rej').textContent = String(s.rejected);
  // manual comparison: defects an inspector at the microscope would not see, per 1000 ICs
  const missedPer1000 = s.ics ? DEFECTS.reduce((a, d) => a + (s.byClass[d.id] / s.ics) * 1000 * (1 - d.visibleManual), 0) : null;
  cmpRows[0].cells[1].textContent = num(3600 / MANUAL_S, 0);
  cmpRows[0].cells[2].textContent = missedPer1000 == null ? '—' : `${num(missedPer1000, 1)} / 1.000`;
  cmpRows[1].cells[1].textContent = iph ? num(iph, 0) : '—';
  cmpRows[1].cells[2].textContent = '0 (todos medidos)';
  $('cmp-note').textContent = `No microscópio, ${MANUAL_S} s por IC e só o que se vê: coplanaridade e desalinhamento quase nunca aparecem (valores provisórios). A medição 3D compara cada esfera com a tolerância e registra o resultado por IC.`;
  // OEE
  const T = Math.max(1, s.t), av = 1 - s.exchangeT / T, pf = iph ? Math.min(1, iph / cell.params.target) : null, q = s.ics ? s.ok / s.ics : null;
  $('o-av').textContent = pct(av);
  $('o-pf').textContent = pf == null ? '—' : pct(pf);
  $('o-q').textContent = q == null ? '—' : pct(q);
  $('o-oee').textContent = pf == null || q == null ? '—' : pct(av * pf * q);
}

// ---------- start ----------
const LABELS: LabelDef[] = [
  { lines: ['Sensor 3D (laser) + bico de sucção'], x: 0, y: 1.45, z: 0.1 },
  { lines: ['Empilhador de entrada'], x: -0.85, y: 1.6, z: 0 },
  { lines: ['Empilhador de saída'], x: 0.85, y: 1.6, z: 0 },
  { lines: ['Bandeja de descarte'], x: 0.2, y: 1.1, z: 0.42 },
];
for (let i = 0; i < 150; i++) cell.step(1 / 30);
cell.resetStats();
page.start({
  first: 'maquina',
  views: {
    maquina: { pos: [1.5, 1.9, 2.0], target: [0, 1.0, 0] },
    sensor: { pos: [0.18, 1.12, 0.32], target: [0, 0.95, 0] },
    bandeja: { pos: [0.02, 1.45, 0.25], target: [0, 0.94, 0.0] },
    descarte: { pos: [0.55, 1.3, 0.9], target: [0.2, 0.95, 0.36] },
    ...(IN_PLANT ? { planta: plantView } : {}),
    cima: { pos: [0, 3.2, 0.01], target: [0, 0.9, 0] },
  },
  tour: { positions: [[1.6, 1.9, 2.0], [0.4, 1.3, 0.6], [-1.4, 1.6, 1.2], [-1.2, 1.8, -1.4], [1.3, 1.6, -1.2]], targets: [[0, 1, 0], [0, 0.96, 0], [-0.4, 1, 0], [0, 1, 0], [0.4, 1, 0]], seconds: 40 },
  labels: LABELS,
  speeds: [1, 2, 4, 8],
  step: dt => cell.step(dt),
  frame: () => cell.andons.update(performance.now() / 1000),
  panel,
  shotName: (w, h) => `adata-03-retrabalho-${w}x${h}.png`,
});

declare global { interface Window { __a03: unknown; __a03Bench?: { minutes: number; ics: number; rejected: number; trays: number; ms: number } } }
window.__a03 = { cell, stage, panel };
(window as unknown as { __capa: () => void }).__capa = () => {
  for (let i = 0; i < 30 * 90; i++) cell.step(1 / 30); // most of the tray already classified
  stage.camera.position.set(1.15, 1.85, 1.5); stage.controls.target.set(0.05, 0.98, 0); stage.controls.update();
};
if (benchMin) {
  const t0 = performance.now();
  for (let i = 0, n = Math.round(benchMin * 60 * 30); i < n; i++) cell.step(1 / 30);
  const s = cell.stats;
  window.__a03Bench = { minutes: benchMin, ics: s.ics, rejected: s.rejected, trays: s.trays, ms: Math.round(performance.now() - t0) };
} else {
  useHDRI(stage.renderer, stage.scene, `${import.meta.env.BASE_URL}assets/env/empty_warehouse_01_1k.hdr`).catch(err => console.warn('HDRI not loaded', err));
}
mountProjectsMenu(); // the projects menu, on the pages inside the plant
