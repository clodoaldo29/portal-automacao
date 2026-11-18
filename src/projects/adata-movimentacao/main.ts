// Project 06 · Adata Technology: automated internal material handling (AMRs) in the clean rooms and test areas.
// Runs on the plant model of Memory Flow (layout, route of 35 operations, discrete-event engine), with the focus
// on the fleet: routes, pick-up and drop points, charging docks, each vehicle, manual × AMR and fleet sizing.
//
// URL options: ?bench=14 runs 14 days after the warm-up (default parameters, AMRs) and publishes window.__a06Bench.
import * as THREE from 'three';
import { at, std } from '../../sim/kit';
import type { LabelDef } from '../../sim/labels';
import { $ } from '../../sim/ui/dom';
import { createPage } from '../../sim/ui/page';
import { createActors } from '../memory-flow/actors';
import { FONT, STATUS_COLOR } from '../memory-flow/config';
import { WARMUP_DAYS, createEngine, plantGraph, runScenario, type Engine, type Metrics } from '../memory-flow/engine';
import { LANES, PARKING, RACKS, DOCK_IN } from '../memory-flow/layout';
import { W, buildPlant } from '../memory-flow/plant3d';
import { DEFAULT_PARAMS, STEPS, cloneParams, type Params, type ScenarioId } from '../memory-flow/process';
import { clock, hours, minutes, num, pct } from '../memory-flow/ui/format';

const page = createPage({ stage: { shadowFrustum: { left: -75, right: 75, top: 70, bottom: -70, near: 0.5, far: 120 }, fog: { near: 320, far: 700 }, floor: { w: 260, d: 220 }, cameraFar: 800, maxDistance: 230 }, font: FONT, labelScale: 2.2 });
const { stage } = page;
stage.renderer.toneMappingExposure = 0.9;
const benchDays = page.num('bench');

// ---------- scene: plant, lots and vehicles, route network, points and docks ----------
const plant = buildPlant(stage.scene);
const actors = createActors(stage.scene, plant);
const routes = new THREE.Group();
stage.scene.add(routes);
{
  const laneMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.75, depthWrite: false });
  for (const l of LANES) {
    const len = Math.hypot(l.b.x - l.a.x, l.b.z - l.a.z);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len + 1.2, l.door ? 1.6 : 1.2), laneMat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.atan2(l.b.z - l.a.z, l.b.x - l.a.x);
    const [X, Z] = W((l.a.x + l.b.x) / 2, (l.a.z + l.b.z) / 2);
    m.position.set(X, 0.05, Z);
    m.userData.noShadow = true;
    routes.add(m);
  }
  // pick-up and drop points: every WIP shelf and every machine load port of the route
  const pts = [...Object.values(RACKS), DOCK_IN, ...STEPS.flatMap(s => s.tags.map(t => plant.equipList.find(e => e.area === s.area && e.tag === t)!.access!))];
  const pad = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.03, 0.9), new THREE.MeshBasicMaterial({ color: 0x0e7490 }), pts.length);
  const m4 = new THREE.Matrix4();
  pts.forEach((p, i) => { const [X, Z] = W(p.x, p.z); m4.makeTranslation(X, 0.06, Z); pad.setMatrixAt(i, m4); });
  routes.add(pad);
}
// charging docks
const dockMat = std(0x2b3036, 0.3, 0.45), dockLed = new THREE.MeshBasicMaterial({ color: 0x22c55e, toneMapped: false });
const docks = PARKING.map(p => {
  const g = new THREE.Group();
  const [X, Z] = W(p.x, p.z);
  g.position.set(X, 0, Z + 1.2);
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.25), dockMat), 0, 0.3, 0.45));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.02), dockLed), 0, 0.5, 0.32));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.02, 1.2), new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.35, depthWrite: false })), 0, 0.025, 0));
  stage.scene.add(g);
  return g;
});

// ---------- engine ----------
const PKEY = 'adata06.params.v1';
let params: Params = cloneParams(DEFAULT_PARAMS);
let scenario: ScenarioId = page.query.get('cenario') === 'atual' ? 'atual' : 'amr';
let engine: Engine;
const warmed = (p: Params, s: ScenarioId) => {
  const e = createEngine({ params: p, scenario: s });
  e.advanceTo(WARMUP_DAYS * 1440);
  e.resetStats();
  e.advanceTo(2 * WARMUP_DAYS * 1440);
  return e;
};
function restart() {
  engine = warmed(params, scenario);
  docks.forEach((d, i) => (d.visible = scenario === 'amr' && i < params.amrs));
  buildFleetRows();
  compare();
}

