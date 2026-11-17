// Conveyor geometry built along a Track: belt surface, side rails, legs and cross bars; flow arrows; lift units.
import * as THREE from 'three';
import { at, box, canvasTex, mk, std } from './kit';
import type { Materials } from './materials';
import type { Track } from './track';

/** Flat strip of width w following the track at height y (optionally shifted sideways by `offset`). */
export function ribbon(track: Track, w: number, y: number, { offset = 0, tile = 0.5, step = 0.2 } = {}) {
  const n = Math.max(2, Math.ceil(track.length / step)), pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * track.length, p = track.at(s), nx = -Math.sin(p.h), nz = Math.cos(p.h);
    const cx = p.x + nx * offset, cz = p.z + nz * offset;
    pos.push(cx + nx * w / 2, y, cz + nz * w / 2, cx - nx * w / 2, y, cz - nz * w / 2);
    uv.push(s / tile, 1, s / tile, 0);
    nor.push(0, 1, 0, 0, 1, 0);
    if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  return geo;
}

/** Vertical strip from y0 to y1 following the track, `offset` to the side. */
export function wall(track: Track, offset: number, y0: number, y1: number, step = 0.25) {
  const n = Math.max(2, Math.ceil(track.length / step)), pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const p = track.at((i / n) * track.length), nx = -Math.sin(p.h), nz = Math.cos(p.h);
    const x = p.x + nx * offset, z = p.z + nz * offset;
    pos.push(x, y0, z, x, y1, z);
    if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function beltTex() {
  const [c, g] = mk(128, 64);
  g.fillStyle = '#2f6b47'; g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#245739'; for (let x = 0; x < 128; x += 16) g.fillRect(x, 0, 3, 64);
  g.fillStyle = '#1d4630'; g.fillRect(0, 0, 128, 5); g.fillRect(0, 59, 128, 5);
  const t = canvasTex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Belt conveyor of width beltW with its top at `top`. Returns the belt texture (scrolled to show motion). */
export function buildConveyor(scene: THREE.Scene, M: Materials, track: Track, beltW: number, top: number) {
  const tex = beltTex();
  const aluDouble = M.alu.clone();
  aluDouble.side = THREE.DoubleSide;
  const belt = new THREE.Mesh(ribbon(track, beltW, top, { tile: 0.25 }), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.65, metalness: 0.05, side: THREE.DoubleSide }));
  belt.receiveShadow = true;
  belt.userData.noShadow = true;
  scene.add(belt);
  for (const s of [-1, 1]) {
    const r = new THREE.Mesh(wall(track, s * (beltW / 2 + 0.03), top - 0.16, top + 0.04), aluDouble);
    r.castShadow = true;
    r.receiveShadow = true;
    scene.add(r);
    scene.add(new THREE.Mesh(ribbon(track, 0.05, top + 0.04, { offset: s * (beltW / 2 + 0.03) }), aluDouble));
  }
  const legH = top - 0.16, step = 1.25, nLeg = Math.floor(track.length / step) + (track.loop ? 0 : 1);
  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.045, legH, 0.045), M.alu, nLeg * 2);
  const feet = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.055, 0.03, 12), M.dark, nLeg * 2);
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, 0.04, beltW), M.aluDark, nLeg);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1);
  let k = 0;
  for (let i = 0; i < nLeg; i++) {
    const sv = track.loop ? i * (track.length / nLeg) : Math.min(track.length, i * step);
    const p = track.at(sv), nx = -Math.sin(p.h), nz = Math.cos(p.h);
    q.setFromAxisAngle(up, -p.h);
    for (const s of [-1, 1]) {
      const x = p.x + nx * s * (beltW / 2 - 0.02), z = p.z + nz * s * (beltW / 2 - 0.02);
      m4.compose(new THREE.Vector3(x, legH / 2, z), q, sc); legs.setMatrixAt(k, m4);
      m4.compose(new THREE.Vector3(x, 0.03, z), q, sc); feet.setMatrixAt(k, m4);
      k++;
    }
    m4.compose(new THREE.Vector3(p.x, 0.2, p.z), q, sc); bars.setMatrixAt(i, m4);
  }
  [legs, feet, bars].forEach(m => { m.castShadow = true; m.receiveShadow = true; scene.add(m); });
  return tex;
}

/** Blue flow-direction arrow painted on a belt. */
export function flowArrow(scene: THREE.Scene, x: number, z: number, y: number) {
  const sh = new THREE.Shape();
  sh.moveTo(0, -0.14); sh.lineTo(0.9, -0.14); sh.lineTo(0.9, -0.36); sh.lineTo(1.4, 0); sh.lineTo(0.9, 0.36); sh.lineTo(0.9, 0.14); sh.lineTo(0, 0.14); sh.closePath();
  const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color: 0x1f5fd6, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.scale.setScalar(0.4);
  at(m, x, y, z);
  m.userData.noShadow = true;
  scene.add(m);
}

/**
 * Lift unit at a belt end (over-under return), centred at (x, z). `side` is -1 for the left end and +1 for the right:
 * the closed wall faces outward, the opening (clear height `open`) faces the belt.
 */
export function liftUnit(scene: THREE.Scene, M: Materials, { x, z, beltW, side, open = 2.1 }: { x: number; z: number; beltW: number; side: -1 | 1; open?: number }) {
  const L = 2.6, D = beltW + 0.5, Hh = 2.35, sx = side;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  scene.add(g);
  g.add(at(box(L, 0.08, D, M.dark), 0, 0.04, 0));
  for (const px of [-1, 1]) for (const pz of [-1, 1]) g.add(at(box(0.08, Hh, 0.08, M.alu), px * L / 2, Hh / 2, pz * D / 2));
  g.add(at(box(L + 0.04, 0.08, D + 0.04, M.alu), 0, Hh, 0));
  const skin = std(0xe4e8ec, 0.2, 0.5);
  g.add(at(box(L - 0.1, Hh - 0.2, 0.03, skin), 0, Hh / 2, D / 2));
  g.add(at(box(L - 0.1, Hh - 0.2, 0.03, skin), 0, Hh / 2, -D / 2));
  g.add(at(box(0.03, Hh - 0.2, D - 0.1, skin), sx * L / 2, Hh / 2, 0));
  g.add(at(box(0.03, Hh - open, D - 0.1, skin), -sx * L / 2, open + (Hh - open) / 2, 0)); // header above the opening
  for (let i = 0; i < 4; i++) {
    const s = at(box(0.03, 0.18, 0.03, M.yellow), -sx * (L / 2 + 0.02), open + 0.1, -D / 2 + 0.2 + i * (D - 0.4) / 3);
    s.rotation.x = 0.6;
    g.add(s);
  }
  g.add(at(box(0.4, 0.22, 0.03, M.blue), 0, 1.6, D / 2 + 0.02));
  return g;
}
