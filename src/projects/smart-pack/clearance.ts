// Smart Pack · collision check of station 1 over the whole cycle: nothing may touch.
//
// Robot parts: the JAKA Zu 50 as it is drawn (one capsule per visual part of every link), the hook with the VGP30, and
// the TV it carries as an oriented box. Checked against: its own arm (links that are not neighbours, the gripper and
// the carried TV), its pedestal (the carried TV), the test belt, the test pallets and the TVs on them, the bagging
// belt and the TVs on it, the bagger housing and its cabinet. Intended contact is left out: the cups on the TV being
// picked or just set down, and the TV leaving its pallet while it is lifted out of the guides.
import * as THREE from 'three';
import { capsuleGap, linkCapsules } from '../../sim/robots/collision';
import { gripperCaps } from '../transfer-flow/clearance';
import { BAGGER, BELT_PACK, BELT_TEST, LYING_Y, PACK_X0, ROBOT, SEAT_Y, SIZES, TABLE_X0, TEST_X0, TEST_X1, TV_T, Y_PACK, Y_TEST, Z_PACK, Z_TEST } from './config';
import type { TV } from './products';
import type { World } from './types';

const LINK = ['base', 'ombro', 'braço', 'antebraço', 'punho 1', 'punho 2', 'punho 3'];
interface Seg { a: THREE.Vector3; b: THREE.Vector3; r: number; name: string; link: number }
interface Obb { inv: THREE.Matrix4; box: THREE.Box3; name: string; tv?: TV; pallet?: object; pedestal?: boolean }

const _p = new THREE.Vector3(), _q = new THREE.Vector3();
const tvBox = (tv: TV) => {
  const [w, d] = SIZES[tv.inch];
  return new THREE.Box3(new THREE.Vector3(-w / 2, -TV_T / 2 - 0.045, -d / 2), new THREE.Vector3(w / 2, TV_T / 2, d / 2));
};
const tvObb = (tv: TV, name: string): Obb => { tv.obj.updateWorldMatrix(true, false); return { inv: tv.obj.matrixWorld.clone().invert(), box: tvBox(tv), name, tv }; };
const aabb = (name: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Obb =>
  ({ inv: new THREE.Matrix4(), box: new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)), name });

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
function boxBox(a: Obb, b: Obb, aM: THREE.Matrix4) {
  let min = Infinity;
  const { min: lo, max: hi } = a.box;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 2; j++) for (let k = 0; k <= 6; k++) {
    _q.set(lo.x + (hi.x - lo.x) * i / 8, lo.y + (hi.y - lo.y) * j / 2, lo.z + (hi.z - lo.z) * k / 6).applyMatrix4(aM).applyMatrix4(b.inv);
    const d = b.box.containsPoint(_q) ? -0.01 : b.box.distanceToPoint(_q);
    if (d < min) min = d;
  }
  return min;
}

type V3 = [number, number, number];
/** The hook with the VGP30, as the Transfer Flow checks it (bracket, post, plate with its housing, cup rows). */
const GRIP = gripperCaps();

export interface Clearance { min: number; at: string }

