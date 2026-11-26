// Smart Pack equipment geometry (no logic): bagger, upender with the side-clamp lowering unit, cover gantry with its
// magazine, base preparation table, and the existing stations 5–10 drawn grey.
import * as THREE from 'three';
import { at, box, cyl, cylA, shadowify, std } from '../../sim/kit';
import type { Materials } from '../../sim/materials';
import {
  BAGGER, BELT_BOX, BOX_END, CABIN_L, COVER_X, EXIST_X0, GANTRY_Y, MAG_Z0, PIVOT_Z, PREP_X, TABLE_D, TABLE_L, UP_X, Y_BOX, Y_PACK, Z_BASE, Z_EDGE, Z_MAG, Z_PACK,
} from './config';

const panel = std(0xe6e9ed, 0.2, 0.5), band = std(0x1f5fd6, 0.2, 0.4), frameMat = std(0x3a4047, 0.4, 0.45);
const glass = new THREE.MeshStandardMaterial({ color: 0xcfe3f0, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });

/**
 * Station 2: bagger housing around the packing belt, glazed on the robot side. Inside, the bag mouth frame (a bar
 * along the TV's width) travels across the belt, from the TV's bottom edge to its top edge, pulling the bag over it.
 */
export function buildBagger(scene: THREE.Scene, M: Materials) {
  const { x0, x1, w, h } = BAGGER, L = x1 - x0, xc = (x0 + x1) / 2, z = Z_PACK;
  const g = new THREE.Group();
  g.position.set(xc, 0, z);
  scene.add(g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(box(0.07, h, 0.07, frameMat), sx * (L / 2 - 0.035), h / 2, sz * (w / 2 - 0.035)));
  for (const sz of [-1, 1]) for (const y of [0.35, h - 0.035]) g.add(at(box(L, 0.07, 0.07, frameMat), 0, y, sz * (w / 2 - 0.035)));
  g.add(at(box(L, 0.05, w, panel), 0, h - 0.025, 0)); // roof
  // far side (−z): closed panel with the blue band; robot side (+z): glazed so the bagging is seen
  g.add(at(box(L - 0.08, h - 0.45, 0.02, panel), 0, 0.4 + (h - 0.45) / 2, -w / 2 + 0.01));
  g.add(at(box(L - 0.08, 0.14, 0.022, band), 0, h - 0.25, -w / 2 + 0.012));
  const win = at(new THREE.Mesh(new THREE.PlaneGeometry(L - 0.12, h - 0.55), glass), 0, 0.4 + (h - 0.55) / 2, w / 2 - 0.01);
  win.userData.noShadow = true;
  g.add(win);
  g.add(at(box(L - 0.08, 0.14, 0.022, band), 0, h - 0.25, w / 2 - 0.012));
  // end walls with the tunnel opening (0.42 m over the belt) and strip curtains
  const open = 0.42, top = Y_PACK + open;
  for (const sx of [-1, 1]) {
    g.add(at(box(0.02, h - top, w - 0.08, panel), sx * (L / 2 - 0.01), top + (h - top) / 2, 0));
    for (let i = 0; i < 8; i++) {
      const s = at(box(0.004, open - 0.02, 0.2, glass), sx * (L / 2 - 0.01), Y_PACK + 0.01 + (open - 0.02) / 2, -0.77 + i * 0.22);
      s.userData.noShadow = true;
      g.add(s);
    }
  }
  // bag cassette and film roll on the roof, control cabinet with HMI on the robot side
  g.add(at(box(1.1, 0.35, 0.7, panel), -0.5, h + 0.17, -0.35));
  g.add(at(cylA(0.16, 0.8, std(0xd6e6f2, 0.05, 0.3), 'z'), 0.6, h + 0.18, -0.3));
  g.add(at(box(0.6, 1.6, 0.3, panel), 0.7, 0.8, w / 2 + 0.17));
  g.add(at(box(0.32, 0.22, 0.03, std(0x0b1b33, 0.2, 0.3, { emissive: 0x1d4ed8, emissiveIntensity: 0.5 })), 0.7, 1.3, w / 2 + 0.33));
  // bag mouth frame: posts beyond both ends of the TV and a bar along its width; it moves across the belt (local z)
  const mouth = new THREE.Group();
  mouth.position.set(0, Y_PACK, Z_EDGE - Z_PACK - 0.2);
  g.add(mouth);
  const span = 1.95, ringH = 0.3;
  for (const s of [-1, 1]) mouth.add(at(box(0.04, ringH, 0.04, M.alu), s * (span / 2), ringH / 2, 0));
  mouth.add(at(box(span, 0.04, 0.04, M.alu), 0, ringH, 0));
  for (const s of [-1, 1]) mouth.add(at(box(0.12, 0.03, 0.05, M.yellow), s * (span / 2 - 0.08), ringH - 0.03, 0));
  shadowify(g);
  return { group: g, mouth, top: new THREE.Vector3(xc + L / 2 - 0.3, h + 0.02, z + w / 2 - 0.3) };
}

