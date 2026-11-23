// Transfer Flow · collision check over the whole cycle: nothing may touch.
//
// Robot parts: the UR30 links as capsules (real kinematics), the hook gripper as capsules, and the TV it carries as an
// oriented box. Checked against: the robot's own links (the carried TV must not cross its own arm), the TVs lying on
// the jigs and standing on the test pallets, the jigs, the test pallets, the belts, the lift units, and the other
// robot with its TV. Intended contact is left out: the cups on the TV being picked or just placed, and the carried TV
// sliding into the pallet it is placed on.
import * as THREE from 'three';
import { jointPoints } from '../../sim/robots/collision';
import { BELT_ASM, BELT_TEST, HOOK_D, JIG_L, JIG_TOP, JIG_W, LINE_X0, LINE_X1, SIZES, TOP, TV_T, Z_ASM, Z_TEST } from './config';
import type { TV } from './products';
import type { Jig, Pallet, Transfer, World } from './types';

/** UR30 housings (bulkier than the UR10e) plus a small margin, base → flange. */
const RAD = [0.13, 0.12, 0.1, 0.085, 0.075, 0.07];

interface Seg { a: THREE.Vector3; b: THREE.Vector3; r: number; name: string }
interface Obb { inv: THREE.Matrix4; box: THREE.Box3; name: string; tv?: TV; pallet?: Pallet; jig?: Jig }

const _p = new THREE.Vector3(), _q = new THREE.Vector3();

/** TV box in its own frame: body (TV_T) and the back bump with the plate on local −y. */
const tvBox = (tv: TV) => {
  const [w, d] = SIZES[tv.inch];
  return new THREE.Box3(new THREE.Vector3(-w / 2, -TV_T / 2 - 0.045, -d / 2), new THREE.Vector3(w / 2, TV_T / 2, d / 2));
};
const tvObb = (tv: TV, name: string, pallet?: Pallet): Obb => {
  tv.obj.updateWorldMatrix(true, false);
  return { inv: tv.obj.matrixWorld.clone().invert(), box: tvBox(tv), name, tv, pallet };
};
const aabb = (name: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, pallet?: Pallet): Obb =>
  ({ inv: new THREE.Matrix4(), box: new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)), name, pallet });

/** Capsules of a transfer robot: links and the hook gripper (bracket, cross bar, cup bars). */
function robotSegs(r: Transfer, idx: number): Seg[] {
  const segs: Seg[] = [];
  const pts = jointPoints(r.arm);
  for (let i = 1; i + 1 < pts.length; i++) segs.push({ a: pts[i], b: pts[i + 1], r: RAD[i], name: `transfer ${idx + 1} [${r.state} ${r.seq.length}] · elo ${i + 1}` });
  const m = r.arm.mount;
  m.updateWorldMatrix(true, false);
  const W = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(m.matrixWorld);
  segs.push({ a: W(0, -0.04, 0), b: W(0, -HOOK_D + 0.02, 0), r: 0.04, name: `transfer ${idx + 1} · garra` });
  segs.push({ a: W(-0.28, -HOOK_D, 0.035), b: W(0.28, -HOOK_D, 0.035), r: 0.03, name: `transfer ${idx + 1} · garra` });
  for (const sx of [-0.25, 0.25]) segs.push({ a: W(sx, -HOOK_D - 0.14, 0.035), b: W(sx, -HOOK_D + 0.14, 0.035), r: 0.025, name: `transfer ${idx + 1} · garra` });
  return segs;
}

/** Signed distance from a capsule to a box (negative: inside). */
function segBox(s: Seg, o: Obb) {
  let min = Infinity;
  const n = Math.max(2, Math.ceil(s.a.distanceTo(s.b) / 0.02));
  for (let k = 0; k <= n; k++) {
    _p.lerpVectors(s.a, s.b, k / n).applyMatrix4(o.inv);
    const d = o.box.containsPoint(_p) ? -0.01 : o.box.distanceToPoint(_p);
    if (d - s.r < min) min = d - s.r;
  }
  return min;
}
/** Distance between the boxes of two TVs (sampled over the corners and faces of the first). */
function boxBox(a: Obb, b: Obb, aM: THREE.Matrix4) {
  let min = Infinity;
  const { min: lo, max: hi } = a.box;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 2; j++) for (let k = 0; k <= 4; k++) {
    _q.set(lo.x + (hi.x - lo.x) * i / 4, lo.y + (hi.y - lo.y) * j / 2, lo.z + (hi.z - lo.z) * k / 4).applyMatrix4(aM).applyMatrix4(b.inv);
    const d = b.box.containsPoint(_q) ? -0.01 : b.box.distanceToPoint(_q);
    if (d < min) min = d;
  }
  return min;
}

export interface Clearance { min: number; at: string }