// ---------- labels ----------
const LABELS: LabelDef[] = [
  ...PARKING.slice(0, 3).map(p => { const [X, Z] = W(p.x, p.z + 1.2); return { lines: ['Recarga'], x: X, y: 1.8, z: Z }; }),
  { lines: ['Pass box · ISO 6'], x: W(63.3, 75)[0], y: 4.2, z: W(63.3, 75)[1] },
  { lines: ['Pass box · ISO 6 → ISO 7'], x: W(80, 61.5)[0], y: 4.2, z: W(80, 61.5)[1] },
  { lines: ['Saída ISO 7 → testes'], x: W(110, 50)[0], y: 4.2, z: W(110, 50)[1] },
  { lines: ['Recebimento (lotes)'], x: W(DOCK_IN.x, DOCK_IN.z)[0], y: 3, z: W(DOCK_IN.x, DOCK_IN.z)[1] },
  { lines: ['Expedição'], x: W(11.2, 83.2)[0], y: 3.4, z: W(11.2, 83.2)[1] },
];

// ---------- panel ----------
const fleetBody = $<HTMLTableSectionElement>('fleet-rows');
let fleetRows: HTMLTableRowElement[] = [];
function buildFleetRows() {
  fleetBody.textContent = '';
  $('fleet-title').textContent = scenario === 'amr' ? `Frota: ${engine.carriers.length} AMRs` : `Frota: ${engine.carriers.length} operadores (${pct(engine.fleet.share)} do tempo)`;
  fleetRows = engine.carriers.map((_, i) => {
    const tr = fleetBody.insertRow();
    const td = tr.insertCell();
    td.innerHTML = '<i class="pill"></i> <span></span><small></small>';
    td.querySelector('span')!.textContent = scenario === 'amr' ? `AMR ${i + 1}` : `Operador ${i + 1}`;
    tr.insertCell(); tr.insertCell();
    return tr;
  });
}
const STATE_TEXT: Record<string, [string, string]> = {
  idle: ['wait', 'livre'], toPickup: ['run', 'indo buscar'], load: ['run', 'carregando'], toDrop: ['run', 'levando lote'],
  unload: ['run', 'descarregando'], record: ['alarm', 'registrando no papel'], other: ['off', 'operando máquina'],
};
function panel() {
  const m = engine.metrics(), T = Math.max(1, engine.now - engine.statsStart);
  $('k-clock').textContent = clock(engine.now);
  $('k-scen').textContent = `${scenario === 'amr' ? `${engine.carriers.length} AMRs a ${num(engine.fleet.speed, 1)} m/s` : `${engine.carriers.length} operadores com carrinho`} · média desde o dia ${Math.floor(engine.statsStart / 1440) + 1}`;
  $('k-moves').textContent = num(m.movesPerDay, 0);
  $('k-wait').textContent = minutes(m.transportWaitMin);
  $('k-occ').textContent = pct(m.fleetUtil);
  $('k-km').textContent = num(m.kmPerDay, 1);
  $('k-lots').textContent = num(m.lotsPerDay, 1);
  $('k-lead').textContent = m.lotsOut ? hours(m.leadTimeH) : '—';
  $('k-wip').textContent = num(m.wipAvg, 0);
  $('k-pend').textContent = String(engine.pending);
  engine.carriers.forEach((c, i) => {
    const tr = fleetRows[i];
    if (!tr) return;
    const [s, txt] = STATE_TEXT[c.state];
    (tr.querySelector('.pill') as HTMLElement).dataset.s = s;
    tr.querySelector('small')!.textContent = ` ${txt}`;
    tr.cells[1].textContent = String(c.moves);
    tr.cells[2].textContent = pct(c.busyInt / T);
  });
}

/** Manual × AMR with the current parameters. */
function compare() {
  const a = runScenario(params, 'atual'), b = runScenario(params, 'amr');
  const t = $<HTMLTableElement>('cmp');
  t.textContent = '';
  const head = t.createTHead().insertRow();
  ['', 'Manual', 'AMR'].forEach(h => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = h; head.appendChild(th); });
  const body = t.createTBody();
  const rows: [string, (m: Metrics) => number, (v: number) => string, 'hi' | 'lo' | null][] = [
    ['Espera por coleta', m => m.transportWaitMin, minutes, 'lo'],
    ['Lead time', m => m.leadTimeH, hours, 'lo'],
    ['WIP médio (lotes)', m => m.wipAvg, v => num(v, 0), 'lo'],
    ['Lotes por dia', m => m.lotsPerDay, v => num(v, 1), 'hi'],
    ['Ocupação da frota', m => m.fleetUtil, pct, null],
    ['Quilômetros por dia', m => m.kmPerDay, v => num(v, 1), null],
  ];
  for (const [label, get, fmt, better] of rows) {
    const tr = body.insertRow();
    tr.insertCell().textContent = label;
    const va = get(a), vb = get(b);
    [va, vb].forEach(v => {
      const td = tr.insertCell();
      td.textContent = fmt(v);
      if (better && va !== vb && v === (better === 'hi' ? Math.max(va, vb) : Math.min(va, vb))) td.className = 'best';
    });
  }
  const tr = body.insertRow();
  tr.insertCell().textContent = 'Frota';
  tr.insertCell().textContent = `${params.operators} pessoas (${pct(params.share)})`;
  tr.insertCell().textContent = `${params.amrs} AMRs`;
}

