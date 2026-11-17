// Floating name plates (navy with white outline), always drawn on top.
import * as THREE from 'three';
import { canvasTex, mk } from './kit';

export interface LabelDef { lines: string[]; x: number; y: number; z: number }

export function createLabels(scene: THREE.Scene, font: string) {
  const sprites: THREE.Sprite[] = [];
  let visible = true;

  function make({ lines, x, y, z }: LabelDef) {
    const fontPx = 44, pad = 24, lh = 52;
    const [c, g] = mk(10, 10);
    g.font = `600 ${fontPx}px ${font}`;
    const tw = Math.max(...lines.map(l => g.measureText(l).width));
    c.width = Math.ceil(tw + pad * 2);
    c.height = Math.ceil(lines.length * lh + pad * 1.2);
    g.font = `600 ${fontPx}px ${font}`;
    const r = 16, W = c.width, H = c.height;
    g.fillStyle = '#0b3a6b';
    g.strokeStyle = '#ffffff';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(r + 3, 3);
    g.arcTo(W - 3, 3, W - 3, H - 3, r); g.arcTo(W - 3, H - 3, 3, H - 3, r); g.arcTo(3, H - 3, 3, 3, r); g.arcTo(3, 3, W - 3, 3, r);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((l, i) => g.fillText(l, W / 2, pad * 0.6 + lh * (i + 0.5)));
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(c), depthTest: false, transparent: true }));
    sp.renderOrder = 10;
    sp.scale.set(W / 300, H / 300, 1);
    sp.position.set(x, y, z);
    sp.visible = visible;
    scene.add(sp);
    sprites.push(sp);
  }

  /** (Re)draw every label, e.g. once the web font has loaded. */
  function build(defs: LabelDef[]) {
    sprites.forEach(l => { scene.remove(l); l.material.map?.dispose(); l.material.dispose(); });
    sprites.length = 0;
    defs.forEach(make);
  }

  return {
    sprites,
    build,
    get visible() { return visible; },
    setVisible(v: boolean) { visible = v; sprites.forEach(l => (l.visible = v)); },
    /** Temporarily show or hide without changing the user's choice (PNG export, reflections). */
    showTemporarily(v: boolean) { sprites.forEach(l => (l.visible = v)); },
    restore() { sprites.forEach(l => (l.visible = visible)); },
  };
}

export type Labels = ReturnType<typeof createLabels>;