/**
 * Station 3: upender. The table (rollers along the line) pivots about an axis along x at its far edge (PIVOT_Z),
 * where the foot stop is: a TV lying screen-down with its bottom edge on the foot stands up sideways, screen against
 * the table pads. Returns the pivoting group (origin on the pivot, on the roller top): rotate it about x (0 → −90°).
 */
export function buildUpender(scene: THREE.Scene, M: Materials) {
  const L = TABLE_L, D = TABLE_D;
  const base = new THREE.Group();
  base.position.set(UP_X, 0, PIVOT_Z);
  scene.add(base);
  for (const sx of [-1, 1]) {
    base.add(at(box(0.12, Y_PACK - 0.08, 0.12, frameMat), sx * (L / 2 - 0.06), (Y_PACK - 0.08) / 2, 0.06)); // pivot posts
    base.add(at(box(0.1, Y_PACK - 0.2, 0.1, frameMat), sx * (L / 2 - 0.06), (Y_PACK - 0.2) / 2, D - 0.1)); // rest posts
    base.add(at(box(0.08, 0.08, D, frameMat), sx * (L / 2 - 0.06), 0.15, D / 2));
  }
  base.add(at(cylA(0.03, L + 0.1, M.alu, 'x'), 0, Y_PACK - 0.06, 0.06)); // pivot shaft
  // tilting drive: gearmotor on the pivot shaft, past the downstream end of the table
  base.add(at(box(0.16, 0.22, 0.22, M.blue), L / 2 + 0.14, Y_PACK - 0.06, 0.06));
  base.add(at(cylA(0.07, 0.24, M.aluDark, 'z'), L / 2 + 0.14, Y_PACK - 0.06, 0.28));
  const table = new THREE.Group();
  table.position.set(0, Y_PACK, 0);
  base.add(table);
  table.add(at(box(L, 0.05, D, frameMat), 0, -0.075, D / 2));
  const n = Math.floor((L - 0.1) / 0.1);
  const rollers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.024, 0.024, D - 0.12, 12), std(0xc7cdd4, 0.85, 0.25), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2), one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i++) rollers.setMatrixAt(i, m4.compose(new THREE.Vector3(-L / 2 + 0.1 + i * 0.1, -0.024, D / 2 + 0.03), q, one));
  table.add(rollers);
  table.add(at(box(L - 0.1, 0.14, 0.04, M.yellow), 0, 0.02, -0.02)); // foot stop along the far edge (the TV's bottom edge rests on it)
  for (const sx of [-1, 1]) table.add(at(box(0.04, 0.1, D, M.alu), sx * (L / 2 - 0.02), -0.02, D / 2)); // side rails
  // soft pads the screen rests on when standing
  for (const z of [0.3, 0.7]) table.add(at(box(L - 0.3, 0.012, 0.08, M.rubber), 0, 0.004, z));
  shadowify(base);
  return { base, table };
}

/**
 * Side-clamp lowering unit over the upender and the box line: a portal with a carriage moving across the lines (z), a
 * vertical axis, and two clamp arms that close on the TV's side edges. `setClamp(z, padY, halfOpen)` places it.
 */
