// Named camera views with a smooth transition, and a looping camera tour.
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { clamp, ease } from './math';

type V3 = [number, number, number];
export interface ViewDef { pos: V3; target: V3 }

export interface ViewOptions {
  views: Record<string, ViewDef>;
  tour?: { positions: V3[]; targets: V3[]; seconds: number };
  /** Called with the active view name ('tour' during the tour, '' after the user takes over). */
  onChange?: (name: string) => void;
}

export function createViews(camera: THREE.PerspectiveCamera, controls: OrbitControls, opts: ViewOptions) {
  let tween: { t: number; fromPos: THREE.Vector3; fromTarget: THREE.Vector3; to: { pos: THREE.Vector3; target: THREE.Vector3 } } | null = null;
  let tour: { u: number } | null = null;
  const tourPos = opts.tour && new THREE.CatmullRomCurve3(opts.tour.positions.map(p => new THREE.Vector3(...p)), true);
  const tourTgt = opts.tour && new THREE.CatmullRomCurve3(opts.tour.targets.map(p => new THREE.Vector3(...p)), true);
  const notify = (n: string) => opts.onChange?.(n);

  /** Narrow screens pull the camera back so the whole line still fits. */
  function viewVectors(name: string) {
    const v = opts.views[name], aspect = camera.aspect || 1.6, target = new THREE.Vector3(...v.target);
    const dir = new THREE.Vector3(...v.pos).sub(target).multiplyScalar(clamp(1.95 / aspect, 1, 2.6));
    return { pos: target.clone().add(dir), target };
  }

  function go(name: string, instant = false) {
    tour = null;
    notify(name);
    const to = viewVectors(name);
    if (instant) { camera.position.copy(to.pos); controls.target.copy(to.target); controls.update(); return; }
    tween = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), to };
  }

  function startTour() { tween = null; tour = { u: 0 }; notify('tour'); }

  controls.addEventListener('start', () => { if (tour) { tour = null; notify(''); } tween = null; });

  /** Advance transitions by real (not simulated) time. */
  function update(dt: number) {
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / 0.9);
      const e = ease(tween.t);
      camera.position.lerpVectors(tween.fromPos, tween.to.pos, e);
      controls.target.lerpVectors(tween.fromTarget, tween.to.target, e);
      if (tween.t >= 1) tween = null;
    }
    if (tour && tourPos && tourTgt) {
      tour.u = (tour.u + dt / opts.tour!.seconds) % 1;
      camera.position.copy(tourPos.getPointAt(tour.u));
      controls.target.copy(tourTgt.getPointAt(tour.u));
    }
  }

  return { go, startTour, update, get touring() { return !!tour; } };
}
