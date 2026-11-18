// Memory Flow 3D: digital twin of the Adata Technology memory plant (Santo Antônio de Posse, SP). The whole plant
// in 3D at real scale, lots flowing through the 35 operations of the route, and the material handling scenarios
// (manual today, AMRs, AMRs + AI post-dicing inspection) compared on output, lead time and WIP.
//
// URL options (for tests and demos):
//   ?cenario=amr       start with that scenario (atual | amr | amr-ia)
//   ?bench=14          run that many simulated days after the warm-up with the default parameters and publish
//                      the result in window.__mfBench (ignores saved parameters)
import * as THREE from 'three';
import { createLabels, type Labels } from '../../sim/labels';
import { useHDRI } from '../../sim/robots/ur-arm';
import { createStage } from '../../sim/stage';
import { $ } from '../../sim/ui/dom';
import { createShotModal } from '../../sim/ui/shot-modal';
import { createViews } from '../../sim/views';
import { createActors } from './actors';
import { DEFAULT_SPEED, FONT, SHADOW_FRUSTUM, SPEEDS, STATUS_COLOR, TAG_DISTANCE, TOUR, VIEWS } from './config';
import { LAB_EQUIPMENT, WARMUP_DAYS, createEngine, runScenario, type Engine } from './engine';
import { ZONES, type Zone } from './layout';
import { buildPlant } from './plant3d';
import { PLANT_PROJECTS, createProjectsLayer } from './projects-layer';
import { DEFAULT_PARAMS, FAMILIES, FAMILY_INFO, SCENARIOS, type Params, type ScenarioId } from './process';
import { createComparePanel } from './ui/compare-panel';
import { createInfoCard } from './ui/info-card';
import { createKpiPanel } from './ui/kpi-panel';
import { createParamsPanel } from './ui/params-panel';

const query = new URLSearchParams(location.search);
const benchDays = Math.max(0, Number(query.get('bench')) || 0);
const qScen = query.get('cenario') as ScenarioId;
let scenario: ScenarioId = SCENARIOS.some(s => s.id === qScen) ? qScen : 'atual';

declare global {
  interface Window {
    __mf: unknown;
    __mfBench?: { scenario: ScenarioId; days: number; lotsOut: number; leadTimeH: number; wipAvg: number; transportWaitMin: number; bottleneck: string; ms: number };
  }
}

// ---------- benchmark: pure engine, published before the 3D is built ----------
if (benchDays) {
  const t0 = performance.now();
  const m = runScenario(DEFAULT_PARAMS, scenario, benchDays);
  window.__mfBench = {
    scenario, days: benchDays, lotsOut: m.lotsOut, leadTimeH: Math.round(m.leadTimeH * 10) / 10, wipAvg: Math.round(m.wipAvg * 10) / 10,
    transportWaitMin: Math.round(m.transportWaitMin * 10) / 10, bottleneck: m.bottleneck, ms: Math.round(performance.now() - t0),
  };
}

// ---------- scene ----------
const stageEl = $('stage');
const stage = createStage(stageEl, {
  shadowFrustum: SHADOW_FRUSTUM, fog: { near: 320, far: 700 }, floor: { w: 260, d: 220 }, cameraFar: 800, maxDistance: 230,
});
stage.controls.minDistance = 3;
stage.renderer.toneMappingExposure = 0.9;
const plant = buildPlant(stage.scene);
const actors = createActors(stage.scene, plant);

// labels: one set per zone colour for the areas, one for the equipment tags (shown only up close)
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const areaLabelSets = (Object.keys(plant.areaLabels) as Zone[]).map(z => ({ z, l: createLabels(stage.scene, FONT, { scale: 6, color: hex(ZONES[z].strong) }) }));
const tagLabels = createLabels(stage.scene, FONT, { scale: 0.8 });
const allLabels: Labels[] = [...areaLabelSets.map(s => s.l), tagLabels];
const buildLabels = () => {
  areaLabelSets.forEach(({ z, l }) => l.build(plant.areaLabels[z]!));
  tagLabels.build(plant.tagLabels);
  tagLabels.sprites.forEach(s => (s.userData.culled = true));
  tagLabels.restore();
};
buildLabels();
const projects = createProjectsLayer(stage.scene, FONT);
document.fonts?.load(`600 44px "Barlow Semi Condensed"`).then(() => { buildLabels(); projects.rebuild(); }).catch(() => {});
const labelsProxy = {
  get visible() { return allLabels[0].visible; },
  setVisible(v: boolean) { allLabels.forEach(l => l.setVisible(v)); },
  showTemporarily(v: boolean) { allLabels.forEach(l => l.showTemporarily(v)); projects.sprites().forEach(s => (s.visible = v && projects.visible)); },
  restore() { allLabels.forEach(l => l.restore()); projects.restore(); },
};
stage.hiddenInReflection.objects = () => [...allLabels.flatMap(l => l.sprites), ...projects.sprites()];
stage.hiddenInReflection.restore = () => labelsProxy.restore();
stage.finalizeShadows();

