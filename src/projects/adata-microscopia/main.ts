// Project 01 · Adata Technology: digital retrofit and traceability of the microscope stations.
//
// URL options: ?bench=30 runs 30 simulated minutes at once (default parameters) and publishes window.__a01Bench.
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
/** Inside the Memory Flow plant (projetos/memory-flow-3d/microscopia/) or on its own page. */
const IN_PLANT = inPlant();
import { minutes, num } from '../memory-flow/ui/format';
import { DEFAULT_MICRO, DEFECT_CLASSES, drawMicroscope, lotTime } from './model';
import { PHASE_TEXT, createStations, type BenchStats } from './stations';

const page = createPage({ stage: { shadowFrustum: { left: -3.5, right: 3.5, top: 3, bottom: -3, near: 1, far: 60 }, ...(IN_PLANT ? plantStage : {}) }, font: FONT, labelScale: 0.4, labelNear: 1.2 });
const { stage } = page;
stage.renderer.toneMappingExposure = 0.9;
stage.camera.near = 0.05;
stage.camera.updateProjectionMatrix();
stage.controls.minDistance = 0.3;
const benchMin = page.num('bench');
if (IN_PLANT) buildPlantAround(stage.scene, PLACEMENTS.microscopia);
else buildRoom(stage.scene, { w: 7, d: 5, band: 0x8e5bb5, name: 'Qualidade · microscopia', font: FONT });
const M = createMaterials();
const st = createStations(stage.scene, M, FONT);

// ---------- parameters ----------
const PKEY = 'adata01.params.v1';
const f = (id: string) => $<HTMLInputElement>(id);
const v = (id: string, d: number, lo: number, hi: number) => { const x = Number(f(id).value); return f(id).value !== '' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
function writeForm() {
  const p = st.params;
  f('p-samples').value = String(p.samples); f('p-rate').value = String(Math.round(p.defectRate * 100));
  f('p-inspect').value = String(p.inspectS); f('p-header').value = String(p.headerS); f('p-write').value = String(p.writeS); f('p-type').value = String(p.typeS);
  f('p-inspect-d').value = String(p.inspectDigitalS); f('p-tag').value = String(p.tagS);
}
if (!benchMin) {
  try { const s = JSON.parse(localStorage.getItem(PKEY) || 'null'); if (s && typeof s === 'object') Object.assign(st.params, s); } catch { /* defaults */ }
}
writeForm();
$<HTMLFormElement>('params').addEventListener('submit', e => {
  e.preventDefault();
  const d = DEFAULT_MICRO, p = st.params;
  p.samples = Math.round(v('p-samples', d.samples, 1, 40)); p.defectRate = v('p-rate', d.defectRate * 100, 0, 80) / 100;
  p.inspectS = v('p-inspect', d.inspectS, 1, 300); p.headerS = v('p-header', d.headerS, 0, 600); p.writeS = v('p-write', d.writeS, 0, 300); p.typeS = v('p-type', d.typeS, 0, 1200);
  p.inspectDigitalS = v('p-inspect-d', d.inspectDigitalS, 1, 300); p.tagS = v('p-tag', d.tagS, 1, 120);
  writeForm();
  try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch { /* not saved */ }
  st.resetStats();
  $('p-status').textContent = 'Aplicado nos próximos lotes. Indicadores zerados.';
});
const probBtn = $('b-problem');
probBtn.onclick = () => { st.shared.problem = !st.shared.problem; probBtn.setAttribute('aria-pressed', String(st.shared.problem)); };

// ---------- panel ----------
const cmp = $<HTMLTableElement>('cmp');
const head = cmp.createTHead().insertRow();
['', 'Hoje', 'Digital'].forEach(h => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = h; head.appendChild(th); });
const cmpBody = cmp.createTBody();
type Row = [string, (s: BenchStats) => number | null, (v: number) => string, 'hi' | 'lo' | null];
const lph = (s: BenchStats) => (s.t > 300 && s.lots >= 1 ? (s.lots / s.t) * 3600 : null);
const ROWS: Row[] = [
  ['Lotes por hora', lph, v => num(v, 1), 'hi'],
  ['Tempo por lote', s => { const l = lph(s); return l ? 3600 / l / 60 : null; }, v => minutes(v), 'lo'],
  ['Tempo de registro', s => (s.t ? s.recordT / s.t : null), pct, 'lo'],
  ['Olho na ocular', s => (s.t ? s.eyepieceT / s.t : null), pct, 'lo'],
  ['Defeitos rastreáveis', s => (s.defects ? s.traceable / s.defects : null), pct, 'hi'],
  ['… com imagem', s => (s.defects ? s.traceableWithImage / s.defects : null), pct, 'hi'],
  ['Imagens no banco', s => s.images, v => num(v, 0), 'hi'],
];
const cmpRows = ROWS.map(([label]) => { const tr = cmpBody.insertRow(); tr.insertCell().textContent = label; tr.insertCell(); tr.insertCell(); return tr; });
const stList = $('st-list');
const stRows = ['Bancada de hoje', 'Bancada digital'].map(n => {
  const li = document.createElement('li');
  li.innerHTML = '<i class="pill"></i><span></span><em></em>';
  li.querySelector('span')!.textContent = n;
  stList.appendChild(li);
  return { pill: li.querySelector('.pill') as HTMLElement, em: li.querySelector('em') as HTMLElement };
});
const gallery = $('gallery');
const bankBody = $<HTMLTableSectionElement>('bank-rows');
const bankRows = DEFECT_CLASSES.map(c => {
  const tr = bankBody.insertRow(), td = tr.insertCell(), i = document.createElement('i');
  i.className = 'pill'; i.style.cssText = `display:inline-block;margin-right:6px;background:${c.color}`;
  td.append(i, c.name); tr.insertCell();
  return tr;
});
let galleryKey = '';