/** Smallest clearance in the cell right now, and between what. `worst` (optional) keeps every pair below 5 cm. */
export function measureClearance(w: World, worst?: Map<string, number>): Clearance {
  let min = Infinity, at = '';
  const note = (d: number, what: string) => {
    if (d < min) { min = d; at = what; }
    if (worst && d < 0.05) { const k = what.replace(/ \d+\]/g, ']'); worst.set(k, Math.min(worst.get(k) ?? Infinity, d)); }
  };

  // environment: belts (up to the roller top), lift units, jigs and their TVs, test pallets and their TVs
  const env: Obb[] = [
    aabb('esteira de montagem', LINE_X0, 0, Z_ASM - BELT_ASM / 2 - 0.04, LINE_X1, TOP - 0.005, Z_ASM + BELT_ASM / 2 + 0.04),
    aabb('esteira de teste', w.testX0, 0, Z_TEST - BELT_TEST / 2 - 0.04, LINE_X1, TOP - 0.005, Z_TEST + BELT_TEST / 2 + 0.04),
  ];
  for (const z of [Z_ASM, Z_TEST]) for (const x of [(z === Z_TEST ? w.testX0 : LINE_X0) - 0.15, LINE_X1 + 0.15]) env.push(aabb('elevador', x - 1.3, 0, z - 0.85, x + 1.3, 2.4, z + 0.85));
  for (const j of w.asm.items) {
    const p = j.obj.position;
    env.push({ ...aabb('gabarito', p.x - JIG_L / 2, p.y, p.z - JIG_W / 2, p.x + JIG_L / 2, p.y + JIG_TOP, p.z + JIG_W / 2), jig: j });
    j.tvs.forEach(tv => { if (tv) env.push({ ...tvObb(tv, 'TV no gabarito'), jig: j }); });
  }
  // test pallets: one box per part of the fixture (frame, base rail, lips, side guides …), not one box around it all,
  // or the tall side guides would wrap the whole pallet
  for (const pal of w.test.items) {
    pal.obj.updateWorldMatrix(true, true);
    for (const c of pal.obj.children) {
      if (pal.tvs.some(tv => tv.obj === c)) continue;
      c.traverse(m => {
        if (!(m as THREE.Mesh).isMesh) return;
        env.push({ inv: new THREE.Matrix4(), box: new THREE.Box3().setFromObject(m), name: 'pallet de teste', pallet: pal });
      });
    }
    pal.tvs.forEach(tv => env.push(tvObb(tv, 'TV no pallet de teste', pal)));
  }

  const robots = w.robots.map((r, i) => {
    const segs = robotSegs(r, i);
    const carried = r.carried ? tvObb(r.carried, `TV carregada pelo transfer ${i + 1}`) : null;
    // the TV the cups are on (picking) or have just let go of (placed), and the pallet the TV is going into
    const job = r.job, target = r.state === 'pick' && job ? job.tvs.find(Boolean) ?? null : null;
    const placed = r.leaving?.tvs[r.leaving.tvs.length - 1] ?? null;
    const dock = r.pallet ?? r.leaving;
    return { r, i, segs, carried, target, placed, dock };
  });

  for (const R of robots) {
    const links = R.segs.filter(s => s.name.includes('elo')), grip = R.segs.filter(s => s.name.includes('garra'));
    for (const o of env) {
      const touchesTarget = !!o.tv && (o.tv === R.target || o.tv === R.placed);
      for (const s of links) note(segBox(s, o), `${s.name} × ${o.name}`);
      if (!touchesTarget) for (const s of grip) note(segBox(s, o), `${s.name} × ${o.name}`);
    }
    if (R.carried) {
      // the carried TV against its own arm (wrist links hold the gripper: from the forearm back) …
      for (const s of links.slice(0, 4)) note(segBox(s, R.carried), `${s.name} × ${R.carried.name}`);
      // … and against everything around, except the pallet it is sliding into
      // (the jig it was lying on is only left out at the lift-off, while the TV is still within 1 cm of the foam)
      const cm = R.r.carried!.obj.matrixWorld;
      const liftOff = R.r.state === 'pick' && R.r.carried!.obj.getWorldPosition(_q).y < (R.r.job?.obj.position.y ?? 0) + JIG_TOP + TV_T / 2 + 0.01;
      for (const o of env) {
        if (R.dock && o.pallet === R.dock) continue;
        if (liftOff && o.name === 'gabarito' && o.jig === R.r.job) continue;
        note(boxBox(R.carried, o, cm), `${R.carried.name} [${R.r.state} ${R.r.seq.length}] × ${o.name}`);
      }
    }
  }
  // the two robots and their TVs
  if (robots.length === 2) {
    const [A, B] = robots;
    for (const s of A.segs) {
      for (const t of B.segs) note(segSeg(s, t), `${s.name} × ${t.name}`);
      if (B.carried) note(segBox(s, B.carried), `${s.name} × ${B.carried.name}`);
    }
    if (A.carried) {
      for (const t of B.segs) note(segBox(t, A.carried), `${t.name} × ${A.carried.name}`);
      if (B.carried) note(boxBox(A.carried, B.carried, A.r.carried!.obj.matrixWorld), `${A.carried.name} × ${B.carried.name}`);
    }
  }
  return { min, at };
}

const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _rr = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();
function segSeg(s: Seg, t: Seg) {
  _d1.subVectors(s.b, s.a); _d2.subVectors(t.b, t.a); _rr.subVectors(s.a, t.a);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_rr), c = _d1.dot(_rr), b = _d1.dot(_d2), den = a * e - b * b;
  let u = den > 1e-12 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
  let v = e > 1e-12 ? (b * u + f) / e : 0;
  if (v < 0) { v = 0; u = a > 1e-12 ? THREE.MathUtils.clamp(-c / a, 0, 1) : 0; } else if (v > 1) { v = 1; u = a > 1e-12 ? THREE.MathUtils.clamp((b - c) / a, 0, 1) : 0; }
  _c1.copy(s.a).addScaledVector(_d1, u); _c2.copy(t.a).addScaledVector(_d2, v);
  return _c1.distanceTo(_c2) - s.r - t.r;
}