// ---------- fleet sizing ----------
const dOut = $('d-out');
$('d-run').onclick = () => {
  dOut.textContent = 'Calculando 12 simulações de 21 dias…';
  setTimeout(() => {
    dOut.textContent = '';
    for (const factor of [1, 1.33]) {
      const p = cloneParams(params);
      p.release = Math.round(params.release * factor * 2) / 2;
      const res = [1, 2, 3, 4, 5, 6].map(n => { const q = cloneParams(p); q.amrs = n; return { n, m: runScenario(q, 'amr') }; });
      const ok = (m: Metrics) => m.lotsPerDay >= p.release * 0.97 && m.transportWaitMin < 5 && m.fleetUtil < 0.7;
      const rec = res.find(r => ok(r.m));
      const t = document.createElement('table');
      t.className = 'cmp';
      t.createCaption().textContent = `${num(p.release, 1)} lotes/dia${factor > 1 ? ' (+33%)' : ''}`;
      const h = t.createTHead().insertRow();
      ['AMRs', 'Lotes/dia', 'Espera', 'Ocupação', 'Lead time'].forEach(x => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = x; h.appendChild(th); });
      const body = t.createTBody();
      for (const r of res) {
        const tr = body.insertRow();
        [String(r.n), num(r.m.lotsPerDay, 1), minutes(r.m.transportWaitMin), pct(r.m.fleetUtil), hours(r.m.leadTimeH)].forEach((v, i) => {
          const td = tr.insertCell();
          td.textContent = v;
          if (r === rec) td.className = 'best';
          if (i === 0 && r === rec) { const s = document.createElement('small'); s.textContent = 'recomendado'; td.appendChild(s); }
        });
      }
      dOut.appendChild(t);
    }
    const n = document.createElement('p');
    n.className = 'note';
    n.textContent = 'Recarga dos AMRs e falhas da frota ainda não estão no modelo. A folga de ocupação abaixo de 70% cobre esses tempos.';
    dOut.appendChild(n);
  }, 30);
};

// ---------- parameters ----------
const f = (id: string) => $<HTMLInputElement>(id);
const val = (id: string, def: number, lo: number, hi: number) => { const v = Number(f(id).value); return f(id).value !== '' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; };
function writeForm(p: Params) {
  f('p-release').value = String(p.release); f('p-amrs').value = String(p.amrs);
  f('p-speed').value = String(p.amrSpeed ?? 1); f('p-handling').value = String(Math.round((p.amrHandling ?? 0.5) * 60));
  f('p-ops').value = String(p.operators); f('p-share').value = String(Math.round(p.share * 100)); f('p-record').value = String(p.record);
}
function readForm(): Params {
  const d = DEFAULT_PARAMS, p = cloneParams(params);
  p.release = val('p-release', d.release, 1, 40); p.amrs = Math.round(val('p-amrs', d.amrs, 1, 20));
  p.amrSpeed = val('p-speed', 1, 0.3, 2); p.amrHandling = val('p-handling', 30, 5, 300) / 60;
  p.operators = Math.round(val('p-ops', d.operators, 1, 40)); p.share = val('p-share', d.share * 100, 10, 100) / 100; p.record = val('p-record', d.record, 0, 30);
  return p;
}
if (!benchDays) {
  try { const s = JSON.parse(localStorage.getItem(PKEY) || 'null'); if (s && typeof s === 'object') params = { ...params, ...s, mix: { ...params.mix }, minutes: { ...params.minutes } }; } catch { /* defaults */ }
}
writeForm(params);
function apply(p: Params, msg: string) {
  const before = engine.metrics();
  params = p;
  writeForm(p);
  restart();
  const after = engine.metrics();
  $('p-status').textContent = `${msg} ${scenario === 'amr' ? 'AMR' : 'Manual'}: espera ${minutes(before.transportWaitMin)} → ${minutes(after.transportWaitMin)}, ocupação ${pct(before.fleetUtil)} → ${pct(after.fleetUtil)}, lead time ${hours(before.leadTimeH)} → ${hours(after.leadTimeH)}.`;
  dOut.textContent = '';
}
$<HTMLFormElement>('params').addEventListener('submit', e => {
  e.preventDefault();
  const p = readForm();
  try { localStorage.setItem(PKEY, JSON.stringify({ release: p.release, amrs: p.amrs, amrSpeed: p.amrSpeed, amrHandling: p.amrHandling, operators: p.operators, share: p.share, record: p.record })); } catch { /* not saved */ }
  apply(p, 'Aplicado.');
});
$('p-reset').onclick = () => { try { localStorage.removeItem(PKEY); } catch { /* ignore */ } apply(cloneParams(DEFAULT_PARAMS), 'Valores padrão.'); };
const scenSel = $<HTMLSelectElement>('scenario');
scenSel.value = scenario;
scenSel.addEventListener('change', () => { scenario = scenSel.value as ScenarioId; restart(); });
const routesBtn = $('b-routes');
routesBtn.onclick = () => { routes.visible = !routes.visible; routesBtn.setAttribute('aria-pressed', String(routes.visible)); };