// legend over the 3D
{
  const lg = $('legend');
  const row = (title: string, items: [number, string][]) => {
    const r = document.createElement('div');
    r.className = 'row';
    const t = document.createElement('span');
    t.textContent = title;
    r.appendChild(t);
    for (const [c, n] of items) { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = hex(c); s.append(i, n); r.appendChild(s); }
    lg.appendChild(r);
  };
  row('Lotes', FAMILIES.map(f => [FAMILY_INFO[f].color, FAMILY_INFO[f].name]));
  row('Máquinas', [[STATUS_COLOR.run, 'produzindo'], [STATUS_COLOR.idle, 'aguardando lote'], [STATUS_COLOR.down, 'parada'], [STATUS_COLOR.lab, 'laboratório']]);
  row('Áreas', (['iso6', 'iso7', 'proc', 'insp', 'log', 'fac'] as Zone[]).map(z => [ZONES[z].strong, ZONES[z].name.split(' / ')[0]]));
  row('Projetos', PLANT_PROJECTS.map(p => [parseInt(p.color.slice(1), 16), p.num]));
}

// ---------- engine ----------
let params: Params = DEFAULT_PARAMS;
let engine: Engine;
/** Warm-up (the plant starts empty), then a week measured, so the panel opens with real numbers. */
function warmed(p: Params) {
  const e = createEngine({ params: p, scenario });
  e.advanceTo(WARMUP_DAYS * 1440);
  e.resetStats();
  e.advanceTo(2 * WARMUP_DAYS * 1440);
  return e;
}
function restart() {
  engine = warmed(params);
  info.update(engine);
  kpi.update(engine);
}

