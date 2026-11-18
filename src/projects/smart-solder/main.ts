// Smart Solder AI · Grupo Multi: one page per soldering architecture (<body data-arch="A"> or "B").
//
// URL options: ?bench=10 runs 10 simulated minutes at once (default parameters) and publishes window.__ssBench
// (skips the original robot meshes and the HDRI).
import { createRng } from '../../sim/des';
import { pct } from '../../sim/kpi';
import type { LabelDef } from '../../sim/labels';
import { createMaterials } from '../../sim/materials';
import type { Cobot } from '../../sim/robots/ur-arm';
import { useHDRI, useUR10eMeshes } from '../../sim/robots/ur-arm';
import { $ } from '../../sim/ui/dom';
import { createPage } from '../../sim/ui/page';
import type { ViewDef } from '../../sim/views';
import { FONT } from '../memory-flow/config';
import { bar, num } from '../memory-flow/ui/format';
import { createArchA } from './arch-a';
import { createArchB, type RobotStat } from './arch-b';
import { createLine, lineUph } from './line';
import {
  A, A_COBOT_S, DEFAULT_SOLDER, LIMITS, MAGAZINE, OUT, ST, NOK_HIGH, activeCells, blankS, capacityA, ledStationS, springStationS, strategiesB, type Arch, type SolderParams,
} from './model';

const ARCH: Arch = document.body.dataset.arch === 'A' ? 'A' : 'B';
const page = createPage({ stage: { shadowFrustum: { left: -9, right: 11, top: 6, bottom: -6, near: 1, far: 60 } }, font: FONT, labelScale: 0.42, labelNear: 1.4 });
const { stage } = page;
stage.renderer.toneMappingExposure = 0.9;
const benchMin = page.num('bench');
const M = createMaterials();

// ---------- parameters ----------
const PKEY = `smartsolder.${ARCH}.params.v1`;
const params: SolderParams = { ...DEFAULT_SOLDER, cells: [...DEFAULT_SOLDER.cells] };
let baseNok = params.nok;
if (!benchMin) {
  try {
    const s = JSON.parse(localStorage.getItem(PKEY) || 'null');
    if (s && typeof s === 'object') { Object.assign(params, s); params.cells = Array.isArray(s.cells) && s.cells.length === 3 ? s.cells.map(Boolean) : [true, true, true]; baseNok = params.nok; }
  } catch { /* defaults */ }
}

const line = createLine(stage.scene, M, FONT, params, createRng(11));
interface Zone {
  step: (dt: number) => void; setIk: (on: boolean) => void; resetStats: () => void; arms: Cobot[];
  stats: { robots: RobotStat[]; maxIkErr: number; minClear: number; minClearAt: string };
  robotState: (i: number) => string;
}
const za = ARCH === 'A' ? createArchA(stage.scene, M, FONT, line, params) : null;
const zb = ARCH === 'B' ? createArchB(stage.scene, M, FONT, line, params) : null;
const zone: Zone = (za ?? zb)!;
const step = (dt: number) => { line.step(dt); zone.step(dt); };

