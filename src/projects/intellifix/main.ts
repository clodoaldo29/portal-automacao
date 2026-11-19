// Intellifix AI · Grupo Multi: final screwdriving of TV back covers on line LTV01 with two UR10e.
//
// URL options:
//   ?fluxo=integrado   the cell feeds the Transfer Flow line in the same scene, as one line
//   ?model=TL056       start with that model
//   ?bench=10          run 10 simulated minutes at once (default parameters) and publish window.__ifBench;
//                      &feed=max measures the capacity (pallets as fast as the cell takes them)
import type { LabelDef } from '../../sim/labels';
import { createMaterials } from '../../sim/materials';
import { buildRoom } from '../../sim/room';
import { useHDRI, useUR10eMeshes } from '../../sim/robots/ur-arm';
import { $ } from '../../sim/ui/dom';
import { createPage } from '../../sim/ui/page';
import type { ViewDef } from '../../sim/views';
import { FONT } from '../memory-flow/config';
import { bar, num, pct } from '../memory-flow/ui/format';
import { LABELS as TF_LABELS, LINE_X0, VIEWS as TF_VIEWS, Z_ASM } from '../transfer-flow/config';
import { DEFAULT_PARAMS as TF_DEFAULT, applyArms, createWorld, mountArms, resetLine as tfResetLine, resetStats as tfResetStats, step as tfStep } from '../transfer-flow/world';
import { DEFAULT_TIMING, plan } from './balance';
import { LAY, createCell } from './cell';
import { CELL, MODELS, SCREW_LIMITS, requiredCycleS, tvsPerPallet } from './model';
import { CLASSES, DEFAULT_SIM, NOK_HIGH, createSim, modelOf, screwsOf, type Cls, type FeedMode, type SimParams } from './sim';

const query = new URLSearchParams(location.search);
const INTEGRATED = query.get('fluxo') === 'integrado';
document.body.dataset.fluxo = INTEGRATED ? 'integrado' : 'celula';
// cell origin: alone at the origin; integrated, upstream of the Transfer Flow assembly belt, its exit unit against
// the Transfer Flow entry lift
const OX = INTEGRATED ? LINE_X0 - 0.15 - 1.3 - (LAY.x1 + 0.15 + 1.3) : 0, OZ = INTEGRATED ? Z_ASM : 0;

const page = createPage({
  stage: { shadowFrustum: INTEGRATED ? { left: -24, right: 14, top: 10, bottom: -10, near: 1, far: 80 } : { left: -7, right: 7, top: 5, bottom: -5, near: 1, far: 50 } },
  font: FONT, labelScale: 0.42, labelNear: 1.3,
});
const { stage } = page;
stage.renderer.toneMappingExposure = 0.9;
const benchMin = page.num('bench');
const M = createMaterials();

// ---------- parameters ----------
const PKEY = 'intellifix.params.v1';
const params: SimParams = { ...DEFAULT_SIM, screws: {}, timing: { ...DEFAULT_TIMING } };
if (!benchMin) {
  try {
    const s = JSON.parse(localStorage.getItem(PKEY) || 'null');
    if (s && typeof s === 'object') Object.assign(params, s, { timing: { ...DEFAULT_TIMING, ...(s.timing ?? {}) }, screws: { ...(s.screws ?? {}) } });
  } catch { /* defaults */ }
}
if (benchMin && query.get('feed') === 'max') params.feed = 'max';
const qModel = query.get('model');
if (qModel && MODELS.some(m => m.id === qModel)) params.model = qModel;
let baseNok = params.nok;
const save = () => { if (!benchMin) try { localStorage.setItem(PKEY, JSON.stringify({ ...params, nok: baseNok })); } catch { /* not saved */ } };