/** What changed when parameters were applied, on the scenario on screen (same measured week before and after). */
function applyReport(old: Params, p: Params): string {
  const a = warmed(old).metrics(), b = engine.metrics();
  const f = (v: number, d = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const short = SCENARIOS.find(s => s.id === scenario)!.short;
  const parts = [
    `lotes/dia ${f(a.lotsPerDay)} → ${f(b.lotsPerDay)}`,
    `lead time ${f(a.leadTimeH)} → ${f(b.leadTimeH)} h`,
    `espera por coleta ${f(a.transportWaitMin)} → ${f(b.transportWaitMin)} min`,
    `ocupação da frota ${Math.round(a.fleetUtil * 100)}% → ${Math.round(b.fleetUtil * 100)}%`,
  ];
  let msg = `Aplicado no cenário ${short}: ${parts.join(' · ')}.`;
  const manualChanged = old.operators !== p.operators || old.share !== p.share || old.record !== p.record;
  const amrChanged = old.amrs !== p.amrs, iaChanged = old.insAi !== p.insAi;
  if (manualChanged && scenario !== 'atual') msg += ' Operadores, dedicação e registro só valem no cenário Atual: troque o cenário no topo para ver o efeito.';
  if (amrChanged && scenario === 'atual') msg += ' A quantidade de AMRs só vale nos cenários AMR e AMR + IA: troque o cenário no topo para ver o efeito.';
  if (iaChanged && scenario !== 'amr-ia') msg += ' O tempo da inspeção com IA só vale no cenário AMR + IA.';
  return msg;
}

const kpi = createKpiPanel();
const info = createInfoCard(() => { selBox.visible = false; });
const paramsPanel = createParamsPanel(p => {
  const old = params;
  params = p;
  compare.invalidate();
  restart();
  return applyReport(old, p);
});
const compare = createComparePanel(() => params);
if (!benchDays) params = paramsPanel.load();

const scenSel = $<HTMLSelectElement>('scenario');
scenSel.value = scenario;
scenSel.addEventListener('change', () => { scenario = scenSel.value as ScenarioId; restart(); });

const tabs = [['tab-kpi', 'pane-kpi'], ['tab-cmp', 'pane-cmp'], ['tab-par', 'pane-par']].map(([t, p]) => [$(t), $(p)] as const);
const selectTab = (idx: number) => {
  tabs.forEach(([t, p], i) => { t.setAttribute('aria-selected', String(i === idx)); p.hidden = i !== idx; });
  if (idx === 1 && !compare.ran) compare.run();
};
tabs.forEach(([t], i) => { t.onclick = () => selectTab(i); });

// ---------- views & tour ----------
const dockViews = ['planta', 'limpa', 'testes', 'utilidades', 'logistica', 'cima', 'tour'];
const views = createViews(stage.camera, stage.controls, {
  views: VIEWS, tour: TOUR,
  onChange: name => dockViews.forEach(n => $('v-' + n).setAttribute('aria-pressed', String(n === name))),
});
dockViews.filter(n => n !== 'tour').forEach(n => ($('v-' + n).onclick = () => views.go(n)));
$('v-tour').onclick = () => (views.touring ? views.go('planta') : views.startTour());

// ---------- controls ----------
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let playing = !reduced && !benchDays, speed = DEFAULT_SPEED;
const playBtn = $('b-play');
const setPlay = (p: boolean) => { playing = p; playBtn.textContent = p ? 'Pausar' : 'Animar'; playBtn.setAttribute('aria-pressed', String(!p)); };
setPlay(playing);
playBtn.onclick = () => setPlay(!playing);
const speedBtn = $('b-speed');
speedBtn.onclick = () => {
  speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
  speedBtn.textContent = speed >= 3600 ? '1 h/s' : speed >= 600 ? `${speed / 60} min/s` : `${speed}×`;
  speedBtn.setAttribute('aria-pressed', String(speed !== DEFAULT_SPEED));
};
let heat = false;
const heatBtn = $('b-heat');
heatBtn.onclick = () => { heat = !heat; heatBtn.setAttribute('aria-pressed', String(heat)); heatBtn.textContent = heat ? 'Estado' : 'Utilização'; };
const labelBtn = $('b-labels');
labelBtn.onclick = () => { labelsProxy.setVisible(!labelsProxy.visible); labelBtn.setAttribute('aria-pressed', String(labelsProxy.visible)); };
const kpiBtn = $('b-kpi'), kpiEl = $('kpi');
const setKpi = (o: boolean) => { kpiEl.classList.toggle('open', o); kpiBtn.setAttribute('aria-pressed', String(o)); };
kpiBtn.onclick = () => setKpi(!kpiEl.classList.contains('open'));
if (window.matchMedia?.('(max-width: 900px)').matches) setKpi(false);
const qBtn = $('b-quality');
const applyQuality = () => {
  stage.applyQuality();
  qBtn.textContent = stage.state.high ? 'Qualidade alta' : 'Qualidade leve';
  qBtn.setAttribute('aria-pressed', String(stage.state.high));
};
qBtn.onclick = () => { stage.state.high = !stage.state.high; applyQuality(); };
createShotModal(stage, labelsProxy as unknown as Labels, () => {}, (W, H) => `memory-flow-${scenario}-${W}x${H}.png`);

// ---------- picking: click a machine for its card ----------
const selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xf2c230, depthTest: false }));
selBox.renderOrder = 9;
selBox.visible = false;
stage.scene.add(selBox);
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
let down: { x: number; y: number } | null = null;
const canvas = stage.renderer.domElement;
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
  const r = canvas.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, stage.camera);
  const proj = projects.pick(ray);
  if (proj) { location.href = proj.url; return; }
  const hit = ray.intersectObject(plant.pick)[0];
  if (hit?.instanceId == null) { info.close(); return; }
  const eq = plant.equipList[hit.instanceId];
  info.open(eq, engine);
  const [X, Z] = [eq.x - 60, eq.z - 45];
  selBox.position.set(X, eq.h / 2 + 0.05, Z);
  selBox.scale.set(eq.w + 0.25, eq.h + 0.2, eq.d + 0.25);
  selBox.visible = true;
});

