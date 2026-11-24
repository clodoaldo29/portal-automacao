// Transfer Flow · collision check over the whole cycle: nothing may touch.
//
// Robot parts: the UR30 as it is drawn (one capsule per visual part of every link: housings, caps and the link tubes,
// which run well to the side of the joint line), the hook gripper, and the TV it carries as an oriented box. Checked
// against: the robot's own arm and pedestal (the carried TV must not touch them), the other robot with its pedestal
// and TV, the TVs on the jigs and test pallets, the jigs, the test pallets, the belts, the lift units; and the
// inspection UR10e against the jigs and their TVs. Intended contact is left out: the cups on the TV being picked or
// just placed, the carried TV sliding into its pallet, and each arm's base on its own pedestal.
import * as THREE from 'three';
import { capsuleGap, linkCapsules, type Capsule } from '../../sim/robots/collision';
import { BELT_ASM, BELT_TEST, JIG_L, JIG_TOP, JIG_W, LINE_X0, LINE_X1, SIZES, TOP, TRANSFER_PED, TV_T, CUP_Z, HOOK_D, Z_ASM, Z_TEST } from './config';
import type { TV } from './products';
import type { Jig, Pallet, Transfer, World } from './types';

const LINK = ['base', 'ombro', 'braço', 'antebraço', 'punho 1', 'punho 2', 'punho 3'];

interface Seg { a: THREE.Vector3; b: THREE.Vector3; r: number; name: string; link: number }
interface Obb { inv: THREE.Matrix4; box: THREE.Box3; name: string; tv?: TV; pallet?: Pallet; jig?: Jig; pedestal?: number }

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
const aabb = (name: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Obb =>
  ({ inv: new THREE.Matrix4(), box: new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)), name });

const label = (r: Transfer, idx: number) => `transfer ${idx + 1} [${r.state} ${r.seq.length}]`;

type V3 = [number, number, number];
/** Hook gripper in the flange frame (tool axis local −y): the bracket (first), the cross bar, the cup bars and the cup
 *  stems (cups facing local +z). */
export const gripperCaps = (): { a: V3; b: V3; r: number }[] => [
  { a: [0, -0.04, 0], b: [0, -HOOK_D + 0.02, 0], r: 0.04 },
  { a: [-0.28, -HOOK_D, 0.035], b: [0.28, -HOOK_D, 0.035], r: 0.03 },
  ...[-0.25, 0.25].map(sx => ({ a: [sx, -HOOK_D - 0.14, 0.035] as V3, b: [sx, -HOOK_D + 0.14, 0.035] as V3, r: 0.025 })),
  ...[-0.25, 0.25].flatMap(sx => [-0.12, 0.12].map(sy => ({ a: [sx, -HOOK_D + sy, 0.05] as V3, b: [sx, -HOOK_D + sy, CUP_Z - 0.03] as V3, r: 0.02 }))),
];

/** The arm as drawn, and the hook gripper. */
export function robotSegs(r: Transfer, idx: number): Seg[] {
  const segs: Seg[] = linkCapsules(r.arm, 0.01).map((c: Capsule) => ({ ...c, name: `${label(r, idx)} · ${LINK[c.link]}` }));
  const m = r.arm.mount;
  m.updateWorldMatrix(true, false);
  const W = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(m.matrixWorld);
  const g = (a: THREE.Vector3, b: THREE.Vector3, rr: number) => segs.push({ a, b, r: rr, name: `${label(r, idx)} · garra`, link: 7 });
  for (const c of gripperCaps()) g(W(...c.a), W(...c.b), c.r);
  return segs;
}

