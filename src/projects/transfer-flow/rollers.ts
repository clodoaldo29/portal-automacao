// The TV line conveyor (LTV01): powered roller conveyor, the same in every station of the line (Intellifix AI
// screwdriving, Transfer Flow assembly and test belts). Rollers every 10 cm, side rails under the roller top (the
// 1.2 m jig rides over them), legs every 1.2 m.
import * as THREE from 'three';
import { at, box, shadowify, std } from '../../sim/kit';
import type { Materials } from '../../sim/materials';

const rollerMat = std(0xc7cdd4, 0.85, 0.25);

/** Roller conveyor along x from x0 to x1 at depth z, roller top at `top`, `w` wide. */
export function rollerConveyor(scene: THREE.Scene, M: Materials, { x0, x1, z, top, w }: { x0: number; x1: number; z: number; top: number; w: number }) {
  const g = new THREE.Group(), len = x1 - x0, mid = (x0 + x1) / 2;
  for (const s of [-1, 1]) g.add(at(box(len, 0.12, 0.04, M.alu), mid, top - 0.07, z + s * (w / 2 + 0.02)));
  const n = Math.floor(len / 0.1);
  const rollers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.024, 0.024, w, 14), rollerMat, n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2), one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i++) rollers.setMatrixAt(i, m4.compose(new THREE.Vector3(x0 + 0.05 + i * 0.1, top - 0.024, z), q, one));
  g.add(rollers);
  const legH = top - 0.13;
  for (let x = x0 + 0.1; x <= x1; x += 1.2) for (const s of [-1, 1]) {
    g.add(at(box(0.045, legH, 0.045, M.alu), x, legH / 2, z + s * (w / 2 - 0.02)));
    g.add(at(box(0.09, 0.03, 0.09, M.dark), x, 0.015, z + s * (w / 2 - 0.02)));
  }
  for (let x = x0 + 0.1; x <= x1; x += 1.2) g.add(at(box(0.04, 0.04, w - 0.04, M.aluDark), x, Math.min(0.2, legH * 0.5), z)); // cross bars
  shadowify(g);
  scene.add(g);
  return g;
}