// ---------- scene ----------
let tf: ReturnType<typeof createWorld> | null = null;
if (INTEGRATED) {
  tf = createWorld(stage, { ...TF_DEFAULT, inch: modelOf(params.model).inch });
  tf.world.inbox = 0;
} else {
  buildRoom(stage.scene, { w: 12.5, d: 7.2, x: -0.7, z: 0.2, band: 0x1f5fd6, name: 'LTV01 · parafusamento final', font: FONT });
}
const cell = createCell(stage.scene, M, FONT, OX, OZ, { exitLift: true });
const sim = createSim(cell, stage.scene, params, {
  onExit: () => { if (tf) tf.world.inbox! += 1; },
});
if (tf) { mountArms(tf.world); applyArms(tf.world); }
const step = (dt: number) => { sim.step(dt); if (tf) tfStep(tf.world, dt); };

// ---------- controls ----------
const modelSel = $<HTMLSelectElement>('model');
for (const m of MODELS) modelSel.add(new Option(`${m.id} · ${m.inch}″`, m.id));
modelSel.value = params.model;
function restart() {
  sim.reset();
  if (tf) { tf.world.params.inch = modelOf(params.model).inch; tfResetLine(tf.world); tf.world.inbox = 0; }
  lastKey = '';
}
modelSel.addEventListener('change', () => { params.model = modelSel.value; save(); writeForm(); restart(); });
const nokBtn = $('b-nok');
nokBtn.onclick = () => {
  const on = nokBtn.getAttribute('aria-pressed') !== 'true';
  nokBtn.setAttribute('aria-pressed', String(on));
  params.nok = on ? NOK_HIGH : baseNok;
};
const fluxoBtn = $('b-fluxo');
fluxoBtn.setAttribute('aria-pressed', String(INTEGRATED));
fluxoBtn.textContent = INTEGRATED ? 'Só a célula' : 'Fluxo integrado';
fluxoBtn.onclick = () => { const u = new URL(location.href); if (INTEGRATED) u.searchParams.delete('fluxo'); else u.searchParams.set('fluxo', 'integrado'); location.href = u.toString(); };