/** Signed distance from a capsule to a box (negative: inside). */
function segBox(s: { a: THREE.Vector3; b: THREE.Vector3; r: number }, o: Obb) {
  let min = Infinity;
  const n = Math.max(2, Math.ceil(s.a.distanceTo(s.b) / 0.02));
  for (let k = 0; k <= n; k++) {
    _p.lerpVectors(s.a, s.b, k / n).applyMatrix4(o.inv);
    const d = o.box.containsPoint(_p) ? -0.01 : o.box.distanceToPoint(_p);
    if (d - s.r < min) min = d - s.r;
  }
  return min;
}
/** Distance between two boxes (sampled over the corners, edges and faces of the first). */
function boxBox(a: Obb, b: Obb, aM: THREE.Matrix4) {
  let min = Infinity;
  const { min: lo, max: hi } = a.box;
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 2; j++) for (let k = 0; k <= 6; k++) {
    _q.set(lo.x + (hi.x - lo.x) * i / 6, lo.y + (hi.y - lo.y) * j / 2, lo.z + (hi.z - lo.z) * k / 6).applyMatrix4(aM).applyMatrix4(b.inv);
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

  // environment: belts (up to the roller top), lift units, the transfer pedestals, jigs and their TVs, test pallets and
  // their TVs
  const env: Obb[] = [
    aabb('esteira de montagem', LINE_X0, 0, Z_ASM - BELT_ASM / 2 - 0.04, LINE_X1, TOP - 0.005, Z_ASM + BELT_ASM / 2 + 0.04),
    aabb('esteira de teste', w.testX0, 0, Z_TEST - BELT_TEST / 2 - 0.04, LINE_X1, TOP - 0.005, Z_TEST + BELT_TEST / 2 + 0.04),
  ];
  for (const z of [Z_ASM, Z_TEST]) for (const x of [(z === Z_TEST ? w.testX0 : LINE_X0) - 0.15, LINE_X1 + 0.15]) env.push(aabb('elevador', x - 1.3, 0, z - 0.85, x + 1.3, 2.4, z + 0.85));
  w.robots.forEach((r, i) => {
    const b = r.arm.root.position;
    env.push({ ...aabb(`pedestal do transfer ${i + 1}`, b.x - 0.17, 0, b.z - 0.17, b.x + 0.17, TRANSFER_PED, b.z + 0.17), pedestal: i });
  });
  for (const j of w.asm.items) {
    const p = j.obj.position;
    env.push({ ...aabb('gabarito', p.x - JIG_L / 2, p.y, p.z - JIG_W / 2, p.x + JIG_L / 2, p.y + JIG_TOP, p.z + JIG_W / 2), jig: j });
    j.tvs.forEach(tv => { if (tv) env.push({ ...tvObb(tv, 'TV no gabarito'), jig: j }); });
  }
  // test pallets: one box per part of the fixture (frame, base rail, lips, side guides …)
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
    const links = R.segs.filter(s => s.link <= 6), grip = R.segs.filter(s => s.link === 7);
    for (const o of env) {
      const own = o.pedestal === R.i;
      const touchesTarget = !!o.tv && (o.tv === R.target || o.tv === R.placed);
      for (const s of links) if (!(own && s.link <= 1)) note(segBox(s, o), `${s.name} × ${o.name}`);
      if (!touchesTarget) for (const s of grip) note(segBox(s, o), `${s.name} × ${o.name}`);
    }
    if (R.carried) {
      // the carried TV against its own arm …
      for (const s of links) note(segBox(s, R.carried), `${s.name} × ${R.carried.name}`);
      // … and against everything around (its own pedestal too), except the pallet it is sliding into; the jig it was
      // lying on only at the lift-off, while the TV is still within 1 cm of the foam
      const cm = R.r.carried!.obj.matrixWorld;
      const liftOff = R.r.state === 'pick' && R.r.carried!.obj.getWorldPosition(_q).y < (R.r.job?.obj.position.y ?? 0) + JIG_TOP + TV_T / 2 + 0.01;
      for (const o of env) {
        if (R.dock && o.pallet === R.dock) continue;
        if (liftOff && o.name === 'gabarito' && o.jig === R.r.job) continue;
        note(boxBox(R.carried, o, cm), `${R.carried.name} [${R.r.state} ${R.r.seq.length}] × ${o.name}`);
      }
    }
  }
  // each arm against itself: links that are not neighbours, and the gripper against the base, shoulder and upper arm
  for (const R of robots) for (const s of R.segs) for (const t of R.segs) {
    if (t.link - s.link >= 3 && (t.link < 7 || s.link <= 2)) note(capsuleGap(s, t), `${s.name} × ${t.name}`);
  }
  // the two robots and their TVs
  if (robots.length === 2) {
    const [A, B] = robots;
    for (const s of A.segs) {
      for (const t of B.segs) note(capsuleGap(s, t), `${s.name} × ${t.name}`);
      if (B.carried) note(segBox(s, B.carried), `${s.name} × ${B.carried.name}`);
    }
    if (A.carried) {
      for (const t of B.segs) note(segBox(t, A.carried), `${t.name} × ${A.carried.name}`);
      if (B.carried) note(boxBox(A.carried, B.carried, A.r.carried!.obj.matrixWorld), `${A.carried.name} × ${B.carried.name}`);
    }
  }
  // the inspection UR10e against the jigs and the TVs on them
  for (const s of linkCapsules(w.insp.arm, 0.01)) {
    if (s.link <= 1) continue; // on its own pedestal
    for (const o of env) if (o.jig) note(segBox(s, o), `inspeção · ${LINK[s.link]} × ${o.name}`);
  }
  return { min, at };
}