/** Smallest clearance at station 1 right now, and between what. `worst` keeps every pair below 5 cm. */
export function measureClearance(w: World, worst?: Map<string, number>): Clearance {
  let min = Infinity, at = '';
  const note = (d: number, what: string) => {
    if (d < min) { min = d; at = what; }
    if (worst && d < 0.05) worst.set(what, Math.min(worst.get(what) ?? Infinity, d));
  };
  const r = w.robot, inch = w.params.inch, h = SIZES[inch][1];
  const bx0 = BAGGER.x0, bx1 = BAGGER.x1, bz0 = Z_PACK - BAGGER.w / 2, bz1 = Z_PACK + BAGGER.w / 2;
  const env: Obb[] = [
    aabb('esteira de teste', TEST_X0, 0, Z_TEST - BELT_TEST / 2 - 0.04, TEST_X1, Y_TEST - 0.005, Z_TEST + BELT_TEST / 2 + 0.04),
    aabb('esteira ensacoladora', PACK_X0, 0, Z_PACK - BELT_PACK / 2, TABLE_X0, Y_PACK - 0.005, Z_PACK + BELT_PACK / 2),
    ...[-1, 1].map(s => aabb('lateral da esteira ensacoladora', PACK_X0, Y_PACK - 0.16, Z_PACK + s * (BELT_PACK / 2 + 0.03) - 0.01, TABLE_X0, Y_PACK + 0.04, Z_PACK + s * (BELT_PACK / 2 + 0.03) + 0.01)),
    aabb('cabine de ensacolamento', bx0, 0, bz0, bx1, BAGGER.h + 0.4, bz1),
    aabb('armário da ensacadora', (bx0 + bx1) / 2 + 0.4, 0, bz1 + 0.02, (bx0 + bx1) / 2 + 1.0, 1.6, bz1 + 0.32),
    { ...aabb('pedestal do robô', ROBOT.x - 0.17, 0, ROBOT.z - 0.17, ROBOT.x + 0.17, ROBOT.ped, ROBOT.z + 0.17), pedestal: true },
  ];
  // test pallets (one box per part of the fixture) and their TVs
  for (const pal of w.test.items) {
    pal.obj.updateWorldMatrix(true, true);
    pal.obj.traverse(m => {
      if (!(m as THREE.Mesh).isMesh || (pal.tv && isIn(m, pal.tv.obj))) return;
      env.push({ inv: new THREE.Matrix4(), box: new THREE.Box3().setFromObject(m), name: 'pallet de teste', pallet: pal });
    });
    if (pal.tv) env.push({ ...tvObb(pal.tv, 'TV no pallet de teste'), pallet: pal });
  }
  for (const it of w.pack.items) env.push(tvObb(it.tv, 'TV na esteira ensacoladora'));

  // the robot
  const state = `[${r.state} ${r.seq.length}]`;
  const segs: Seg[] = linkCapsules(r.arm, 0.01).map(c => ({ ...c, name: `robô ${state} · ${LINK[c.link]}` }));
  const m = r.arm.mount;
  m.updateWorldMatrix(true, false);
  const W = (v: V3) => new THREE.Vector3(...v).applyMatrix4(m.matrixWorld);
  for (const c of GRIP) segs.push({ a: W(c.a), b: W(c.b), r: c.r, name: `robô ${state} · garra`, link: 7 });
  const links = segs.filter(s => s.link <= 6), grip = segs.filter(s => s.link === 7);
  // the TV the cups are on (picking) or have just let go of (set down)
  const target = r.pallet?.tv ?? null, placed = r.lastPlaced;
  for (const o of env) {
    const touches = !!o.tv && (o.tv === target || o.tv === placed);
    for (const s of links) if (!(o.pedestal && s.link <= 1)) note(segBox(s, o), `${s.name} × ${o.name}`);
    if (!touches) for (const s of grip) note(segBox(s, o), `${s.name} × ${o.name}`);
  }
  if (r.carried) {
    const tvO = tvObb(r.carried, 'TV carregada');
    for (const s of links) note(segBox(s, tvO), `${s.name} × TV carregada`);
    // lifting out of the pallet: the TV slides up between the guides of the pallet it came from
    const y = r.carried.obj.getWorldPosition(_q).y;
    const lifting = y < Y_TEST + SEAT_Y + h / 2 + 0.33;
    // setting down: the TV within 2 cm of the bagging belt it is laid on
    const settingDown = y < Y_PACK + LYING_Y + 0.02;
    const cm = r.carried.obj.matrixWorld;
    for (const o of env) {
      if (lifting && o.pallet && o.pallet === r.lastPallet) continue;
      if (settingDown && o.name === 'esteira ensacoladora') continue;
      note(boxBox(tvO, o, cm), `TV carregada ${state} × ${o.name}`);
    }
  }
  // the arm against itself: links that are not neighbours, the gripper against base, shoulder, upper arm and forearm
  for (const s of segs) for (const t of segs) if (t.link - s.link >= 3 && (t.link < 7 || s.link <= 3)) note(capsuleGap(s, t), `${s.name} × ${t.name}`);
  return { min, at };
}

const isIn = (o: THREE.Object3D, root: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true; return false; };