const f = (id: string) => $<HTMLInputElement>(id);
const val = (id: string, d: number, lo: number, hi: number) => { const x = Number(f(id).value); return f(id).value !== '' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
function splitHint() {
  const m = modelOf(params.model), p = plan(m, params.timing, screwsOf(params, m));
  const [a, b] = p.robots.map(r => r.points.length);
  $('p-split').textContent = tvsPerPallet(m.inch) === 2
    ? `${m.id}: 2 TVs por pallet, cada robô parafusa a sua (${a} + ${b} parafusos). Ciclo calculado: ${num(p.cycleS, 1)} s para ${num(p.requiredS, 1)} s exigidos.`
    : `${m.id}: 1 TV por pallet, os robôs dividem os parafusos (${a} + ${b}), sem entrar juntos na faixa central. Ciclo calculado: ${num(p.cycleS, 1)} s para ${num(p.requiredS, 1)} s exigidos.`;
}
function writeForm() {
  const m = modelOf(params.model), t = params.timing;
  f('p-screws').value = String(screwsOf(params, m));
  $<HTMLSelectElement>('p-feed').value = t.feed;
  f('p-screwS').value = String(t.screwS); f('p-selfTapS').value = String(t.selfTapS);
  f('p-exchangeS').value = String(t.exchangeS); f('p-visionS').value = String(t.visionS);
  $<HTMLSelectElement>('p-flow').value = params.feed;
  f('p-nok').value = String(Math.round(baseNok * 1000) / 10);
  f('p-reworkS').value = String(params.reworkS);
  splitHint();
}
writeForm();
$<HTMLFormElement>('params').addEventListener('submit', e => {
  e.preventDefault();
  const m = modelOf(params.model), d = DEFAULT_TIMING, t = params.timing;
  const n = Math.round(val('p-screws', m.screws, SCREW_LIMITS[0], SCREW_LIMITS[1]));
  if (n === m.screws) delete params.screws[m.id]; else params.screws[m.id] = n;
  t.feed = $<HTMLSelectElement>('p-feed').value === 'pick' ? 'pick' : 'blow';
  t.screwS = val('p-screwS', d.screwS, 1.2, 3); t.selfTapS = val('p-selfTapS', d.selfTapS, 0, 1.5);
  t.exchangeS = val('p-exchangeS', d.exchangeS, 2, 6); t.visionS = val('p-visionS', d.visionS, 0.3, 2);
  params.feed = ($<HTMLSelectElement>('p-flow').value as FeedMode) === 'max' ? 'max' : 'linha';
  baseNok = val('p-nok', DEFAULT_SIM.nok * 100, 0, 30) / 100;
  params.nok = nokBtn.getAttribute('aria-pressed') === 'true' ? NOK_HIGH : baseNok;
  params.reworkS = Math.round(val('p-reworkS', DEFAULT_SIM.reworkS, 5, 120));
  save(); writeForm(); restart();
  const p = plan(m, t, n);
  $('p-status').textContent = `Aplicado. ${m.id} com ${n} parafusos por TV: ciclo calculado de ${num(p.cycleS, 1)} s (${pct(p.load)} do exigido)${p.ok ? '' : ' — não atende a cadência'}. Linha reiniciada e indicadores zerados.`;
});
$('p-reset').onclick = () => {
  Object.assign(params.timing, DEFAULT_TIMING); params.screws = {}; params.feed = DEFAULT_SIM.feed; params.reworkS = DEFAULT_SIM.reworkS;
  baseNok = DEFAULT_SIM.nok; params.nok = nokBtn.getAttribute('aria-pressed') === 'true' ? NOK_HIGH : baseNok;
  save(); writeForm(); restart();
  $('p-status').textContent = 'Valores do estudo de tempos restaurados. Linha reiniciada.';
};

// ---------- panel ----------
const rowsOf = (id: string, names: string[], cols: number) => {
  const body = $<HTMLTableSectionElement>(id);
  return names.map(n => { const tr = body.insertRow(); tr.insertCell().textContent = n; for (let i = 1; i < cols; i++) tr.insertCell(); return tr; });
};
const robRows = rowsOf('rob-rows', ['Robô 1', 'Robô 2'], 4);
const NOK_CLS = (Object.keys(CLASSES) as Cls[]).filter(c => c !== 'C01');
const clsRows = rowsOf('cls-rows', NOK_CLS.map(c => `${c} · ${CLASSES[c]}`), 2);
const tfRows = INTEGRATED ? rowsOf('tf-rows', ['Inspeção com IA (UR10e)', 'Transfer 1 (UR30)', 'Transfer 2 (UR30)'], 3) : [];
const cycBody = $<HTMLTableSectionElement>('cyc-rows'), logBody = $<HTMLTableSectionElement>('log-rows'), ptsBody = $<HTMLTableSectionElement>('pts-rows');
let lastKey = '', lastLog = '';
const cm = (m: number) => (Number.isFinite(m) ? `${num(m * 100, 0)} cm` : '—');

function cycleTable() {
  cycBody.textContent = '';
  for (const m of MODELS) {
    const p = plan(m, params.timing, screwsOf(params, m)), tr = cycBody.insertRow();
    const name = tr.insertCell(); name.textContent = `${m.id} · ${m.inch}″`;
    const s = document.createElement('small'); s.textContent = `${screwsOf(params, m)} parafusos · ${tvsPerPallet(m.inch)} TV${tvsPerPallet(m.inch) > 1 ? 's' : ''}/pallet`; name.appendChild(s);
    const c = tr.insertCell(); c.textContent = `${num(p.cycleS, 1)} s`; if (!p.ok) c.style.color = 'var(--alarm)';
    tr.insertCell().textContent = `${num(p.requiredS, 1)} s`;
    const o = tr.insertCell(); o.textContent = pct(p.load); o.appendChild(bar(p.load));
    if (m.id === params.model) tr.style.outline = '1px solid var(--accent)';
  }
  const worst = MODELS.map(m => plan(m, params.timing, screwsOf(params, m))).sort((a, b) => b.load - a.load)[0];
  $('cyc-note').textContent = worst.ok
    ? `Os sete modelos atendem a cadência. O mais apertado é o ${worst.model.id}, com ${pct(worst.load)} do ciclo ocupado: ${worst.robots[0].points.length} parafusos por robô.`
    : `O ${worst.model.id} não atende: ciclo de ${num(worst.cycleS, 1)} s para ${num(worst.requiredS, 1)} s exigidos. Reduza o tempo por parafuso, use alimentação por sopro ou reveja a quantidade de parafusos.`;
}

function panel() {
  const s = sim.stats, T = Math.max(1, s.t), m = modelOf(params.model), req = requiredCycleS(m);
  const uph = s.t > 30 && s.tvs ? (s.tvs / s.t) * 3600 : null;
  $('k-uph').textContent = uph ? num(uph, 0) : '—';
  $('k-target').textContent = String(m.uph);
  $('k-cycle').textContent = s.pallets ? `${num(s.cycleSum / s.pallets, 1)} s` : '—';
  $('k-tvs').textContent = String(s.tvs);
  const p = plan(m, params.timing, screwsOf(params, m));
  $('k-note').textContent = params.feed === 'linha'
    ? `Pallets chegando na cadência da linha: ${m.uph} TVs/h, um pallet a cada ${num(req, 1)} s. A célula precisa de ${num(p.cycleS, 1)} s por pallet${s.waitLineT > 1 ? `; a linha já esperou ${num(s.waitLineT, 0)} s pela célula` : ''}.`
    : `Teste de capacidade: pallets chegando o mais rápido possível. Capacidade calculada: ${num(p.uph, 0)} TVs/h.`;
  const key = JSON.stringify([params.model, params.screws, params.timing]);
  if (key !== lastKey) { lastKey = key; cycleTable(); splitHint(); }
  // robots
  ([0, 1] as const).forEach(r => {
    const tr = robRows[r];
    tr.cells[1].textContent = String(s.screws[r]);
    tr.cells[2].textContent = pct(s.busy[r] / T); tr.cells[2].appendChild(bar(s.busy[r] / T));
    tr.cells[3].textContent = sim.robotState(r);
  });
  $('rob-note').textContent = tvsPerPallet(m.inch) === 2
    ? `${m.id}: cada robô parafusa a TV do seu lado (${p.robots[0].points.length} + ${p.robots[1].points.length}). Na faixa central (${num(CELL.zone * 200, 0)} cm entre as TVs) só entra um por vez: o robô 1 faz esses pontos primeiro e o robô 2 por último${s.zoneWait > 0.5 ? `; espera acumulada de ${num(s.zoneWait, 1)} s` : ''}.`
    : `${m.id}: os dois dividem os parafusos da mesma TV (${p.robots[0].points.length} + ${p.robots[1].points.length}), cada um na metade do seu lado. Na faixa central só entra um por vez${s.zoneWait > 0.5 ? `; espera acumulada de ${num(s.zoneWait, 1)} s` : ''}.`;
  $('s-arms').textContent = cm(s.minArmArm);
  $('s-clear').textContent = cm(s.minClear);
  // quality
  $('q-ok').textContent = String(s.tvsOk);
  $('q-nok').textContent = String(s.tvsNok);
  NOK_CLS.forEach((c, i) => { clsRows[i].cells[1].textContent = String(s.cls[c]); });
  // Torque Flow
  const lk = sim.log.map(r => r.serial + r.reworked).join();
  if (lk !== lastLog) {
    lastLog = lk;
    logBody.textContent = '';
    for (const r of sim.log.slice(0, 8)) {
      const tr = logBody.insertRow();
      const a = tr.insertCell(); a.textContent = r.serial; const sm = document.createElement('small'); sm.textContent = `${num(r.t / 60, 1)} min`; a.appendChild(sm);
      tr.insertCell().textContent = `${r.screws - r.nok}/${r.screws} OK`;
      const v = tr.insertCell(); v.textContent = r.ok ? 'OK' : r.reworked ? 'NOK · retrabalhada' : 'NOK · retida'; v.className = r.ok ? 'ok' : 'nok';
    }
    ptsBody.textContent = '';
    const last = sim.log[0];
    $('pts-cap').textContent = last ? `Última TV · ${last.serial}` : 'Última TV · ponto a ponto';
    for (const q of last?.points ?? []) {
      const tr = ptsBody.insertRow();
      tr.insertCell().textContent = `${(q.i % last!.screws) + 1}${q.selfTap ? ' (auto)' : ''}`;
      tr.insertCell().textContent = `R${q.robot + 1}`;
      tr.insertCell().textContent = `${num(q.torque, 2)} N·m`;
      tr.insertCell().textContent = `${num(q.angle, 0)}°`;
      const v = tr.insertCell(); v.textContent = q.ok ? 'OK' : q.cls === 'C01' ? 'NOK torque/ângulo' : `NOK ${q.cls}`; v.className = q.ok ? 'ok' : 'nok';
    }
  }
  // integrated: Transfer Flow
  if (tf) {
    const w = tf.world, tt = Math.max(1, w.stats.simT);
    const res = [[w.stats.inspTV, w.insp.busyT], ...w.robots.map(r => [r.count, r.busyT])];
    res.forEach(([n, b], i) => { const c = tfRows[i].cells; c[1].textContent = String(n); c[2].textContent = pct(b / tt); c[2].appendChild(bar(b / tt)); });
    $('tf-note').textContent = `O Transfer Flow recebe só as TVs liberadas pelo parafusamento (${w.inbox ?? 0} aguardando na troca de base). A troca da base colchão (TVs lado a lado na largura) para o gabarito do Transfer Flow (TVs uma atrás da outra) ainda é um ponto a definir com o Grupo Multi.`;
  }
  // OEE
  const av = 1 - s.reworkT / T, pf = uph ? Math.min(1, uph / m.uph) : null, q = s.tvs ? s.tvsOk / s.tvs : null;
  $('o-av').textContent = pct(av);
  $('o-pf').textContent = pf == null ? '—' : pct(pf);
  $('o-q').textContent = q == null ? '—' : pct(q);
  $('o-oee').textContent = pf == null || q == null ? '—' : pct(av * pf * q);
}

// ---------- views and labels (cell frame → world) ----------
const W = (x: number, y: number, z: number): [number, number, number] => [OX + x, y, OZ + z];
const v = (pos: [number, number, number], target: [number, number, number]): ViewDef => ({ pos: W(...pos), target: W(...target) });
const { cab } = LAY;
const VIEWS: Record<string, ViewDef> = {
  celula: v([4.2, 3.4, 5.6], [-0.3, 1.0, 0]),
  robos: v([1.9, 2.3, 2.4], [0, 1.0, 0]),
  entrada: v([-4.4, 2.5, 3.8], [-2.0, 0.9, 0]),
  cima: v([-0.4, 10.5, 0.01], [-0.4, 0, 0]),
  ...(INTEGRATED ? { fluxo: { pos: [-8.5, 8.5, 12.5] as [number, number, number], target: [-7.5, 0.8, 0.5] as [number, number, number] }, transfer: TF_VIEWS.robots } : {}),
};
const LABELS: LabelDef[] = [
  { lines: ['Entrada · pré-parada'], x: W(LAY.preX, 0, 0)[0], y: 1.75, z: OZ },
  { lines: ['Célula Intellifix AI · 2× UR10e'], x: OX, y: 2.85, z: OZ },
  { lines: ['Alimentador de parafusos M4'], x: W(0.62, 0, 0)[0], y: 1.6, z: OZ + 1.05 },
  { lines: ['IHM da célula'], x: W(0.75, 0, 0)[0], y: 1.95, z: OZ + cab.z + 0.12 },
  { lines: ['Quadro elétrico · CLP e', 'controladores de torque'], x: W(-0.55, 0, 0)[0], y: 2.2, z: OZ - cab.z - 0.45 },
  { lines: ['Unidade de ar (FRL)'], x: W(-0.7, 0, 0)[0], y: 1.6, z: OZ - cab.z - 0.06 },
  INTEGRATED
    ? { lines: ['Troca de base: colchão →', 'gabarito do Transfer Flow (a definir)'], x: W(LAY.x1 + 0.15, 0, 0)[0], y: 2.75, z: OZ }
    : { lines: ['Saída · próximo posto'], x: W(LAY.x1 + 0.15, 0, 0)[0], y: 2.6, z: OZ },
  ...(INTEGRATED ? TF_LABELS : []),
];

// warm-up: the cell is already working when the page opens (arms without IK while it runs, then with IK)
sim.setIk(false);
for (let i = 0; i < 90 * 15; i++) step(1 / 15);
sim.setIk(true);
for (let i = 0; i < 12 * 30; i++) step(1 / 30);
// open with a pallet at the stop and the robots mid-way through it
for (let i = 0; i < 90 * 30 && sim.phase !== 'work'; i++) step(1 / 30);
for (let i = 0; i < 6 * 30; i++) step(1 / 30);
sim.resetStats();
if (tf) tfResetStats(tf.world);

const run = page.start({
  first: INTEGRATED ? 'fluxo' : 'celula',
  views: VIEWS,
  tour: {
    positions: [W(-4.4, 2.5, 3.8), W(1.9, 2.3, 2.4), W(2.2, 2.2, -2.6), W(4.6, 3.2, 3.6), W(4.2, 3.4, 5.6)],
    targets: [W(-2.0, 0.9, 0), W(0, 1.0, 0), W(0, 1.0, 0), W(1.0, 1.0, 0), W(-0.3, 1.0, 0)],
    seconds: 45,
  },
  labels: LABELS,
  speeds: [1, 2, 4, 8],
  step,
  frame: dt => {
    const t = performance.now() / 1000;
    sim.frame(dt, t);
    if (tf) { tf.andons.update(t); tf.ceiling.visible = stage.camera.position.y < 12.4; }
  },
  panel,
  shotName: (w, h) => `intellifix-ai-${params.model}-${w}x${h}.png`,
});

declare global {
  interface Window {
    __if: unknown;
    __ifBench?: { model: string; feed: FeedMode; minutes: number; tvs: number; pallets: number; uph: number; cycle: number; planCycle: number; perRobot: number[]; minArmArm: number; minClear: number; minClearAt: string; maxIkErr: number; tfMoved: number | null; ms: number };
  }
}
window.__if = { sim, params, stage, panel, step, plan, tf, run };
(window as unknown as { __capa: () => void }).__capa = () => {
  page.labels.setVisible(false);
  stage.camera.position.set(OX + 2.9, 3.5, OZ - 3.1); stage.controls.target.set(OX - 0.1, 0.95, OZ + 0.1); stage.controls.update();
};
if (benchMin) {
  run.setPlay(false);
  const t0 = performance.now();
  for (let i = 0, n = Math.round(benchMin * 60 * 30); i < n; i++) step(1 / 30);
  const s = sim.stats, m = modelOf(params.model);
  const r = (x: number, k = 1000) => Math.round(x * k) / k;
  window.__ifBench = {
    model: m.id, feed: params.feed, minutes: benchMin, tvs: s.tvs, pallets: s.pallets, uph: r((s.tvs / s.t) * 3600, 10),
    cycle: r(s.pallets ? s.cycleSum / s.pallets : 0, 100), planCycle: r(plan(m, params.timing, screwsOf(params, m)).cycleS, 100),
    perRobot: [...s.screws], minArmArm: r(s.minArmArm), minClear: r(s.minClear), minClearAt: s.minClearAt, maxIkErr: r(s.maxIkErr, 1e4),
    tfMoved: tf ? tf.world.stats.moved : null, ms: Math.round(performance.now() - t0),
  };
} else {
  const base = import.meta.env.BASE_URL;
  const arms = [...cell.arms, ...(tf ? [...tf.world.robots.map(r => r.arm), tf.world.insp.arm] : [])];
  useUR10eMeshes(arms, `${base}assets/ur10e/`).catch(err => console.warn('UR10e meshes not loaded', err));
  useHDRI(stage.renderer, stage.scene, `${base}assets/env/empty_warehouse_01_1k.hdr`).catch(err => console.warn('HDRI not loaded', err));
}
