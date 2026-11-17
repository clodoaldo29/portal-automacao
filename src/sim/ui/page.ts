// Page frame shared by the simulation pages: stage, labels, camera views and tour, the dock controls (play, speed,
// labels, quality, panel, PNG), panel tabs, the frame loop and the URL benchmark.
//
// Markup it expects (ids): #stage, #kpi, buttons v-<view> for each view and v-tour, b-play, b-speed, b-labels,
// b-quality, b-kpi, b-shot with the PNG modal, and tabs as [role=tab] buttons with aria-controls.
// Missing optional buttons are simply skipped.
import * as THREE from 'three';
import { createLabels, type LabelDef, type Labels } from '../labels';
import { createStage, type StageOptions } from '../stage';
import { createViews, type ViewDef } from '../views';
import { createShotModal } from './shot-modal';

export interface PageSetup {
  stage: StageOptions;
  font: string;
  /** Size of the floating labels (1 = about 1 m wide for a short word). */
  labelScale?: number;
  /** Hide a label when the camera is closer than this (m): big plates would cover close-up views. */
  labelNear?: number;
}

export interface PageRun {
  views: Record<string, ViewDef>;
  first: string;
  tour?: { positions: [number, number, number][]; targets: [number, number, number][]; seconds: number };
  labels?: LabelDef[];
  /** Advance the simulation by dt simulated seconds. */
  step: (dt: number) => void;
  /** Visual updates once per frame (real seconds), after the simulation step. */
  frame?: (dt: number) => void;
  /** Refresh the panel (called 4 times a second). */
  panel: () => void;
  /** Speeds offered by the speed button (simulated seconds per real second) and the label of each. */
  speeds?: number[];
  speedLabel?: (s: number) => string;
  /** Largest simulated step per update (smaller steps keep robots smooth at high speed). */
  maxStep?: number;
  shotName: (w: number, h: number) => string;
  /** Called with the active view name ('' when the user takes over the camera). */
  onView?: (name: string) => void;
}

const $opt = (id: string) => document.getElementById(id);

export function createPage(setup: PageSetup) {
  const stageEl = $opt('stage')!;
  const stage = createStage(stageEl, setup.stage);
  const labels: Labels = createLabels(stage.scene, setup.font, { scale: setup.labelScale ?? 1 });
  stage.hiddenInReflection.objects = () => labels.sprites;
  stage.hiddenInReflection.restore = () => labels.restore();
  const query = new URLSearchParams(location.search);
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function start(run: PageRun) {
    if (run.labels) {
      labels.build(run.labels);
      document.fonts?.load(`600 44px "Barlow Semi Condensed"`).then(() => labels.build(run.labels!)).catch(() => {});
    }
    stage.finalizeShadows();

    // views & tour
    const names = [...Object.keys(run.views), ...(run.tour ? ['tour'] : [])];
    const views = createViews(stage.camera, stage.controls, {
      views: run.views, tour: run.tour,
      onChange: n => { names.forEach(v => $opt('v-' + v)?.setAttribute('aria-pressed', String(v === n))); run.onView?.(n); },
    });
    Object.keys(run.views).forEach(n => { const b = $opt('v-' + n); if (b) b.onclick = () => views.go(n); });
    const tb = $opt('v-tour');
    if (tb) tb.onclick = () => (views.touring ? views.go(run.first) : views.startTour());

    // tabs
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tabs [role=tab]')];
    tabs.forEach(t => t.addEventListener('click', () => tabs.forEach(o => {
      const on = o === t;
      o.setAttribute('aria-selected', String(on));
      const p = $opt(o.getAttribute('aria-controls') || '');
      if (p) p.hidden = !on;
    })));

    // controls
    let playing = !reduced, speedI = 0;
    const speeds = run.speeds ?? [1, 2, 4];
    const speedLabel = run.speedLabel ?? ((s: number) => `${s}×`);
    const playBtn = $opt('b-play');
    const setPlay = (p: boolean) => { playing = p; if (playBtn) { playBtn.textContent = p ? 'Pausar' : 'Animar'; playBtn.setAttribute('aria-pressed', String(!p)); } };
    setPlay(playing);
    if (playBtn) playBtn.onclick = () => setPlay(!playing);
    const speedBtn = $opt('b-speed');
    if (speedBtn) {
      speedBtn.textContent = speedLabel(speeds[0]);
      speedBtn.onclick = () => { speedI = (speedI + 1) % speeds.length; speedBtn.textContent = speedLabel(speeds[speedI]); speedBtn.setAttribute('aria-pressed', String(speedI > 0)); };
    }
    const labelBtn = $opt('b-labels');
    if (labelBtn) labelBtn.onclick = () => { labels.setVisible(!labels.visible); labelBtn.setAttribute('aria-pressed', String(labels.visible)); };
    const kpiBtn = $opt('b-kpi'), kpiEl = $opt('kpi');
    const setKpi = (o: boolean) => { kpiEl?.classList.toggle('open', o); kpiBtn?.setAttribute('aria-pressed', String(o)); };
    if (kpiBtn) kpiBtn.onclick = () => setKpi(!kpiEl?.classList.contains('open'));
    if (window.matchMedia?.('(max-width: 900px)').matches) setKpi(false);
    const qBtn = $opt('b-quality');
    const applyQuality = () => {
      stage.applyQuality();
      if (qBtn) { qBtn.textContent = stage.state.high ? 'Qualidade alta' : 'Qualidade leve'; qBtn.setAttribute('aria-pressed', String(stage.state.high)); }
    };
    if (qBtn) qBtn.onclick = () => { stage.state.high = !stage.state.high; applyQuality(); };
    if ($opt('b-shot')) createShotModal(stage, labels, () => {}, run.shotName);

    let fitted = false;
    new ResizeObserver(() => { stage.resize(); if (!fitted) { views.go(run.first, true); fitted = true; } }).observe(stageEl);
    applyQuality();
    views.go(run.first, true);

    const clock = new THREE.Clock();
    let panelT = 0;
    const maxStep = run.maxStep ?? 1 / 30;
    function frame() {
      const raw = Math.min(clock.getDelta(), 0.05);
      if (playing) {
        const dt = raw * speeds[speedI], n = Math.max(1, Math.ceil(dt / maxStep));
        for (let i = 0; i < n; i++) run.step(dt / n);
      }
      run.frame?.(raw);
      if (setup.labelNear) {
        for (const s of labels.sprites) s.userData.culled = s.position.distanceTo(stage.camera.position) < setup.labelNear;
        labels.restore();
      }
      if ((panelT += raw) > 0.25) { panelT = 0; run.panel(); }
      views.update(raw);
      stage.controls.update();
      stage.renderer.render(stage.scene, stage.camera);
      requestAnimationFrame(frame);
    }
    run.panel();
    requestAnimationFrame(frame);
    return { views, setPlay, get playing() { return playing; }, get speed() { return speeds[speedI]; } };
  }

  return {
    stage, labels, start,
    /** Value of a numeric URL option (0 when absent). */
    num: (name: string) => Math.max(0, Number(query.get(name)) || 0),
    query,
  };
}
