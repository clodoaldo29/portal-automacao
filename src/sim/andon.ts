// Andon stack lights: red (alarm, blinking), amber (waiting), green (running).
import * as THREE from 'three';
import { at, cyl, glow } from './kit';
import type { Materials } from './materials';

export type AndonState = 'run' | 'wait' | 'alarm';
export interface Andon { lamps: { mat: THREE.MeshStandardMaterial; gl: THREE.Sprite }[]; state: AndonState }

export function createAndons(M: Materials) {
  const list: Andon[] = [];
  function make(parent: THREE.Object3D, x: number, y: number, z: number): Andon {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    g.add(at(cyl(0.03, 0.03, 0.35, M.alu, 8), 0, 0.17, 0));
    const lamps: Andon['lamps'] = [];
    [0xef4444, 0xf59e0b, 0x22c55e].forEach((c, i) => {
      const mat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0, transparent: true, opacity: 0.9, roughness: 0.3 });
      const m = at(cyl(0.085, 0.085, 0.13, mat, 16), 0, 0.82 - i * 0.14, 0);
      g.add(m);
      const gl = glow(c, 0.9);
      gl.position.copy(m.position);
      gl.visible = false;
      g.add(gl);
      lamps.push({ mat, gl });
    });
    g.add(at(cyl(0.09, 0.09, 0.05, M.dark, 16), 0, 0.92, 0));
    const a: Andon = { lamps, state: 'wait' };
    list.push(a);
    return a;
  }
  function update(time: number) {
    for (const a of list) {
      const on = [a.state === 'alarm' && Math.sin(time * 12) > 0, a.state === 'wait', a.state === 'run'];
      a.lamps.forEach((l, i) => { l.mat.emissiveIntensity = on[i] ? 2.2 : 0.05; l.gl.visible = on[i]; });
    }
  }
  return { make, update, list };
}
