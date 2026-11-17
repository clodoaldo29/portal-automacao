// A production room around a cell: ESD floor with tile lines, walls with a coloured band (front wall kept low so
// the cameras see in), and ceiling light panels (hidden when the camera goes above them).
import * as THREE from 'three';
import { at, box, canvasTex, mk, std } from './kit';

export interface RoomOptions {
  /** Width (x) and depth (z) in metres, centred on (x, z). */
  w: number;
  d: number;
  h?: number;
  x?: number;
  z?: number;
  /** Floor and band colours. */
  floor?: string;
  band?: number;
  /** Room name painted on the back wall. */
  name?: string;
  font?: string;
}

function tileTex(color: string) {
  const [c, g] = mk(256, 256);
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(40, 60, 80, 0.18)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 254, 254);
  const t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildRoom(scene: THREE.Scene, o: RoomOptions) {
  const { w, d } = o, h = o.h ?? 4, cx = o.x ?? 0, cz = o.z ?? 0;
  const root = new THREE.Group();
  root.position.set(cx, 0, cz);
  scene.add(root);
  // ESD floor, 0.6 m tiles
  const tex = tileTex(o.floor ?? '#c9d3dc');
  tex.repeat.set(w / 0.6, d / 0.6);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: tex }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.006;
  floor.receiveShadow = true;
  floor.userData.noShadow = true;
  root.add(floor);
  // walls: back and sides full height, front low
  const wall = std(0xe9edf1, 0.05, 0.8), band = std(o.band ?? 0x2f6fb0, 0.1, 0.5);
  root.add(at(box(w, h, 0.15, wall), 0, h / 2, -d / 2));
  for (const s of [-1, 1]) root.add(at(box(0.15, h, d, wall), s * w / 2, h / 2, 0));
  root.add(at(box(w, 0.9, 0.12, wall), 0, 0.45, d / 2));
  root.add(at(box(w, 0.12, 0.17, band), 0, 1.2, -d / 2 + 0.01));
  for (const s of [-1, 1]) root.add(at(box(0.17, 0.12, d, band), s * (w / 2 - 0.01), 1.2, 0));
  root.add(at(box(w, 0.1, 0.14, band), 0, 0.85, d / 2));
  if (o.name) {
    const [c, g] = mk(1024, 128);
    g.fillStyle = '#0b3a6b';
    g.font = `700 64px ${o.font ?? 'sans-serif'}`;
    g.textBaseline = 'middle';
    g.fillText(o.name, 24, 64);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.5), new THREE.MeshBasicMaterial({ map: canvasTex(c), transparent: true }));
    sign.position.set(-w / 2 + 2.4, 2.6, -d / 2 + 0.09);
    sign.userData.noShadow = true;
    root.add(sign);
  }
  // ceiling light panels (clean-room filter units)
  const ceiling = new THREE.Group();
  root.add(ceiling);
  const panelMat = new THREE.MeshBasicMaterial({ color: 0xf6fbff });
  for (let x = -w / 2 + 1; x < w / 2 - 0.5; x += 2) for (let z = -d / 2 + 1; z < d / 2 - 0.5; z += 2) ceiling.add(at(box(1.1, 0.04, 0.55, panelMat), x + 0.5, h - 0.02, z + 0.5));
  ceiling.traverse(m => (m.userData.noShadow = true));
  return { root, ceiling, h };
}