const f = (id: string) => $<HTMLInputElement>(id);
const val = (id: string, d: number, [lo, hi]: readonly [number, number]) => { const x = Number(f(id).value); return f(id).value !== '' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
function writeForm() {
  f('p-boards').value = String(params.boards); f('p-points').value = String(params.points); f('p-pointS').value = String(params.pointS);
  f('p-alignS').value = String(params.alignS); f('p-target').value = String(params.target); f('p-nok').value = String(Math.round(baseNok * 1000) / 10);
  f('p-ledS').value = String(params.ledS); f('p-springS').value = String(params.springS);
  params.cells.forEach((on, i) => { f(`p-cell${i}`).checked = on; });
}
writeForm();
const nokBtn = $('b-nok');
$<HTMLFormElement>('params').addEventListener('submit', e => {
  e.preventDefault();
  const d = DEFAULT_SOLDER;
  const cells = [0, 1, 2].map(i => f(`p-cell${i}`).checked);
  if (!cells.some(Boolean)) { $('p-status').textContent = 'Deixe pelo menos uma célula ligada.'; return; }
  params.boards = Math.round(val('p-boards', d.boards, LIMITS.boards)); params.points = Math.round(val('p-points', d.points, LIMITS.points));
  params.pointS = val('p-pointS', d.pointS, LIMITS.pointS); params.alignS = val('p-alignS', d.alignS, LIMITS.alignS);
  params.target = Math.round(val('p-target', d.target, LIMITS.target)); baseNok = val('p-nok', d.nok * 100, LIMITS.nok) / 100;
  params.ledS = val('p-ledS', d.ledS, LIMITS.ledS); params.springS = val('p-springS', d.springS, LIMITS.springS);
  params.cells = cells;
  params.nok = nokBtn.getAttribute('aria-pressed') === 'true' ? NOK_HIGH : baseNok;
  writeForm();
  try { localStorage.setItem(PKEY, JSON.stringify({ ...params, nok: baseNok })); } catch { /* not saved */ }
  line.resetStats(); zone.resetStats();
  $('p-status').textContent = `Aplicado. Novos blanks com ${params.boards} PCBs e ${params.points} pontos por PCB; os que já estão na linha seguem como estavam. Indicadores zerados.`;
});
nokBtn.onclick = () => {
  const on = nokBtn.getAttribute('aria-pressed') !== 'true';
  nokBtn.setAttribute('aria-pressed', String(on));
  params.nok = on ? NOK_HIGH : baseNok;
};
$('b-other').onclick = () => { location.href = `/projetos/smart-solder-${ARCH === 'A' ? 'b' : 'a'}/`; };

// ---------- panel ----------
const rowsOf = (id: string, names: string[], cols: number) => {
  const body = $<HTMLTableSectionElement>(id);
  return names.map(n => { const tr = body.insertRow(); tr.insertCell().textContent = n; for (let i = 1; i < cols; i++) tr.insertCell(); return tr; });
};
const capRows = rowsOf('cap-rows', ['Meta', 'Capacidade calculada', 'Capacidade medida', 'Atendimento da meta'], 2);
capRows[3].className = 'total';
const robotNames = ARCH === 'A' ? ['Cartesiano 1', 'Cartesiano 2', 'Cartesiano 3', 'Braço (alimenta)'] : ['Robô 1', 'Robô 2', 'Robô 3'];
const robRows = rowsOf('rob-rows', robotNames, 4);
const stRows = rowsOf('st-rows', ['Posto 1 · blank e LEDs', 'Posto 2 · molas', 'Retirada do blank', 'UnLoader · magazine', 'AMR'], 3);
const cmpBody = $<HTMLTableSectionElement>('cmp-rows');
const AMR_STATE: Record<string, string> = { docked: 'na doca', lower: 'trocando', out: 'recebendo o cheio', shift: 'trocando', in: 'entregando o vazio', raise: 'trocando', go: 'indo à montagem', away: 'na montagem e teste', back: 'voltando' };

function strategyTable() {
  cmpBody.textContent = '';
  const add = (cells: (string | { t: string; best?: boolean; small?: string })[]) => {
    const tr = cmpBody.insertRow();
    cells.forEach(c => { const td = tr.insertCell(); if (typeof c === 'string') td.textContent = c; else { td.textContent = c.t; if (c.best) td.className = 'best'; if (c.small) { const s = document.createElement('small'); s.textContent = c.small; td.appendChild(s); } } });
  };
  if (ARCH === 'B') {
    const st = strategiesB(params), best = Math.max(...st.map(s => s.uph));
    st.forEach(s => add([{ t: s.name + (s.id === 'lote' ? ' (em uso)' : ''), small: s.how }, { t: `${num(s.cycle, 0)} s`, best: s.uph === best }, { t: num(s.uph, 0), best: s.uph === best }]));
  } else {
    const c = capacityA(params);
    add([{ t: `${activeCells(params)} cartesianos`, small: `cada um: ${num(blankS(params), 0)} s de solda por blank` }, { t: `${num(c.cellCycle / Math.max(1, activeCells(params)), 0)} s`, best: c.bottleneck === 'cartesianos' }, { t: num(c.cellsUph, 0), best: c.bottleneck === 'cartesianos' }]);
    add([{ t: 'Braço (alimentação)', small: `retira, carrega, descarrega e devolve: ${num(A_COBOT_S, 0)} s por blank` }, { t: `${num(A_COBOT_S, 0)} s`, best: c.bottleneck === 'cobot' }, { t: num(c.cobotUph, 0), best: c.bottleneck === 'cobot' }]);
  }
}
let lastKey = '';

function panel() {
  const s = line.stats, z = zone.stats, T = Math.max(1, s.t);
  const uph = lineUph(s, params.boards);
  const calc = ARCH === 'B' ? strategiesB(params)[0].uph : capacityA(params).uph;
  $('k-uph').textContent = uph ? num(uph, 0) : '—';
  $('k-cycle').textContent = uph ? `${num((3600 * params.boards) / uph, 0)} s` : '—';
  $('k-boards').textContent = String(s.inspectedBoards);
  $('k-target').textContent = String(params.target);
  capRows[0].cells[1].textContent = `${params.target} placas/h`;
  capRows[1].cells[1].textContent = `${num(calc, 0)} placas/h`;
  capRows[2].cells[1].textContent = uph ? `${num(uph, 0)} placas/h` : 'medindo…';
  capRows[3].cells[1].textContent = uph ? pct(uph / params.target) : '—';
  const gap = calc / params.target - 1;
  $('cap-note').textContent = gap >= 0
    ? `Pelo cálculo, ${activeCells(params)} ${ARCH === 'A' ? 'cartesianos' : 'células'} atendem a meta com ${pct(gap)} de folga, com ${params.boards} PCBs por blank e ${params.points} pontos por PCB. A medida aparece depois de 2 minutos.`
    : `Pelo cálculo, ficam ${pct(-gap)} abaixo da meta. Ligue as três ${ARCH === 'A' ? 'cartesianos' : 'células'} ou reduza o tempo por ponto.`;

  // balancing
  const totalBlanks = z.robots.reduce((a, r) => a + r.blanks, 0);
  z.robots.forEach((r, i) => {
    const tr = robRows[i];
    tr.cells[1].textContent = String(r.blanks);
    tr.cells[2].textContent = pct(r.busyT / T); tr.cells[2].appendChild(bar(r.busyT / T));
    tr.cells[3].textContent = zone.robotState(i);
  });
  if (za) {
    const tr = robRows[3];
    tr.cells[1].textContent = String(Math.floor(za.stats.transfers / 2));
    tr.cells[2].textContent = pct(za.stats.cobotT / T); tr.cells[2].appendChild(bar(za.stats.cobotT / T));
    tr.cells[3].textContent = za.cobotBusy ? 'movendo blank' : 'livre';
  }
  const shares = z.robots.map(r => (totalBlanks ? r.blanks / totalBlanks : 0)).filter((_, i) => params.cells[i]);
  $('bal-note').textContent = totalBlanks >= 3
    ? `Divisão dos blanks soldados: ${shares.map(x => pct(x)).join(' · ')}. ${ARCH === 'B' ? 'Os pallets entram em lote de três: cada robô solda um blank inteiro, os três ao mesmo tempo.' : 'O braço atende os cartesianos em rodízio: cada um solda um blank em três.'}`
    : `Os ${ARCH === 'A' ? 'cartesianos' : 'robôs'} recebem o mesmo número de blanks. A divisão aparece depois dos primeiros blanks soldados.`;
  const key = JSON.stringify([params.boards, params.points, params.pointS, params.alignS, params.cells]);
  if (key !== lastKey) { lastKey = key; strategyTable(); }

  // quality
  $('q-ok').textContent = String(s.okBoards);
  $('q-nok').textContent = String(s.nokBoards);
  $('q-inc').textContent = String(s.incBoards);
  $('q-seg').textContent = String(s.nokBlanks + s.incBlanks);
  // stations and logistics
  const ledCap = (3600 * params.boards) / ledStationS(params), springCap = (3600 * params.boards) / springStationS(params);
  const st = [
    [s.ledT / T, `${num(ledCap, 0)} placas/h no máximo`],
    [s.springT / T, `${num(springCap, 0)} placas/h no máximo`],
    [s.removalT / T, s.blockedT > 5 ? `esperou ${num(s.blockedT, 0)} s pela esteira` : 'manual'],
    [line.magazine ? line.magazine.fill / MAGAZINE.slots : 0, `${line.magazine ? line.magazine.fill : 0}/${MAGAZINE.slots} blanks · ${s.magazines} cheios`],
    [null, `${AMR_STATE[line.amrPhase] ?? line.amrPhase} · ${s.deliveries} entregues`],
  ] as [number | null, string][];
  st.forEach(([u, txt], i) => { const c = stRows[i].cells; c[1].textContent = u == null ? '' : pct(u); if (u != null) c[1].appendChild(bar(u)); c[2].textContent = txt; });
  // OEE
  const pf = uph ? Math.min(1, uph / params.target) : null, q = s.inspectedBoards ? s.okBoards / s.inspectedBoards : null;
  $('o-av').textContent = '100%';
  $('o-pf').textContent = pf == null ? '—' : pct(pf);
  $('o-q').textContent = q == null ? '—' : pct(q);
  $('o-oee').textContent = pf == null || q == null ? '—' : pct(pf * q);
}

// ---------- scene views and labels ----------
const LABELS: LabelDef[] = [
  { lines: ['1 · Blank no pallet + LEDs IR'], x: ST.load, y: 2.05, z: -0.6 },
  { lines: ['2 · Inserção das molas'], x: ST.spring, y: 2.05, z: -0.6 },
  { lines: ['3 · Identificação do modelo', 'e inspeção pré-solda'], x: ST.pre, y: 2.15, z: 0 },
  ...(ARCH === 'B'
    ? [{ lines: ['Lote de 3 pallets'], x: ST.buffer - 0.5, y: 1.45, z: 0 }, { lines: ['4 · Soldagem: 3 células com braço articulado'], x: 0, y: 2.65, z: -0.4 }]
    : [{ lines: ['4 · Soldagem: braço + 3 robôs cartesianos'], x: 0, y: 2.65, z: -0.4 }, { lines: ['Retira o blank'], x: A.pick, y: 1.3, z: 0.1 }, { lines: ['Devolve soldado'], x: A.place, y: 1.3, z: 0.1 }]),
  { lines: ['5 · Inspeção pós-solda', 'OK · NOK · inconclusivo'], x: ST.post, y: 2.15, z: 0 },
  { lines: ['6 · Retirada do blank'], x: ST.removal + 0.6, y: 2.05, z: -0.6 },
  { lines: ['Separação automática NOK'], x: OUT.sorter, y: 1.4, z: 0.62 },
  { lines: ['UnLoader · magazine'], x: OUT.x1 + 0.22, y: 2.05, z: 0 },
  { lines: ['AMR · magazines', 'para montagem e teste'], x: OUT.x1 + 0.8, y: 1.55, z: -0.3 },
  { lines: ['Retorno automático dos pallets'], x: -1.5, y: 0.55, z: 0.55 },
];
const VIEWS: Record<string, ViewDef> = {
  linha: { pos: [1.2, 5.8, 9.2], target: [1.0, 0.8, 0] },
  solda: ARCH === 'B' ? { pos: [0.6, 2.4, 3.2], target: [0, 1.0, -0.35] } : { pos: [-1.6, 3.0, 3.4], target: [0, 0.9, -0.2] },
  manual: { pos: [-3.7, 2.2, 2.9], target: [-4.4, 1.0, -0.3] },
  inspecao: { pos: [3.6, 2.0, 2.6], target: [3.2, 1.0, -0.1] },
  saida: { pos: [5.0, 2.5, 3.6], target: [6.1, 0.9, 0.1] },
  cima: { pos: [1.0, 14, 0.62], target: [1.0, 0, 0.6] },
};

// warm-up: the line is already producing when the page opens (robots follow without IK while it runs)
zone.setIk(false);
for (let i = 0; i < 280 * 15; i++) step(1 / 15);
zone.setIk(true); // the last 20 s with IK, so the arms are already following their path when the measurement starts
for (let i = 0; i < 20 * 30; i++) step(1 / 30);
line.resetStats(); zone.resetStats();

page.start({
  first: 'linha',
  views: VIEWS,
  tour: { positions: [[-3.4, 2.6, 3.4], [-0.4, 2.6, 3.4], [3.4, 2.3, 3.0], [5.4, 2.6, 3.8], [1.2, 5.8, 9.2]], targets: [[-4.4, 1, -0.2], [0, 1, -0.4], [3.2, 1, 0], [6.2, 0.9, 0.1], [1.0, 0.8, 0]], seconds: 50 },
  labels: LABELS,
  speeds: [1, 2, 4, 8, 16],
  step,
  frame: () => { line.andons.update(performance.now() / 1000); },
  panel,
  shotName: (w, h) => `smart-solder-${ARCH.toLowerCase()}-${w}x${h}.png`,
});

declare global { interface Window { __ss: unknown; __ssBench?: { arch: Arch; minutes: number; boards: number; blanks: number; nokBlanks: number; perRobot: number[]; maxIkErr: number; minClear: number; minClearAt: string; ms: number } } }
window.__ss = { line, zone, za, zb, params, stage, panel, step };
(window as unknown as { __capa: () => void }).__capa = () => { stage.camera.position.set(-1.4, 3.3, 5.0); stage.controls.target.set(0.6, 0.95, -0.3); stage.controls.update(); };
if (benchMin) {
  const t0 = performance.now();
  for (let i = 0, n = Math.round(benchMin * 60 * 30); i < n; i++) step(1 / 30);
  const s = line.stats, z = zone.stats;
  window.__ssBench = {
    arch: ARCH, minutes: benchMin, boards: s.inspectedBoards, blanks: s.okBlanks + s.nokBlanks + s.incBlanks, nokBlanks: s.nokBlanks + s.incBlanks,
    perRobot: z.robots.map(r => r.blanks), maxIkErr: Math.round(z.maxIkErr * 1e4) / 1e4, minClear: Math.round(z.minClear * 1000) / 1000, minClearAt: z.minClearAt, ms: Math.round(performance.now() - t0),
  };
} else {
  const base = import.meta.env.BASE_URL;
  useUR10eMeshes(zone.arms, `${base}assets/ur10e/`).catch(err => console.warn('UR10e meshes not loaded', err));
  useHDRI(stage.renderer, stage.scene, `${base}assets/env/empty_warehouse_01_1k.hdr`).catch(err => console.warn('HDRI not loaded', err));
}
