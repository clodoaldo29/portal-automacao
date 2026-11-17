// High-resolution PNG of the current camera: rendered off-screen at the chosen size with up to 2× supersampling
// (rendered larger, then scaled down with high-quality filtering), a sharper shadow map and a full-size reflection.
import type * as THREE from 'three';
import { resetShadowMap } from './kit';
import type { Labels } from './labels';
import type { Stage } from './stage';

export interface ShotOptions {
  /** Output width in pixels. */
  width: number;
  /** Width / height, or 'view' for the screen's aspect. */
  aspect: number | 'view';
  withLabels: boolean;
}

export interface ShotResult { canvas: HTMLCanvasElement; W: number; H: number; ss: number; shadow: number; capped: boolean }

export function renderShot(stage: Stage, labels: Labels | null, beforeRender: (camera: THREE.PerspectiveCamera) => void, opts: ShotOptions): ShotResult {
  const { renderer, scene, camera, sun, mirror } = stage;
  const gl = renderer.getContext();
  const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  const maxSide = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), vp[0], vp[1]);
  const asp = opts.aspect === 'view' ? camera.aspect : opts.aspect;
  let W = opts.width, H = Math.round(W / asp), capped = false;
  if (Math.max(W, H) > maxSide) { const f = maxSide / Math.max(W, H); W = Math.floor(W * f); H = Math.floor(H * f); capped = true; }
  // supersampling: 2× when the GPU allows it, kept under ~40 Mpx so it does not run out of memory
  const ss = Math.max(1, Math.min(2, maxSide / Math.max(W, H), Math.sqrt(40e6 / (W * H))));
  const rw = Math.round(W * ss), rh = Math.round(H * ss);
  const prevAsp = camera.aspect, shadow = Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE));
  try {
    labels?.showTemporarily(opts.withLabels);
    renderer.setPixelRatio(1);
    renderer.setSize(rw, rh, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    sun.shadow.mapSize.set(shadow, shadow);
    resetShadowMap(sun);
    if (mirror.visible) mirror.getRenderTarget().setSize(rw, rh);
    beforeRender(camera);
    renderer.render(scene, camera);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(renderer.domElement, 0, 0, W, H);
    return { canvas, W, H, ss, shadow, capped };
  } finally {
    // back to the live view
    camera.aspect = prevAsp;
    camera.updateProjectionMatrix();
    labels?.restore();
    stage.applyQuality(); // restores pixel ratio, shadow map, reflection size and canvas size
  }
}
