// Clearance between a UR arm (and what it carries) and the equipment around it.
// The links are capsules between consecutive joint frames from the real kinematics; the end effector and the
// carried item are their bounding boxes; the equipment is a list of named boxes. Used by the cell tests to make
// sure the robot never touches anything during the whole cycle.
import * as THREE from 'three';
import type { Cobot } from './ur-arm';
import { urFK } from './ur-kinematics';

export interface Obstacle { name: string; box: THREE.Box3 }
/** Smallest gap, the obstacle it is to, and the part of the robot (link 1–6 or the tool box index). */
export interface Clearance { min: number; name: string; part: string }

/** Capsule radius of each segment (base → shoulder → … → tool flange), UR10e housings plus a safety margin. */
const RADII = [0.1, 0.09, 0.08, 0.07, 0.06, 0.055];

const _m = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

/** World positions of the joint frames 0..6 of the arm (base to tool0). */
export function jointPoints(arm: Cobot): THREE.Vector3[] {
  const ur = arm.ur;
  if (!ur) return [];
  return Array.from({ length: 7 }, (_, i) => { urFK(ur, ur.q, i).decompose(_m, _q, _s); return _m.clone(); });
}

/** Signed gap between a box and another box (negative: they overlap by that much on the thinnest axis). */
function boxGap(a: THREE.Box3, b: THREE.Box3) {
  const dx = Math.max(a.min.x - b.max.x, b.min.x - a.max.x);
  const dy = Math.max(a.min.y - b.max.y, b.min.y - a.max.y);
  const dz = Math.max(a.min.z - b.max.z, b.min.z - a.max.z);
  if (dx > 0 || dy > 0 || dz > 0) return Math.hypot(Math.max(0, dx), Math.max(0, dy), Math.max(0, dz));
  return Math.max(dx, dy, dz);
}

/**
 * Smallest clearance (m) between the arm links / tool boxes and the obstacles, and the obstacle it is to.
 * Negative means the robot is inside the obstacle.
 */
/** Tool boxes must come from up-to-date world matrices: call `object.updateWorldMatrix(true, true)` first (the arm
 *  joints only refresh their matrices when the scene renders). */
export function armClearance(arm: Cobot, obstacles: Obstacle[], tool: THREE.Box3[] = []): Clearance {
  let min = Infinity, name = '', part = '';
  const pts = jointPoints(arm);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], r = RADII[i], n = Math.max(2, Math.ceil(a.distanceTo(b) / 0.03));
    for (let k = 0; k <= n; k++) {
      _p.lerpVectors(a, b, k / n);
      for (const o of obstacles) {
        const d = o.box.containsPoint(_p) ? -0.01 : o.box.distanceToPoint(_p);
        if (d - r < min) { min = d - r; name = o.name; part = `elo ${i + 1}`; }
      }
    }
  }
  tool.forEach((t, ti) => { for (const o of obstacles) {
    const d = boxGap(t, o.box);
    if (d < min) { min = d; name = o.name; part = `ferramenta ${ti + 1}`; }
  } });
  return { min, name, part };
}

/** Box helper: centre (x, y, z) and size (w, h, d). */
export const obstacleBox = (name: string, x: number, y: number, z: number, w: number, h: number, d: number): Obstacle =>
  ({ name, box: new THREE.Box3(new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2), new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2)) });
