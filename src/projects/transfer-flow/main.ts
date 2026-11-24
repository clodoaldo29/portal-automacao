// Transfer Flow 3D: robotic transfer and AI inspection of TVs (32"–75").
//
// URL options (for tests and demos):
//   ?model=65      start with that model
//   ?bench=10      after the warm-up, run that many simulated minutes at once and publish the result in
//                  window.__bench (ignores saved parameters, skips the real meshes and HDRI)
import * as THREE from 'three';
import { createLabels } from '../../sim/labels';
import { useHDRI, useUR10eMeshes } from '../../sim/robots/ur-arm';
import { createStage } from '../../sim/stage';
import { createViews } from '../../sim/views';
import { FONT, INCHES, LABELS, SHADOW_FRUSTUM, TOUR, VIEWS, type Inch } from './config';
import { drawInsp } from './inspection';
import { $ } from '../../sim/ui/dom';
import { createKpiPanel } from './ui/kpi-panel';
import { createParamsPanel } from './ui/params-panel';
import { createShotModal } from '../../sim/ui/shot-modal';
import { DEFAULT_PARAMS, applyArms, createWorld, mountArms, resetLine, resetStats, startClearance, step } from './world';
import { programReport } from './transfers';
import { measureClearance } from './clearance';
import { jointPoints } from '../../sim/robots/collision';

const query = new URLSearchParams(location.search);
const benchMinutes = Math.max(0, Number(query.get('bench')) || 0);
const qModel = Number(query.get('model')) as Inch;
const initialInch: Inch = INCHES.includes(qModel) ? qModel : DEFAULT_PARAMS.inch;

const stageEl = $('stage');
const stage = createStage(stageEl, { shadowFrustum: SHADOW_FRUSTUM });
const { world: w, andons, ceiling } = createWorld(stage, { ...DEFAULT_PARAMS, inch: initialInch });

// ---------- labels ----------
const labels = createLabels(stage.scene, FONT);
labels.build(LABELS);
document.fonts?.load(`600 44px "Barlow Semi Condensed"`).then(() => { labels.build(LABELS); drawInsp(w, 'idle', null, 0); }).catch(() => {});
stage.hiddenInReflection.objects = () => labels.sprites;
stage.hiddenInReflection.restore = () => labels.restore();
stage.finalizeShadows();

// ---------- panel ----------
const kpi = createKpiPanel(w);
const params = createParamsPanel(w, () => kpi.update());

const modelSel = $<HTMLSelectElement>('model');
modelSel.value = String(w.params.inch);
// changing the model restarts the line, so every indicator starts from zero for the new model
modelSel.addEventListener('change', () => { w.params.inch = Number(modelSel.value) as Inch; resetLine(w); kpi.update(); });
const ngBtn = $('b-ng');
ngBtn.onclick = () => { w.params.simulateNG = !w.params.simulateNG; ngBtn.setAttribute('aria-pressed', String(w.params.simulateNG)); };

const tabs = [['tab-kpi', 'pane-kpi'], ['tab-par', 'pane-par']].map(([t, p]) => [$(t), $(p)] as const);
const selectTab = (idx: number) => tabs.forEach(([t, p], i) => { t.setAttribute('aria-selected', String(i === idx)); p.hidden = i !== idx; });
tabs.forEach(([t], i) => { t.onclick = () => selectTab(i); });

// ---------- views & tour ----------
const dockBtns = ['persp', 'robots', 'insp', 'test', 'top', 'tour'];
const views = createViews(stage.camera, stage.controls, {
  views: VIEWS, tour: TOUR,
  onChange: name => dockBtns.forEach(n => $('v-' + n).setAttribute('aria-pressed', String(n === name))),
});
dockBtns.filter(n => n !== 'tour').forEach(n => ($('v-' + n).onclick = () => views.go(n)));
$('v-tour').onclick = () => (views.touring ? views.go('persp') : views.startTour());

