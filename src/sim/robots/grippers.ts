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
    g.add(at(cylA(0.008, 0.04, M.alu, 'z', 8), sx * 0.25, -hookD + sy * 0.12, 0.065));
    g.add(at(cylA(0.036, 0.03, M.rubber, 'z', 18), sx * 0.25, -hookD + sy * 0.12, cupZ - 0.015));
  }
  g.add(at(box(0.06, 0.05, 0.04, M.blue), 0, -0.1, -0.045)); // vacuum generator
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
