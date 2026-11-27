// Smart Pack products: the TV (the Transfer Flow one), its protective bag, the box base with the EPS corners and the
// box cover. TV local frame (makeTV): width along x, screen on +y, standing in the test pallet its local −z is up.
import * as THREE from 'three';
import { at, box, canvasTex, mk, shadowify } from '../../sim/kit';
import type { Materials } from '../../sim/materials';
import { TV_STANDING } from '../transfer-flow/products';
import { SEAT_BOX, SIZES, TV_T, coverOf, trayOf, type Inch } from './config';

import { makeTV as makeTFTV, type TV } from '../transfer-flow/products';
export { makePallet, type TV } from '../transfer-flow/products';

/**
 * The Transfer Flow TV with its label (on the back) at the bottom edge, as on the real TV: the label marks the bottom.
 * Standing (pallet, box base) the label is down; lying on the bagging belt it is on the far side, toward the box line.
 */
export function makeTV(M: Materials, inch: Inch): TV {
  const tv = makeTFTV(M, inch);
  const label = tv.obj.children[2]; // body, back bump, label, screen
  label.position.z = Math.abs(label.position.z); // local +z: the bottom edge (local −z is up when standing)
  return tv;
}
export { TV_STANDING };

const Xa = new THREE.Vector3(1, 0, 0);
/**
 * Lying screen-down on the packing line as on the Transfer Flow assembly belt: width along the line (x), top edge
 * toward the robot (+z), bottom edge on the far side, back up. It is the TV as it stood in the test pallet, laid down
 * by the robot (tool from horizontal to pointing down: +90° about x); it keeps its heading while the base turns.
 */
export const TV_LYING = new THREE.Quaternion().setFromAxisAngle(Xa, Math.PI / 2).multiply(TV_STANDING);
/** Standing sideways in the box base after the upender (−90° about x at the foot): as it stood in the test pallet,
 *  width along the line, screen toward +z, back toward the box line. */
export const TV_BOXED = TV_STANDING.clone();

const film = new THREE.MeshStandardMaterial({ color: 0xc9dceb, metalness: 0, roughness: 0.2, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
/**
 * Protective bag, in the TV's frame. It goes on from the bottom edge (local +z, the edge that leads into the bagger):
 * `setBag(bag, u)` with u from 0 (not on) to 1 (covering the TV, its open end folded past the top edge).
 */
export function makeBag(inch: Inch) {
  const [w, h] = SIZES[inch], len = h + 0.06;
  const geo = new THREE.BoxGeometry(w + 0.04, TV_T + 0.06, len);
  geo.translate(0, -0.012, -len / 2); // grows from the bottom edge toward the top edge
  const m = new THREE.Mesh(geo, film);
  m.position.z = h / 2 + 0.03;
  m.userData.noShadow = true;
  m.renderOrder = 2;
  setBag(m, 0);
  return m;
}
export const setBag = (bag: THREE.Mesh, u: number) => { bag.visible = u > 0.001; bag.scale.z = Math.max(0.001, u); };

let cardTex: THREE.Texture | null = null;
/** Printed side of the box: kraft with a blue band and the TV outline. */
function coverTex() {
  if (cardTex) return cardTex;
  const [c, g] = mk(512, 256);
  g.fillStyle = '#b8895a'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#1f4fa8'; g.fillRect(0, 170, 512, 46);
  g.strokeStyle = '#2b2b2b'; g.lineWidth = 6; g.strokeRect(150, 40, 212, 110);
  g.fillStyle = '#2b2b2b'; g.fillRect(236, 150, 40, 10);
  g.fillStyle = '#ffffff'; g.font = '600 30px Arial'; g.fillText('SMART TV', 196, 203);
  cardTex = canvasTex(c);
  return cardTex;
}

/** Box base (open tray) with the two EPS corners holding the TV's bottom corners; group origin on its bottom centre. */
export function makeBase(M: Materials, inch: Inch) {
  const t = trayOf(inch), g = new THREE.Group(), k = 0.006;
  g.add(at(box(t.d, k, t.l, M.cardboard), 0, k / 2, 0));
  for (const s of [-1, 1]) {
    g.add(at(box(k, t.h, t.l, M.cardboard), s * (t.d / 2 - k / 2), t.h / 2, 0));
    g.add(at(box(t.d - 2 * k, t.h, k, M.cardboard), 0, t.h / 2, s * (t.l / 2 - k / 2)));
  }
  // EPS corners (white): under the TV's corner and either side of it, the slot ~13 cm for the TV and its back cover
  const eps = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, metalness: 0, roughness: 0.95 });
  const [w] = SIZES[inch], len = 0.22, slot = 0.13, zc = w / 2 + 0.06 - len / 2, side = (t.d - 2 * k - slot) / 2;
  for (const s of [-1, 1]) {
    g.add(at(box(t.d - 2 * k, SEAT_BOX - k, len, eps), 0, k + (SEAT_BOX - k) / 2, s * zc));
    for (const sx of [-1, 1]) g.add(at(box(side, 0.17, len, eps), sx * (slot / 2 + side / 2), k + 0.085, s * zc));
  }
  shadowify(g);
  return g;
}

export interface Tube { obj: THREE.Group; set: (u: number) => void }
/**
 * Box body (the top part of the box): it comes folded flat and the erector opens it into a tube with no bottom (the base
 * is the bottom) and the top flaps left open upward, for the kit and the EPS of station 5. Group origin on the bottom,
 * at the centre of the open tube; length l along x, depth d along z; panel A (long side, printed) at z = −d/2 is the one
 * the erector holds. `set(u)`: 0 folded flat (both layers at z ≈ −d/2), 1 open and square.
 */
export function makeTube(M: Materials, inch: Inch): Tube {
  const { l, d, h } = coverOf(inch), k = 0.006, fh = d / 2;
  const printed = new THREE.MeshStandardMaterial({ map: coverTex(), metalness: 0, roughness: 0.85 });
  const g = new THREE.Group();
  // panels A, B, C, D around the tube; each one's local x runs along it and its outer face is local −z
  const panels = [l, d, l, d].map((len, i) => {
    const p = new THREE.Group();
    g.add(p);
    const faces = i % 2 === 0 ? Array.from({ length: 6 }, (_, f) => (f === 5 ? printed : M.cardboard)) : M.cardboard;
    p.add(at(new THREE.Mesh(new THREE.BoxGeometry(len, h, k), faces), len / 2, h / 2, -k / 2));
    const flap = new THREE.Group();
    flap.position.y = h;
    flap.add(at(box(len - 0.006, fh, k, M.cardboard), len / 2, fh / 2, -k / 2));
    p.add(flap);
    return { p, flap };
  });
  const set = (u: number) => {
    const a = 0.03 + u * (Math.PI / 2 - 0.03), vx = -Math.cos(a) * d, vz = Math.sin(a) * d;
    const pts = [[-l / 2, -d / 2], [l / 2, -d / 2], [l / 2 + vx, -d / 2 + vz], [-l / 2 + vx, -d / 2 + vz]];
    panels.forEach((q, i) => {
      const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % 4];
      q.p.position.set(x0, 0, z0);
      q.p.rotation.y = Math.atan2(-(z1 - z0), x1 - x0);
      q.flap.rotation.x = -0.22 * u; // the flaps lean out a little once open
    });
  };
  set(0);
  shadowify(g);
  return { obj: g, set };
}
/** Standing in the test pallet with the screen toward the robot (−z), top up, width along the line. */
export const TV_PALLET = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI).multiply(TV_STANDING);
