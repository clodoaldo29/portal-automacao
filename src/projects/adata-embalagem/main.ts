// Project 05 · Adata Technology: automated final packing (dry pack) and product traceability.
//
// URL options: ?bench=20 runs 20 simulated minutes at once (default parameters, continuous feed) and publishes
// window.__a05Bench (skips the original robot meshes and the HDRI).
import { pct } from '../../sim/kpi';
import type { LabelDef } from '../../sim/labels';
import { createMaterials } from '../../sim/materials';
import { buildRoom } from '../../sim/room';
import { useHDRI, useUR10eMeshes } from '../../sim/robots/ur-arm';
import { $ } from '../../sim/ui/dom';
import { createPage } from '../../sim/ui/page';
import { FONT } from '../memory-flow/config';
import { bar, num } from '../memory-flow/ui/format';
import { DEFAULT_PACK, bagsPerHour, chipsPerBag, createPackCell, demandBagsPerHour, type PackParams } from './cell';

const page = createPage({ stage: { shadowFrustum: { left: -6, right: 6, top: 5, bottom: -5, near: 1, far: 60 } }, font: FONT, labelScale: 0.42, labelNear: 1.6 });
const { stage } = page;
stage.renderer.toneMappingExposure = 0.88;
const benchMin = page.num('bench');
const room = buildRoom(stage.scene, { w: 10, d: 7.6, x: 0.2, z: 0.1, band: 0x5f6b7a, name: 'Embalagem final · dry pack', font: FONT });
const M = createMaterials();
const cell = createPackCell(stage.scene, M, FONT);

/** Manual packing today (provisional, from the plant model): 60 min per lot of ~12,400 chips on one station, 2 stations. */
const MANUAL = { minPerBag: 7.7, stations: 2, escapeRate: 0.003 };