// ---------- start ----------
restart();
let following = false;
const followBtn = $('v-seguir');
const camGoal = new THREE.Vector3(), tgtGoal = new THREE.Vector3();
const views = page.start({
  first: 'geral',
  views: {
    geral: { pos: [30, 60, 70], target: [2, 0, 6] },
    limpa: { pos: [-2, 30, 50], target: [-12, 0, 16] },
    testes: { pos: [-10, 24, 18], target: [-22, 0, -10] },
    cima: { pos: [0, 128, 2], target: [0, 0, 0.5] },
  },
  tour: { positions: [[-55, 40, 70], [10, 30, 62], [62, 34, 30], [30, 30, -10], [-40, 30, -5]], targets: [[-20, 0, 25], [10, 0, 15], [30, 0, 0], [0, 0, -10], [-20, 0, 0]], seconds: 60 },
  labels: LABELS,
  speeds: [30, 120, 600, 3600, 10],
  speedLabel: s => (s >= 3600 ? '1 h/s' : s >= 600 ? `${s / 60} min/s` : `${s}×`),
  maxStep: 120,
  step: dt => engine.advanceTo(engine.now + dt / 60),
  frame: () => {
    actors.update(engine, engine.now);
    for (const m of engine.machines) {
      const c = m.down ? STATUS_COLOR.down : m.lots.length ? STATUS_COLOR.run : STATUS_COLOR.idle;
      plant.setStatus(m.eq, c);
      if (m.linked) plant.setStatus(m.linked, c);
    }
    if (following && engine.carriers.length) {
      const p = engine.carrierPos(engine.carriers[0], engine.now), [X, Z] = W(p.x, p.z);
      const h = Math.atan2(p.dx || 0, p.dz || 1);
      tgtGoal.set(X, 0.6, Z);
      camGoal.set(X - Math.sin(h) * 7, 8, Z - Math.cos(h) * 7);
      stage.camera.position.lerp(camGoal, 0.06);
      stage.controls.target.lerp(tgtGoal, 0.12);
    }
  },
  panel,
  shotName: (w, h) => `adata-06-movimentacao-${w}x${h}.png`,
  onView: n => { if (n !== 'seguir') { following = false; followBtn.setAttribute('aria-pressed', 'false'); } },
});
followBtn.onclick = () => {
  views.views.go('geral', true);
  following = true;
  ['geral', 'limpa', 'testes', 'cima', 'tour'].forEach(v => document.getElementById('v-' + v)?.setAttribute('aria-pressed', 'false'));
  followBtn.setAttribute('aria-pressed', 'true');
  if (engine.carriers.length) { const p = engine.carrierPos(engine.carriers[0], engine.now), [X, Z] = W(p.x, p.z); stage.camera.position.set(X - 6, 8, Z - 6); stage.controls.target.set(X, 0.6, Z); }
};
stage.controls.addEventListener('start', () => { if (following) { following = false; followBtn.setAttribute('aria-pressed', 'false'); } });

declare global { interface Window { __a06: unknown; __a06Bench?: { lotsOut: number; leadTimeH: number; bottleneck: string; movesPerDay: number; ms: number } } }
window.__a06 = { get engine() { return engine; }, stage, graph: plantGraph() };
if (benchDays) {
  const t0 = performance.now(), m = runScenario(DEFAULT_PARAMS, 'amr', benchDays);
  window.__a06Bench = { lotsOut: m.lotsOut, leadTimeH: Math.round(m.leadTimeH * 10) / 10, bottleneck: m.bottleneck, movesPerDay: Math.round(m.movesPerDay), ms: Math.round(performance.now() - t0) };
}

/** Cover camera for the portal card (tests/e2e/capa.spec.ts): the ISO 6 corridor with the routes. */
(window as unknown as { __capa: () => void }).__capa = () => { stage.camera.position.set(-2, 20, 40); stage.controls.target.set(-18, 0, 15); stage.controls.update(); };

// the projects menu and the way back, on the page inside the plant (projetos/memory-flow-3d/...)
import { mountProjectsMenu } from '../memory-flow/projects-menu';
mountProjectsMenu();
