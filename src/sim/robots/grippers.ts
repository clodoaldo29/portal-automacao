// End effectors.
import * as THREE from 'three';
import { at, box, cyl, cylA, shadowify } from '../kit';
import type { Materials } from '../materials';

export interface HookGripperSpec {
  /** Flange → cup row, along the tool axis (local -y). */
  hookD: number;
  /** Bracket axis → cup face (cups face local +z). */
  cupZ: number;
}

/**
 * Hook vacuum gripper: a bracket runs hookD along the tool axis to a row of 4 cups that face sideways.
 * Lets a flat panel be picked lying down and placed standing with its front toward the robot.
 */
export function hookGripper(mount: THREE.Object3D, M: Materials, { hookD, cupZ }: HookGripperSpec) {
  const g = new THREE.Group();
  mount.add(g);
  g.add(at(cyl(0.05, 0.05, 0.05, M.aluDark, 20), 0, -0.025, 0));
  g.add(at(box(0.06, hookD + 0.1, 0.05, M.alu), 0, -(hookD + 0.1) / 2 - 0.04, 0)); // bracket
  g.add(at(box(0.56, 0.04, 0.04, M.alu), 0, -hookD, 0.035));
  for (const sx of [-1, 1]) g.add(at(box(0.04, 0.28, 0.04, M.alu), sx * 0.25, -hookD, 0.035));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    // cup stem from the bar to the cup (0.04 long, centred at 0.065 for cupZ = 0.1; longer for a longer standoff)
    g.add(at(cylA(0.008, cupZ - 0.06, M.alu, 'z', 8), sx * 0.25, -hookD + sy * 0.12, (0.045 + cupZ - 0.015) / 2));
    g.add(at(cylA(0.036, 0.03, M.rubber, 'z', 18), sx * 0.25, -hookD + sy * 0.12, cupZ - 0.015));
  }
  g.add(at(box(0.06, 0.05, 0.04, M.blue), 0, -0.1, -0.045)); // vacuum generator
  shadowify(g);
  return g;
}

/**
 * Hook with an OnRobot VGP30 vacuum plate (datasheet v1.5): the bracket runs hookD along the tool axis (local −y) to
 * a post that carries the plate, cups facing local +z, cup faces at cupZ. Plate 390 × 240 mm (long side along local x),
 * housing 310 × 155 mm, 20 cups Ø50 in rows of 4-2-4 | 4-2-4 (26 mm cups, 88.2 mm from the housing top to the cup
 * faces). The VGP30 makes its vacuum from compressed air: ~6.3 bar at the gripper for its 60 % maximum.
 */
export function hookVGP30(mount: THREE.Object3D, M: Materials, { hookD, cupZ }: HookGripperSpec) {
  const g = new THREE.Group();
  mount.add(g);
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.2, roughness: 0.55 });
  const housingMat = new THREE.MeshStandardMaterial({ color: 0xd9dcdf, metalness: 0.25, roughness: 0.35 });
  const qcMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, metalness: 0.1, roughness: 0.45 });
  g.add(at(cyl(0.05, 0.05, 0.05, M.aluDark, 20), 0, -0.025, 0));
  g.add(at(box(0.06, hookD - 0.01, 0.05, M.alu), 0, -(hookD - 0.01) / 2 - 0.04, 0)); // bracket
  const top = cupZ - 0.088; // housing top
  g.add(at(box(0.06, 0.06, top - 0.025 - 0.012, M.alu), 0, -hookD, (0.025 + top - 0.012) / 2)); // post down to the plate
  g.add(at(cylA(0.045, 0.012, qcMat, 'z', 20), 0, -hookD, top - 0.006)); // quick changer (blue)
  g.add(at(box(0.39, 0.24, 0.022, plateMat), 0, -hookD, cupZ - 0.037)); // plate (cup carrier)
  g.add(at(box(0.31, 0.155, 0.04, housingMat), 0, -hookD, top + 0.02)); // housing, channels A and B
  const rows: [number, number[]][] = [
    [0.1675, [-0.0925, -0.0385, 0.0385, 0.0925]], [0.1125, [-0.0655, 0.0655]], [0.0575, [-0.0925, -0.0385, 0.0385, 0.0925]],
  ];
  for (const sx of [-1, 1]) for (const [x, ys] of rows) for (const y of ys)
    g.add(at(cylA(0.025, 0.026, M.rubber, 'z', 16), sx * x, -hookD + y, cupZ - 0.013));
  shadowify(g);
  return g;
}

/** Vision head: camera body, lit lens with ring light. Returns the lens point (for the field-of-view beam). */
export function cameraHead(mount: THREE.Object3D, M: Materials) {
  const g = new THREE.Group();
  mount.add(g);
  g.add(at(cyl(0.045, 0.045, 0.05, M.aluDark, 18), 0, -0.025, 0));
  g.add(at(box(0.16, 0.1, 0.12, M.black), 0, -0.1, 0));
  g.add(at(cyl(0.035, 0.035, 0.03, new THREE.MeshStandardMaterial({ color: 0x0b1b33, metalness: 0.2, roughness: 0.2, emissive: 0x38bdf8, emissiveIntensity: 1.2 }), 18), 0, -0.165, 0));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.01, 8, 28), new THREE.MeshBasicMaterial({ color: 0xbfe9ff }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.165;
  g.add(ring);
  shadowify(g);
  const lens = new THREE.Object3D();
  lens.position.y = -0.18;
  g.add(lens);
  return lens;
}

export interface VacuumPlateSpec {
  /** Plate size along local x and z (m). */
  w: number;
  d: number;
  /** Flange → cup faces, along the tool axis (local −y). */
  drop: number;
  /** Cups along x and z. */
  nx?: number;
  nz?: number;
}

/**
 * Flat vacuum plate for trays, bags and boxes, held under the flange (tool pointing down).
 * Returns the grip point (centre of the cup faces): attach picked items to it.
 */
export function vacuumPlate(mount: THREE.Object3D, M: Materials, { w, d, drop, nx = 3, nz = 2 }: VacuumPlateSpec) {
  const g = new THREE.Group();
  mount.add(g);
  g.add(at(cyl(0.045, 0.045, 0.04, M.aluDark, 20), 0, -0.02, 0));
  g.add(at(box(0.06, drop - 0.06, 0.06, M.alu), 0, -(drop - 0.06) / 2 - 0.04, 0));
  g.add(at(box(w, 0.015, d, M.aluDark), 0, -drop + 0.035, 0));
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    const x = nx > 1 ? -w / 2 + 0.04 + (i * (w - 0.08)) / (nx - 1) : 0, z = nz > 1 ? -d / 2 + 0.035 + (k * (d - 0.07)) / (nz - 1) : 0;
    g.add(at(cyl(0.006, 0.006, 0.02, M.alu, 8), x, -drop + 0.018, z));
    g.add(at(cyl(0.018, 0.022, 0.012, M.rubber, 14), x, -drop + 0.006, z));
  }
  g.add(at(box(0.06, 0.04, 0.05, M.blue), 0.06, -0.06, 0)); // vacuum generator
  shadowify(g);
  const grip = new THREE.Object3D();
  grip.position.y = -drop;
  g.add(grip);
  return grip;
}