function panel() {
  const a = st.today.stats, b = st.digital.stats;
  ROWS.forEach(([, get, fmt, better], i) => {
    const va = get(a), vb = get(b), tr = cmpRows[i];
    [va, vb].forEach((val, k) => {
      const td = tr.cells[k + 1];
      td.textContent = val == null ? '—' : fmt(val);
      td.className = better && va != null && vb != null && va !== vb && val === (better === 'hi' ? Math.max(va, vb) : Math.min(va, vb)) ? 'best' : '';
    });
  });
  const ta = lotTime(st.params, 'hoje'), tb = lotTime(st.params, 'digital');
  $('cmp-note').textContent = `Por lote de ${st.params.samples} amostras (esperado): hoje ${minutes(ta.total / 60)}, dos quais ${minutes(ta.record / 60)} de registro em papel e digitação; com a bancada digital, ${minutes(tb.total / 60)}, com ${minutes(tb.record / 60)} de registro. No papel, o defeito só fica rastreável depois que a ficha é digitada, e sem imagem.`;
  [st.today, st.digital].forEach((bench, i) => {
    const ph = bench.state.phase;
    stRows[i].pill.dataset.s = ph === 'inspect' ? 'run' : ph === 'write' || ph === 'type' || ph === 'header' ? 'alarm' : 'wait';
    stRows[i].em.textContent = `${PHASE_TEXT[ph]} · lote ${bench.state.lot}, amostra ${Math.min(st.params.samples, bench.state.k + 1)}/${st.params.samples}`;
  });
  // gallery of the last captures (digital bench)
  const caps = st.digital.state.gallery.slice(-6).reverse();
  const key = caps.map(c => c.seed).join(',');
  if (key !== galleryKey) {
    galleryKey = key;
    gallery.textContent = '';
    for (const c of caps) {
      const fig = document.createElement('figure'), cv = document.createElement('canvas');
      cv.width = 150; cv.height = 100;
      drawMicroscope(cv.getContext('2d')!, 150, 100, c.seed, c.defect, 0.5);
      const cls = DEFECT_CLASSES.find(x => x.id === c.defect)!;
      const cap = document.createElement('figcaption');
      cap.innerHTML = `<b style="color:${cls.color}">${cls.name}</b><br>L26-${4100 + c.lot} · amostra ${c.sample}`;
      fig.append(cv, cap);
      gallery.appendChild(fig);
    }
    if (!caps.length) gallery.textContent = 'Nenhuma imagem ainda.';
  }
  bankRows.forEach((tr, i) => (tr.cells[1].textContent = String(b.byClass[DEFECT_CLASSES[i].id])));
}

// ---------- start ----------
const LABELS: LabelDef[] = [
  { lines: ['Hoje', 'oculares · ficha em papel'], x: -1.1, y: 1.95, z: -0.2 },
  { lines: ['Digital', 'câmera · monitor · MES'], x: 1.1, y: 1.95, z: -0.2 },
];
for (let i = 0; i < 150; i++) st.step(1 / 30);
st.resetStats();
page.start({
  first: 'geral',
  views: {
    geral: { pos: [0, 2.3, 3.6], target: [0, 1.0, 0] },
    hoje: { pos: [-0.3, 1.75, 1.7], target: [-1.1, 1.05, 0] },
    digital: { pos: [1.9, 1.75, 1.7], target: [1.1, 1.05, 0] },
    monitor: { pos: [0.95, 1.5, 0.75], target: [0.68, 1.36, -0.22] },
    ...(IN_PLANT ? { planta: plantView } : {}),
    cima: { pos: [0, 5, 0.01], target: [0, 0.9, 0] },
  },
  tour: { positions: [[0, 2.3, 3.5], [-2.4, 1.8, 1.4], [-0.2, 1.6, 1.4], [2.4, 1.8, 1.4], [1.0, 1.55, 0.9]], targets: [[0, 1, 0], [-1.1, 1, 0], [-1.1, 1.1, 0], [1.1, 1, 0], [0.68, 1.36, -0.22]], seconds: 40 },
  labels: LABELS,
  speeds: [1, 2, 4, 8, 16],
  step: dt => st.step(dt),
  panel,
  shotName: (w, h) => `adata-01-microscopia-${w}x${h}.png`,
});

declare global { interface Window { __a01: unknown; __a01Bench?: { minutes: number; today: { lots: number; defects: number; traceable: number }; digital: { lots: number; defects: number; images: number }; ms: number } } }
window.__a01 = { st, stage, panel };
(window as unknown as { __capa: () => void }).__capa = () => {
  for (let i = 0; i < 30 * 120; i++) st.step(1 / 30);
  stage.camera.position.set(0.4, 2.0, 2.6); stage.controls.target.set(0.1, 1.05, -0.1); stage.controls.update();
};
if (benchMin) {
  const t0 = performance.now();
  for (let i = 0, n = Math.round(benchMin * 60 * 30); i < n; i++) st.step(1 / 30);
  const a = st.today.stats, b = st.digital.stats;
  window.__a01Bench = { minutes: benchMin, today: { lots: a.lots, defects: a.defects, traceable: a.traceable }, digital: { lots: b.lots, defects: b.defects, images: b.images }, ms: Math.round(performance.now() - t0) };
} else {
  useHDRI(stage.renderer, stage.scene, `${import.meta.env.BASE_URL}assets/env/empty_warehouse_01_1k.hdr`).catch(err => console.warn('HDRI not loaded', err));
}
mountProjectsMenu(); // the projects menu, on the pages inside the plant