// ---------- parameters ----------
const PKEY = 'adata05.params.v1';
const f = (id: string) => $<HTMLInputElement>(id);
const v = (id: string, d: number, lo: number, hi: number) => { const x = Number(f(id).value); return f(id).value !== '' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
function writeForm(p: PackParams) {
  $<HTMLSelectElement>('p-mode').value = p.mode;
  f('p-demand').value = String(p.demandChipsMonth / 1e6); f('p-seal').value = String(p.sealS); f('p-label').value = String(p.labelS);
  f('p-trays').value = String(p.traysFull); f('p-chips').value = String(p.chipsPerTray); f('p-carton').value = String(p.perCarton); f('p-target').value = String(p.target);
}
if (!benchMin) {
  try { const s = JSON.parse(localStorage.getItem(PKEY) || 'null'); if (s && typeof s === 'object') Object.assign(cell.params, s, { wrongLabel: false }); } catch { /* defaults */ }
}
writeForm(cell.params);
$<HTMLFormElement>('params').addEventListener('submit', e => {
  e.preventDefault();
  const d = DEFAULT_PACK, p = cell.params;
  p.mode = $<HTMLSelectElement>('p-mode').value === 'demanda' ? 'demanda' : 'continuo';
  p.demandChipsMonth = v('p-demand', d.demandChipsMonth / 1e6, 0.5, 50) * 1e6;
  p.sealS = v('p-seal', d.sealS, 3, 60); p.labelS = v('p-label', d.labelS, 2, 60);
  p.traysFull = Math.round(v('p-trays', d.traysFull, 1, 20)); p.chipsPerTray = Math.round(v('p-chips', d.chipsPerTray, 10, 1000));
  p.perCarton = Math.round(v('p-carton', d.perCarton, 1, 4)); p.target = Math.round(v('p-target', d.target, 1, 1000));
  writeForm(p);
  try { const { wrongLabel: _w, ...keep } = p; localStorage.setItem(PKEY, JSON.stringify(keep)); } catch { /* not saved */ }
  cell.resetStats();
  $('p-status').textContent = `Aplicado. ${p.mode === 'demanda' ? `Pilhas chegando na demanda da planta (${num(demandBagsPerHour(p), 1)} por hora).` : 'Pilhas sempre disponíveis.'} Indicadores zerados.`;
});
const wrongBtn = $('b-wrong');
wrongBtn.onclick = () => { cell.params.wrongLabel = !cell.params.wrongLabel; wrongBtn.setAttribute('aria-pressed', String(cell.params.wrongLabel)); };

// ---------- panel ----------
const capBody = $<HTMLTableSectionElement>('cap-rows');
const capRows = ['Demanda da planta', 'Capacidade da célula', 'Ocupação na demanda', 'Postos manuais hoje'].map(n => { const tr = capBody.insertRow(); tr.insertCell().textContent = n; tr.insertCell(); return tr; });
capRows[2].className = 'total';
const useBody = $<HTMLTableSectionElement>('use-rows');
const useRows = ['Robô UR10e', 'Seladora a vácuo', 'Etiquetadora', 'Troca de caixa'].map(n => { const tr = useBody.insertRow(); tr.insertCell().textContent = n; tr.insertCell(); tr.insertCell(); return tr; });
const PHASE: Record<string, string> = {
  none: 'vazia', feeding: 'saco chegando', open: 'saco aberto', loading: 'robô trazendo a pilha', loaded: 'pilha no saco', dispense: 'dessecante e cartão', closing: 'fechando',
  ready: 'pronta', seal: 'selando', label: 'etiquetando', verify: 'verificando', ok: 'aprovado', picking: 'robô retirando', ng: 'reprovado', eject: 'descartando',
};
function panel() {
  const s = cell.stats, p = cell.params, bph = bagsPerHour(s), cpb = chipsPerBag(p), dem = demandBagsPerHour(p);
  $('k-bph').textContent = bph ? num(bph, 0) : '—';
  $('k-cycle').textContent = bph ? `${num(3600 / bph, 0)} s` : '—';
  $('k-chips').textContent = bph ? num(bph * cpb, 0) : '—';
  $('k-bags').textContent = String(s.bags);
  const manualCap = (60 / MANUAL.minPerBag) * MANUAL.stations;
  capRows[0].cells[1].textContent = `${num(dem, 1)} sacos/h · ${num(p.demandChipsMonth / 1e6, 1)} mi chips/mês`;
  capRows[1].cells[1].textContent = bph ? `${num(bph, 0)} sacos/h · ${num((bph * cpb * 24 * 30) / 1e6, 0)} mi chips/mês` : 'medindo…';
  capRows[2].cells[1].textContent = bph ? pct(dem / bph) : '—';
  capRows[3].cells[1].textContent = `${MANUAL.stations} × ${num(MANUAL.minPerBag, 1)} min/saco = ${num(manualCap, 1)} sacos/h`;
  $('cap-note').textContent = bph
    ? `Uma célula atende a planta com folga: na demanda, fica ocupada ${pct(dem / bph)} do tempo. O ganho não é de volume. É de conferência automática, rastreabilidade de cada saco e menos manuseio (ESD, umidade).`
    : 'A capacidade aparece depois de 2 minutos e 3 sacos.';
  const verified = s.bags + s.ng + (cell.slots[2].phase === 'ok' || cell.slots[2].phase === 'picking' ? 1 : 0);
  $('k-scans').textContent = String(s.scans);
  $('k-verified').textContent = String(verified);
  $('k-ng').textContent = String(s.ng);
  $('k-escape').textContent = '0';
  const perMonth = dem * 24 * 30;
  $('trace-note').textContent = `Na célula, toda etiqueta é lida e comparada com o lote antes de o saco ir para a caixa. No processo manual, com ${num(MANUAL.escapeRate * 100, 1)}% de erro não detectado (valor provisório), seriam cerca de ${num(perMonth * MANUAL.escapeRate, 0)} sacos por mês com etiqueta errada no cliente.`;
  const T = Math.max(1, s.t), uses = [s.robotT / T, s.sealT / T, s.labelT / T, s.changeT / T];
  const st = [cell.actor.seq.some(x => !x.ready) ? 'em movimento' : 'livre', PHASE[cell.slots[1].phase], PHASE[cell.slots[2].phase], `caixa ${cell.carton.count}/${p.perCarton}`];
  useRows.forEach((tr, i) => { tr.cells[1].textContent = pct(uses[i]); tr.cells[1].appendChild(bar(uses[i])); tr.cells[2].textContent = st[i]; });
  const av = 1 - s.changeT / T, pf = bph ? Math.min(1, bph / p.target) : null, q = verified ? (verified - s.ng) / verified : null;
  $('o-av').textContent = pct(av);
  $('o-pf').textContent = pf == null ? '—' : pct(pf);
  $('o-q').textContent = q == null ? '—' : pct(q);
  $('o-oee').textContent = pf == null || q == null ? '—' : pct(av * pf * q);
}

// ---------- start ----------
const LABELS: LabelDef[] = [
  { lines: ['Entrada · pilhas de bandejas JEDEC'], x: -2.6, y: 1.55, z: 0.1 },
  { lines: ['Leitura do lote (MES)'], x: -2.2, y: 1.85, z: 0.1 },
  { lines: ['UR10e · garra de vácuo'], x: 0, y: 2.3, z: -0.1 },
  { lines: ['Saco barreira + dessecante'], x: -0.15, y: 1.9, z: 1.25 },
  { lines: ['Seladora a vácuo'], x: 0.33, y: 1.65, z: 0.85 },
  { lines: ['Etiqueta + verificação'], x: 0.81, y: 1.75, z: 1.25 },
  { lines: ['Descarte'], x: 1.67, y: 0.85, z: 0.85 },
  { lines: ['Caixa de expedição'], x: 0.85, y: 1.45, z: -0.65 },
  { lines: ['Palete'], x: 3.25, y: 1.9, z: -0.65 },
];
for (let i = 0; i < 150; i++) cell.step(1 / 30); // 5 s: the line is already moving when the page opens
cell.resetStats();
page.start({
  first: 'celula',
  views: {
    celula: { pos: [2.9, 3.4, 3.8], target: [0.15, 0.8, 0.1] },
    entrada: { pos: [-3.8, 1.9, 2.0], target: [-1.9, 0.9, 0.1] },
    linha: { pos: [0.6, 1.8, 2.5], target: [0.4, 1.0, 0.85] },
    caixa: { pos: [3.4, 2.1, -2.6], target: [1.6, 0.8, -0.65] },
    cima: { pos: [0.3, 9, 0.31], target: [0.3, 0, 0.3] },
  },
  tour: { positions: [[3.6, 2.6, 4.2], [-3.8, 2, 2.2], [-2.6, 2.3, -2.6], [3.6, 2.2, -2.8], [1.4, 1.9, 2.8]], targets: [[0, 0.9, 0.2], [-1.6, 0.9, 0.1], [0, 1, 0], [1.8, 0.8, -0.6], [0.4, 1, 0.8]], seconds: 45 },
  labels: LABELS,
  speeds: [1, 2, 4, 8],
  step: dt => cell.step(dt),
  frame: () => { cell.andons.update(performance.now() / 1000); room.ceiling.visible = stage.camera.position.y < room.h - 0.1; },
  panel,
  shotName: (w, h) => `adata-05-embalagem-${w}x${h}.png`,
});

declare global { interface Window { __a05: unknown; __a05Bench?: { minutes: number; bags: number; cartons: number; ng: number; maxIkErr: number; ms: number } } }
window.__a05 = { cell, stage, panel };
(window as unknown as { __capa: () => void }).__capa = () => { stage.camera.position.set(2.7, 3.7, 3.3); stage.controls.target.set(0.15, 0.8, 0.05); stage.controls.update(); };
if (benchMin) {
  const t0 = performance.now();
  for (let i = 0, n = Math.round(benchMin * 60 * 30); i < n; i++) cell.step(1 / 30);
  const s = cell.stats;
  window.__a05Bench = { minutes: benchMin, bags: s.bags, cartons: s.cartons, ng: s.ng, maxIkErr: Math.round(s.maxIkErr * 1e4) / 1e4, ms: Math.round(performance.now() - t0) };
} else {
  const base = import.meta.env.BASE_URL;
  useUR10eMeshes([cell.arm], `${base}assets/ur10e/`).catch(err => console.warn('UR10e meshes not loaded', err));
  useHDRI(stage.renderer, stage.scene, `${base}assets/env/empty_warehouse_01_1k.hdr`).catch(err => console.warn('HDRI not loaded', err));
}