export function buildClampUnit(scene: THREE.Scene, M: Materials) {
  const za = Z_PACK + 1.1, zb = Z_BASE - 0.6, hx = CABIN_L / 2, top = 2.8;
  const g = new THREE.Group();
  g.position.set(UP_X, 0, 0);
  scene.add(g);
  for (const z of [za, zb]) for (const s of [-1, 1]) g.add(at(box(0.1, top, 0.1, frameMat), s * hx, top / 2, z));
  for (const s of [-1, 1]) g.add(at(box(0.12, 0.12, za - zb + 0.1, frameMat), s * hx, top + 0.06, (za + zb) / 2));
  for (const z of [za, zb]) g.add(at(box(2 * hx, 0.1, 0.1, frameMat), 0, top + 0.05, z));
  // cabin: glazed guards on the long sides; the end walls are glazed above the conveyors (the packing belt comes in,
  // the box line runs through)
  const sideH = top - 0.15, endY0 = 1.8;
  for (const z of [za, zb]) {
    const p = at(new THREE.Mesh(new THREE.PlaneGeometry(2 * hx - 0.1, sideH), glass), 0, 0.1 + sideH / 2, z);
    p.userData.noShadow = true;
    g.add(p);
    g.add(at(box(2 * hx, 0.06, 0.06, frameMat), 0, 0.1, z));
  }
  for (const s of [-1, 1]) {
    const p = at(new THREE.Mesh(new THREE.PlaneGeometry(za - zb - 0.1, top - endY0), glass), s * hx, endY0 + (top - endY0) / 2, (za + zb) / 2);
    p.rotation.y = Math.PI / 2;
    p.userData.noShadow = true;
    g.add(p);
    g.add(at(box(0.06, 0.06, za - zb, frameMat), s * hx, endY0, (za + zb) / 2));
  }
  const carriage = new THREE.Group();
  g.add(carriage);
  carriage.add(at(box(2 * hx, 0.1, 0.16, M.alu), 0, top - 0.05, 0));
  const arms = [-1, 1].map(s => {
    const a = new THREE.Group();
    carriage.add(a);
    a.add(at(box(0.12, 0.1, 0.14, M.aluDark), 0, top - 0.15, 0)); // slide on the cross beam
    const rod = box(0.05, 1, 0.05, M.alu);
    a.add(rod);
    const pad = box(0.04, 0.18, 0.16, M.rubber);
    a.add(pad);
    a.add(at(box(0.06, 0.1, 0.1, M.blue), s * 0.05, top - 0.28, 0)); // servo
    return { a, rod, pad, s };
  });
  shadowify(g);
  /** Carriage over z, pad centres at padY, pads' inner faces at ±halfOpen from the TV's middle (x). */
  const setClamp = (z: number, padY: number, halfOpen: number) => {
    carriage.position.z = z;
    for (const { a, rod, pad, s } of arms) {
      a.position.x = s * (halfOpen + 0.02);
      pad.position.set(0, padY, 0);
      const len = top - 0.1 - padY;
      rod.scale.y = Math.max(0.05, len);
      rod.position.set(s * 0.02, padY + len / 2, 0);
    }
  };
  return { group: g, setClamp, top };
}

/** Roller conveyor along z at x, from z0 to z1 (either way), roller top at `top`, rollers `w` long. */
export function rollerConveyorZ(scene: THREE.Scene, M: Materials, x: number, z0: number, z1: number, top: number, w: number) {
  const g = new THREE.Group(), len = Math.abs(z1 - z0), zl = Math.min(z0, z1), zm = (z0 + z1) / 2;
  for (const s of [-1, 1]) g.add(at(box(0.04, 0.12, len, M.alu), x + s * (w / 2 + 0.02), top - 0.07, zm));
  const n = Math.floor(len / 0.1);
  const rollers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.024, 0.024, w, 14), std(0xc7cdd4, 0.85, 0.25), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2), one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i++) rollers.setMatrixAt(i, m4.compose(new THREE.Vector3(x, top - 0.024, zl + 0.05 + i * 0.1), q, one));
  g.add(rollers);
  for (let z = zl + 0.1; z <= zl + len; z += 1.2) for (const s of [-1, 1]) g.add(at(box(0.045, top - 0.13, 0.045, M.alu), x + s * (w / 2 - 0.02), (top - 0.13) / 2, z));
  shadowify(g);
  scene.add(g);
  return g;
}