// ---------- machine colours: state now, or average use (heat map) ----------
const cold = new THREE.Color(0x3b82f6), warm = new THREE.Color(0xf59e0b), hot = new THREE.Color(0xef4444), tmpC = new THREE.Color();
function heatColor(u: number) {
  if (u < 0.5) return tmpC.copy(cold).lerp(warm, u / 0.5).getHex();
  return tmpC.copy(warm).lerp(hot, Math.min(1, (u - 0.5) / 0.4)).getHex();
}
function paintMachines(blink: boolean) {
  const T = Math.max(1, engine.now - engine.statsStart);
  for (const m of engine.machines) {
    const c = heat ? heatColor(m.busyInt / (m.slots * T))
      : m.down ? (blink ? STATUS_COLOR.down : 0x7f1d1d) : m.lots.length ? STATUS_COLOR.run : STATUS_COLOR.idle;
    plant.setStatus(m.eq, c);
    if (m.linked) plant.setStatus(m.linked, c);
  }
  for (const e of LAB_EQUIPMENT) plant.setStatus(e, heat ? 0x5b6470 : STATUS_COLOR.lab);
}

// ---------- start ----------
let fitted = false;
new ResizeObserver(() => { stage.resize(); if (!fitted) { views.go('planta', true); fitted = true; } }).observe(stageEl);
applyQuality();
views.go('planta', true);
restart();

window.__mf = { get engine() { return engine; }, restart, stage, views, actors };

if (!benchDays) {
  useHDRI(stage.renderer, stage.scene, `${import.meta.env.BASE_URL}assets/env/empty_warehouse_01_1k.hdr`).catch(err => console.warn('HDRI not loaded; keeping the modelled hall lighting', err));
}

// ---------- loop ----------
const clockReal = new THREE.Clock();
let kpiT = 0, cullT = 0;
const camPos = new THREE.Vector3();
function frame() {
  const raw = Math.min(clockReal.getDelta(), 0.05);
  if (playing) engine.advanceTo(engine.now + (raw * speed) / 60);
  actors.update(engine, engine.now);
  paintMachines(Math.floor(performance.now() / 450) % 2 === 0);
  if ((kpiT += raw) > 0.3) { kpiT = 0; kpi.update(engine); info.update(engine); }
  views.update(raw);
  stage.controls.update();
  if ((cullT += raw) > 0.2) {
    cullT = 0;
    camPos.copy(stage.camera.position);
    // tags only up close, area names only from further away (they are several metres wide)
    for (const s of tagLabels.sprites) s.userData.culled = s.position.distanceTo(camPos) > TAG_DISTANCE;
    for (const { l } of areaLabelSets) for (const s of l.sprites) s.userData.culled = s.position.distanceTo(camPos) < 32;
    labelsProxy.restore();
  }
  stage.renderer.render(stage.scene, stage.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- "Projetos" layer: button, hand cursor over the pins ----------
const projBtn = document.getElementById('b-proj');
if (projBtn) projBtn.onclick = () => { projects.setVisible(!projects.visible); projBtn.setAttribute('aria-pressed', String(projects.visible)); };
canvas.addEventListener('pointermove', e => {
  const r = canvas.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, stage.camera);
  const p = projects.pick(ray);
  canvas.style.cursor = p ? 'pointer' : '';
  canvas.title = p ? `${p.num} · ${p.name}: ${p.note} Clique para abrir.` : '';
});
(window as unknown as { __mfProjects: unknown }).__mfProjects = projects;

// ---------- "Projetos Adata" menu in the dock: a shortcut to every project's page ----------
{
  const ul = document.getElementById('proj-links'), menu = document.getElementById('m-proj') as HTMLDetailsElement | null;
  if (ul && menu) {
    for (const p of PLANT_PROJECTS) {
      const a = document.createElement('a'), b = document.createElement('b'), s = document.createElement('span'), sm = document.createElement('small');
      a.href = p.url;
      b.textContent = p.num;
      b.style.background = p.color;
      s.textContent = p.name;
      sm.textContent = p.note;
      a.append(b, s, sm);
      const li = document.createElement('li');
      li.appendChild(a);
      ul.appendChild(li);
    }
    // close when clicking elsewhere or pressing Escape
    document.addEventListener('click', e => { if (menu.open && !menu.contains(e.target as Node)) menu.open = false; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') menu.open = false; });
  }
}