// ---------- controls ----------
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let playing = !reduced, speed = 1;
const playBtn = $('b-play');
const setPlay = (p: boolean) => { playing = p; playBtn.textContent = p ? 'Pausar' : 'Animar'; playBtn.setAttribute('aria-pressed', String(!p)); };
setPlay(playing);
playBtn.onclick = () => setPlay(!playing);
const speedBtn = $('b-speed');
speedBtn.onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; speedBtn.textContent = speed + '×'; speedBtn.setAttribute('aria-pressed', String(speed > 1)); };
const labelBtn = $('b-labels');
labelBtn.onclick = () => { labels.setVisible(!labels.visible); labelBtn.setAttribute('aria-pressed', String(labels.visible)); };
const kpiBtn = $('b-kpi'), kpiEl = $('kpi');
const setKpi = (o: boolean) => { kpiEl.classList.toggle('open', o); kpiBtn.setAttribute('aria-pressed', String(o)); };
kpiBtn.onclick = () => setKpi(!kpiEl.classList.contains('open'));
if (window.matchMedia?.('(max-width: 900px)').matches) setKpi(false); // phones: give the 3D the room
const qBtn = $('b-quality');
const applyQuality = () => {
  stage.applyQuality();
  qBtn.textContent = stage.state.high ? 'Qualidade alta' : 'Qualidade leve';
  qBtn.setAttribute('aria-pressed', String(stage.state.high));
};
qBtn.onclick = () => { stage.state.high = !stage.state.high; applyQuality(); };

const hideCeilingFromAbove = (camera: THREE.PerspectiveCamera) => { ceiling.visible = camera.position.y < 12.4; };
createShotModal(stage, labels, hideCeilingFromAbove, (W, H) => `transfer-flow-${w.params.inch}pol-${W}x${H}.png`);

let fitted = false;
new ResizeObserver(() => { stage.resize(); if (!fitted) { views.go('persp', true); fitted = true; } }).observe(stageEl);
applyQuality();
views.go('persp', true);

// ---------- start: UR arms, parameters, warm-up so the line opens mid-production ----------
mountArms(w);
if (benchMinutes) applyArms(w); // defaults only: results must not depend on what a browser saved
else params.init();
for (let i = 0; i < 300; i++) step(w, 1 / 30);
resetStats(w);
drawInsp(w, 'idle', null, 0);

declare global {
  interface Window {
    __tf: unknown;
    __bench?: { inch: Inch; minutes: number; moved: number; perRobot: number[]; inspected: number; losses: { tv: number; emptyPallet: number }; minClear: number; minClearAt: string; near: string[]; ms: number };
  }
}
window.__tf = {
  report: () => programReport(w),
  world: w, step: (dt: number) => step(w, dt), resetLine: () => resetLine(w), resetStats: () => resetStats(w),
  /** Collision check now (smallest clearance and between what), and the joint points of a transfer arm. */
  measure: () => measureClearance(w),
  joints: (i: number) => jointPoints(w.robots[i].arm).map(v => v.toArray().map(n => Math.round(n * 1000) / 1000)),
};

if (benchMinutes) {
  const t0 = performance.now();
  startClearance(w); // nothing may touch: the bench measures the smallest clearance over the whole run
  for (let i = 0, n = Math.round(benchMinutes * 60 * 30); i < n; i++) step(w, 1 / 30);
  window.__bench = {
    inch: w.params.inch, minutes: benchMinutes, moved: w.stats.moved, perRobot: w.robots.map(r => r.count),
    inspected: w.stats.inspTV, losses: { ...w.losses }, minClear: Math.round(w.clear!.min * 1000) / 1000, minClearAt: w.clear!.at,
    near: [...w.clear!.worst].sort((a, b) => a[1] - b[1]).slice(0, 12).map(([k, v]) => `${Math.round(v * 1000)} mm · ${k}`), ms: Math.round(performance.now() - t0),
  };
  setPlay(false);
} else {
  // original UR10e meshes and the warehouse HDRI: swapped in when they arrive; the modelled ones stay if they fail
  const base = import.meta.env.BASE_URL;
  useUR10eMeshes([...w.robots.map(r => r.arm), w.insp.arm], `${base}assets/ur10e/`).catch(err => console.warn('UR10e meshes not loaded; keeping the modelled arm', err));
  useHDRI(stage.renderer, stage.scene, `${base}assets/env/empty_warehouse_01_1k.hdr`).catch(err => console.warn('HDRI not loaded; keeping the modelled hall lighting', err));
}

// ---------- loop ----------
const clock = new THREE.Clock();
let kpiT = 0;
function frame() {
  const raw = Math.min(clock.getDelta(), 0.05);
  if (playing) {
    const dt = raw * speed, n = Math.ceil(speed);
    for (let i = 0; i < n; i++) step(w, dt / n);
  }
  andons.update(performance.now() / 1000);
  if ((kpiT += raw) > 0.25) { kpiT = 0; kpi.update(); }
  views.update(raw);
  stage.controls.update();
  hideCeilingFromAbove(stage.camera);
  stage.renderer.render(stage.scene, stage.camera);
  requestAnimationFrame(frame);
}
kpi.update();
requestAnimationFrame(frame);