/** Operator table beside the start of the box line, where the bases get the EPS corners (manual, out of the automation scope). */
export function buildPrepTable(scene: THREE.Scene, M: Materials) {
  const g = new THREE.Group();
  g.position.set(PREP_X, 0, Z_BASE - BELT_BOX / 2 - 0.5);
  scene.add(g);
  g.add(at(box(2.0, 0.04, 0.8, M.white), 0, 0.88, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(box(0.04, 0.86, 0.04, M.alu), sx * 0.95, 0.43, sz * 0.35));
  const eps = std(0xf4f6f8, 0, 0.95);
  for (let i = 0; i < 4; i++) g.add(at(box(0.22, 0.17, 0.3, eps), -0.8 + (i % 2) * 0.26, 0.985, -0.15 + Math.floor(i / 2) * 0.34)); // EPS corners
  for (let i = 0; i < 5; i++) g.add(at(box(1.1, 0.012, 0.32, M.cardboard), 0.35, 0.91 + i * 0.012, 0)); // flat bases
  shadowify(g);
  return g;
}

/**
 * Station 4: cover gantry. Two beams along z (over the magazine head and the box line), a carriage along them, a
 * vertical mast and a bar of suction cups along x that holds the cover by its top. `setGantry(z, cupY)`.
 */
export function buildGantry(scene: THREE.Scene, M: Materials) {
  const za = Z_BASE - 0.6, zb = Z_MAG + 0.6, hx = 1.2, y = GANTRY_Y;
  const g = new THREE.Group();
  g.position.set(COVER_X, 0, 0);
  scene.add(g);
  for (const sx of [-1, 1]) {
    for (const z of [za, zb]) g.add(at(box(0.14, y, 0.14, frameMat), sx * hx, y / 2, z));
    g.add(at(box(0.16, 0.2, zb - za + 0.14, M.alu), sx * hx, y + 0.1, (za + zb) / 2));
  }
  for (const z of [za, zb]) g.add(at(box(2 * hx + 0.14, 0.14, 0.14, frameMat), 0, y + 0.07, z));
  const carriage = new THREE.Group();
  g.add(carriage);
  carriage.add(at(box(2 * hx + 0.2, 0.16, 0.3, M.blue), 0, y + 0.28, 0));
  carriage.add(at(box(0.3, 0.3, 0.3, M.aluDark), 0, y + 0.5, 0)); // vertical axis drive
  const mast = box(0.12, 1, 0.12, M.alu);
  carriage.add(mast);
  const head = new THREE.Group();
  carriage.add(head);
  head.add(at(box(1.5, 0.06, 0.08, M.aluDark), 0, 0.16, 0)); // cup bar along the cover
  head.add(at(box(0.08, 0.06, 0.24, M.aluDark), 0, 0.16, 0));
  for (const x of [-0.65, -0.22, 0.22, 0.65]) {
    head.add(at(cyl(0.008, 0.008, 0.1, M.alu, 8), x, 0.08, 0));
    head.add(at(cyl(0.035, 0.04, 0.03, M.rubber, 16), x, 0.015, 0));
  }
  head.add(at(box(0.1, 0.08, 0.12, M.blue), 0, 0.24, 0.1)); // vacuum generator
  shadowify(g);
  const setGantry = (z: number, cupY: number) => {
    carriage.position.z = z;
    head.position.y = cupY;
    const len = y + 0.2 - (cupY + 0.19);
    mast.scale.y = Math.max(0.05, len);
    mast.position.set(0, cupY + 0.19 + len / 2, 0);
  };
  return { group: g, head, setGantry };
}

/** Side guides and end stop of the cover magazine (covers queue along −z toward the box line). */
export function buildMagazineGuides(scene: THREE.Scene, M: Materials) {
  const g = new THREE.Group(), w = 2.0, z0 = Z_MAG - 0.2, len = MAG_Z0 - z0;
  for (const s of [-1, 1]) {
    g.add(at(box(0.04, 0.05, len, M.yellow), COVER_X + s * (w / 2 - 0.02), Y_BOX + 0.35, z0 + len / 2));
    for (let z = z0 + 0.1; z <= MAG_Z0; z += 1.0) g.add(at(box(0.04, 0.4, 0.04, M.alu), COVER_X + s * (w / 2 - 0.02), Y_BOX + 0.15, z));
  }
  g.add(at(box(w - 0.1, 0.5, 0.05, M.yellow), COVER_X, Y_BOX + 0.25, Z_MAG - 0.21)); // end stop
  shadowify(g);
  scene.add(g);
  return g;
}

/** Existing stations 5 to 10 along the box line, grey and not animated: they stay as they are in the plant. */
export function buildExisting(scene: THREE.Scene) {
  const ghost = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.1, roughness: 0.7, transparent: true, opacity: 0.6 });
  const g = new THREE.Group();
  scene.add(g);
  const zs = Z_BASE + BELT_BOX / 2 + 0.55; // operator side
  // 5 closing bench, 6 checking desk with a computer, 7 label printer
  g.add(at(box(1.2, 0.9, 0.7, ghost), EXIST_X0 + 0.4, 0.45, zs));
  g.add(at(box(1.0, 0.75, 0.6, ghost), EXIST_X0 + 1.9, 0.375, zs));
  g.add(at(box(0.5, 0.35, 0.05, ghost), EXIST_X0 + 1.9, 1.05, zs + 0.15));
  g.add(at(box(0.4, 1.2, 0.4, ghost), EXIST_X0 + 3.0, 0.6, zs + 0.1));
  // 8 strapping machine (arch around the line)
  const xa = EXIST_X0 + 4.3;
  for (const s of [-1, 1]) g.add(at(box(0.25, 2.2, 0.3, ghost), xa, 1.1, Z_BASE + s * (BELT_BOX / 2 + 0.2)));
  g.add(at(box(0.25, 0.25, BELT_BOX + 0.7, ghost), xa, 2.2, Z_BASE));
  // 9 palletising and 10 out to logistics: a pallet with boxes past the line end
  const px = BOX_END + 1.6;
  g.add(at(box(2.0, 0.14, 1.2, ghost), px, 0.07, Z_BASE));
  for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) g.add(at(box(1.9, 1.1, 0.34, ghost), px, 0.14 + 0.55 + k * 1.12, Z_BASE - 0.4 + i * 0.4));
  g.traverse(m => { if ((m as THREE.Mesh).isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return g;
}
