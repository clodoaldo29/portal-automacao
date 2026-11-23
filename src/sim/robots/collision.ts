// Clearance between a UR arm (and what it carries) and the equipment around it.
// The links are capsules between consecutive joint frames from the real kinematics; the end effector and the
// carried item are their bounding boxes; the equipment is a list of named boxes. Used by the cell tests to make
// sure the robot never touches anything during the whole cycle.
import * as THREE from 'three';
import type { Cobot } from './ur-arm';
import { urFK } from './ur-kinematics';

/** A named box. With `inv`, the box is in the obstacle's own frame and `inv` takes world points into it (rotated boxes). */
export interface Obstacle { name: string; box: THREE.Box3; inv?: THREE.Matrix4 }
/** Smallest gap, the obstacle it is to, and the part of the robot (link 1–6 or the tool box index). */
export interface Clearance { min: number; name: string; part: string }

/** Capsule radius of each segment (base → shoulder → … → tool flange), UR10e housings plus a safety margin. */
const RADII = [0.1, 0.09, 0.08, 0.07, 0.06, 0.055];

const _m = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _l = new THREE.Vector3();

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
        const q = o.inv ? _l.copy(_p).applyMatrix4(o.inv) : _p;
        const d = o.box.containsPoint(q) ? -0.01 : o.box.distanceToPoint(q);
        if (d - r < min) { min = d - r; name = o.name; part = `elo ${i + 1}`; }
      }
    }
  }
  tool.forEach((t, ti) => { for (const o of obstacles) {
    const d = boxGap(t, (o as Obstacle & { world?: THREE.Box3 }).world ?? o.box);
    if (d < min) { min = d; name = o.name; part = `ferramenta ${ti + 1}`; }
  } });
  return { min, name, part };
}

/** A capsule in world space: segment a–b with radius r, and the link it belongs to (0 base … 6 wrist 3). */
export interface Capsule { a: THREE.Vector3; b: THREE.Vector3; r: number; link: number }

/**
 * The arm as it is drawn: one capsule per visual part of every link (joint housings, caps, the link tubes), placed
 * with the link frames. Unlike the line between joint origins, this follows the real geometry — the UR upper arm and
 * forearm tubes run up to ~26 cm to the side of that line. `margin` is added to every radius.
 */
export function linkCapsules(arm: Cobot, margin = 0.01): Capsule[] {
  const ur = arm.ur;
  if (!ur) return [];
  const out: Capsule[] = [];
  ur.model.parts.forEach((parts, link) => {
    const node = ur.visNodes[link];
    if (!node) return;
    node.updateWorldMatrix(true, false);
    for (const [, axis, r, a, b, u, v] of parts) {
      const p = axis === 'z' ? [new THREE.Vector3(u, v, a), new THREE.Vector3(u, v, b)]
        : axis === 'x' ? [new THREE.Vector3(a, u, v), new THREE.Vector3(b, u, v)]
          : [new THREE.Vector3(u, a, v), new THREE.Vector3(u, b, v)];
      p.forEach(q => q.applyMatrix4(node.matrixWorld));
      out.push({ a: p[0], b: p[1], r: r * ur.model.S + margin, link });
    }
  });
  return out;
}

/** Signed gap between a capsule and an obstacle box (negative: inside). */
export function capsuleBoxGap(c: { a: THREE.Vector3; b: THREE.Vector3; r: number }, o: Obstacle) {
  let min = Infinity;
  const n = Math.max(2, Math.ceil(c.a.distanceTo(c.b) / 0.02));
  for (let k = 0; k <= n; k++) {
    _p.lerpVectors(c.a, c.b, k / n);
    const q = o.inv ? _l.copy(_p).applyMatrix4(o.inv) : _p;
    const d = o.box.containsPoint(q) ? -0.01 : o.box.distanceToPoint(q);
    if (d - c.r < min) min = d - c.r;
  }
  return min;
}

const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3(), _sr = new THREE.Vector3(), _sc1 = new THREE.Vector3(), _sc2 = new THREE.Vector3();
/** Gap between two capsules (negative: they overlap). */
export function capsuleGap(s: { a: THREE.Vector3; b: THREE.Vector3; r: number }, t: { a: THREE.Vector3; b: THREE.Vector3; r: number }) {
  _s1.subVectors(s.b, s.a); _s2.subVectors(t.b, t.a); _sr.subVectors(s.a, t.a);
  const a = _s1.dot(_s1), e = _s2.dot(_s2), f = _s2.dot(_sr), c = _s1.dot(_sr), b = _s1.dot(_s2), den = a * e - b * b;
  let u = den > 1e-12 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
  let v = e > 1e-12 ? (b * u + f) / e : 0;
  if (v < 0) { v = 0; u = a > 1e-12 ? THREE.MathUtils.clamp(-c / a, 0, 1) : 0; } else if (v > 1) { v = 1; u = a > 1e-12 ? THREE.MathUtils.clamp((b - c) / a, 0, 1) : 0; }
  _sc1.copy(s.a).addScaledVector(_s1, u); _sc2.copy(t.a).addScaledVector(_s2, v);
  return _sc1.distanceTo(_sc2) - s.r - t.r;
}

/** Box helper: centre (x, y, z) and size (w, h, d). */
export const obstacleBox = (name: string, x: number, y: number, z: number, w: number, h: number, d: number): Obstacle =>
  ({ name, box: new THREE.Box3(new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2), new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2)) });

/** Box of size (w, h, d) centred at (x, y, z) and turned by `yaw` about the vertical axis (links only: tool boxes ignore the turn). */
export function orientedObstacle(name: string, x: number, y: number, z: number, w: number, h: number, d: number, yaw: number): Obstacle {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
  const box = new THREE.Box3(new THREE.Vector3(-w / 2, -h / 2, -d / 2), new THREE.Vector3(w / 2, h / 2, d / 2));
  // tool boxes are compared with the world box that contains the turned one
  return { name, box, inv: m.clone().invert(), world: box.clone().applyMatrix4(m) } as Obstacle & { world: THREE.Box3 };
}
