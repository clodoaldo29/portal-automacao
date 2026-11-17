// Factory hall around a cell: walls, windows, columns, ceiling trusses with light rows and pipes,
// plus the safety fence and the yellow floor tape.
import * as THREE from 'three';
import { at, box, canvasTex, cylA, mk, shadowify, std } from './kit';
import type { Materials } from './materials';

function meshTex() {
  const [c, g] = mk(128, 128);
  g.strokeStyle = 'rgba(70,78,88,0.9)';
  g.lineWidth = 2;
  for (let i = 0; i <= 128; i += 16) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
  }
  const t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Mesh fence along x at depth z, with yellow posts every 3.8 m. */
export function buildFence(scene: THREE.Scene, M: Materials, z: number, length = 38) {
  const fenceMat = new THREE.MeshStandardMaterial({ map: meshTex(), transparent: true, opacity: 0.85, side: THREE.DoubleSide, metalness: 0.4, roughness: 0.5, depthWrite: false });
  fenceMat.map!.repeat.set(length, 3);
  const fence = at(new THREE.Mesh(new THREE.PlaneGeometry(length, 2.2), fenceMat), 0, 1.25, z);
  fence.userData.noShadow = true;
  scene.add(fence);
  const half = length / 2;
  for (let x = -half; x <= half + 0.01; x += 3.8) {
    scene.add(at(box(0.12, 2.5, 0.12, M.yellow), x, 1.25, z));
    scene.add(at(box(0.35, 0.04, 0.35, M.yellow), x, 0.02, z));
  }
  scene.add(at(box(length, 0.07, 0.07, M.aluDark), 0, 2.38, z));
}

/** Walls, columns and ceiling. Returns the ceiling group (hidden when the camera goes above it). */
export function buildHall(scene: THREE.Scene, M: Materials) {
  const ceiling = new THREE.Group();
  scene.add(ceiling);
  const wallMat = std(0xe1e5e9, 0.05, 0.85);
  scene.add(at(new THREE.Mesh(new THREE.PlaneGeometry(130, 14), wallMat), 0, 7, -36));
  const front = at(new THREE.Mesh(new THREE.PlaneGeometry(130, 14), wallMat), 0, 7, 40);
  front.rotation.y = Math.PI;
  scene.add(front);
  for (const sx of [-1, 1]) {
    const w = at(new THREE.Mesh(new THREE.PlaneGeometry(80, 14), wallMat), sx * 60, 7, 2);
    w.rotation.y = -sx * Math.PI / 2;
    scene.add(w);
  }
  const winMat = new THREE.MeshBasicMaterial({ color: 0xf4f8fb });
  for (let x = -55; x <= 55; x += 11) scene.add(at(new THREE.Mesh(new THREE.PlaneGeometry(8, 1.8), winMat), x, 11.4, -35.95));
  const colMat = std(0xe8ebee, 0.1, 0.6);
  for (const z of [-20, 18]) for (let x = -48; x <= 48; x += 12) {
    if (z > 0 && Math.abs(x) < 36) continue; // front row stays clear of the camera's line of sight
    scene.add(shadowify(at(box(0.7, 13, 0.7, colMat), x, 6.5, z)));
    scene.add(at(box(0.9, 1.2, 0.9, M.yellow), x, 0.6, z));
  }
  const truss = std(0xb7bec6, 0.6, 0.4);
  for (let z = -33; z <= 37; z += 6) ceiling.add(at(box(120, 0.3, 0.18, truss), 0, 13.2, z));
  for (let x = -48; x <= 48; x += 12) ceiling.add(at(box(0.18, 0.5, 76, truss), x, 13.5, 2));
  const lights = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 0.08, 0.32), new THREE.MeshBasicMaterial({ color: 0xffffff }), 13 * 12);
  let k = 0;
  const m4 = new THREE.Matrix4();
  for (let x = -48; x <= 48; x += 8) for (let z = -30; z <= 36; z += 6) { m4.makeTranslation(x, 12.9, z); lights.setMatrixAt(k++, m4); }
  lights.count = k;
  ceiling.add(lights);
  const pipeRed = std(0xb3302c, 0.3, 0.5), pipeBlue = std(0x2f5f9c, 0.3, 0.5), duct = std(0xc9ced4, 0.8, 0.3);
  for (const [z, mat, r] of [[-8, pipeRed, 0.12], [-7.5, pipeRed, 0.12], [9, pipeBlue, 0.1], [15, duct, 0.55]] as const) {
    ceiling.add(at(cylA(r, 120, mat, 'x', 16), 0, 12.2, z));
  }
  return ceiling;
}

/** Yellow floor tape. */
export function createFloorMarks(scene: THREE.Scene) {
  const tape = new THREE.MeshBasicMaterial({ color: 0xf2c230 });
  const line = (x1: number, z1: number, x2: number, z2: number, w = 0.14) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, w), tape);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.atan2(z2 - z1, x2 - x1);
    m.position.set((x1 + x2) / 2, 0.012, (z1 + z2) / 2);
    m.userData.noShadow = true;
    scene.add(m);
  };
  const rect = (x1: number, z1: number, x2: number, z2: number, w?: number) => {
    line(x1, z1, x2, z1, w); line(x2, z1, x2, z2, w); line(x2, z2, x1, z2, w); line(x1, z2, x1, z1, w);
  };
  return { line, rect };
}
