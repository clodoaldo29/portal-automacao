// The plant in 3D: area floors in the plan's legend colours, walls (cut away on the camera side), translucent
// clean rooms, floor tape and flow lanes, the 219 equipment and the WIP shelves. Static geometry is merged.
// Status caps and beacons (one instanced mesh each) show what every machine is doing.
import * as THREE from 'three';
import { createBeacons } from '../../sim/beacons';
import { at, box, std } from '../../sim/kit';
import type { LabelDef } from '../../sim/labels';
import { mergeStatic } from '../../sim/merge';
import { AREAS, CORRIDORS, DOCK_IN, EQUIPMENT, LANES, PLANT, RACKS, ZONES, areaById, type Equip, type Zone } from './layout';
import { beaconLocal, buildEquip, createEquipMaterials, facesNorth } from './machines';

/** Plan (x, z) → world X, Z (plant centred on the origin). */
export const W = (x: number, z: number): [number, number] => [x - PLANT.w / 2, z - PLANT.d / 2];

/** World position of a point given in a machine's local frame (front towards its corridor). */
export function equipPoint(e: Equip, lx: number, ly: number, lz: number): THREE.Vector3 {
  const [X, Z] = W(e.x, e.z), s = facesNorth(e) ? -1 : 1;
  return new THREE.Vector3(X + s * lx, ly, Z + s * lz);
}

/** A WIP shelf: lots fill its levels left to right, then pile up on top (a tall pile = a long queue). */
export interface Shelf { x: number; z: number; w: number; levels: number[] }
export function shelfSlot(sh: Shelf, i: number): THREE.Vector3 {
  const per = Math.max(1, Math.floor(sh.w / 0.5)), lvl = Math.floor(i / per), k = i % per;
  const [X, Z] = W(sh.x, sh.z);
  const top = sh.levels[sh.levels.length - 1];
  const y = lvl < sh.levels.length ? sh.levels[lvl] : top + 0.3 * (lvl - sh.levels.length + 1);
  return new THREE.Vector3(X - sh.w / 2 + 0.25 + k * ((sh.w - 0.5) / Math.max(1, per - 1)), y + 0.15, Z);
}

const STATUS_EQUIP = (e: Equip) => e.counted && !!e.access;

export interface PlantOptions {
  /** Leave these pieces of equipment out (e.g. where a proposed cell replaces them). */
  exclude?: (e: Equip) => boolean;
  /** Status caps and beacons on the machines (default on). */
  status?: boolean;
}

export function buildPlant(scene: THREE.Scene, opts: PlantOptions = {}) {
  const M = createEquipMaterials();
  const root = new THREE.Group();
  scene.add(root);
  const zoneOf = (area: string): Zone => areaById(area).zone;

  // ---- floors: area tints with a border in the legend colour, corridor tape, flow lanes ----
  const flat = (w: number, d: number, mat: THREE.Material, x: number, z: number, y: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    const [X, Z] = W(x, z);
    m.position.set(X, y, Z);
    m.userData.noShadow = true;
    m.receiveShadow = true;
    root.add(m);
    return m;
  };
  const byZone = <T,>(f: (z: Zone) => T) => Object.fromEntries((Object.keys(ZONES) as Zone[]).map(z => [z, f(z)])) as Record<Zone, T>;
  const tintMat = byZone(z => new THREE.MeshLambertMaterial({ color: ZONES[z].tint, polygonOffset: true, polygonOffsetFactor: -1 }));
  const edgeMat = byZone(z => new THREE.MeshBasicMaterial({ color: ZONES[z].strong }));
  for (const a of AREAS) {
    const cx = (a.x0 + a.x1) / 2, cz = (a.z0 + a.z1) / 2, w = a.x1 - a.x0, d = a.z1 - a.z0;
    flat(w - 0.1, d - 0.1, tintMat[a.zone], cx, cz, 0.006);
    const e = edgeMat[a.zone], t = 0.12;
    flat(w - 0.1, t, e, cx, a.z0 + 0.11, 0.009); flat(w - 0.1, t, e, cx, a.z1 - 0.11, 0.009);
    flat(t, d - 0.1, e, a.x0 + 0.11, cz, 0.009); flat(t, d - 0.1, e, a.x1 - 0.11, cz, 0.009);
  }
  const tape = new THREE.MeshBasicMaterial({ color: 0xf2c230 });
  for (const c of CORRIDORS) for (const z of [c.z0 + 0.3, c.z1 - 0.3]) flat(c.x1 - c.x0 - 0.6, 0.12, tape, (c.x0 + c.x1) / 2, z, 0.01);
  for (const z of [33, 37, 60, 63]) flat(119.4, 0.1, tape, 60, z, 0.011);
  const flowMat = new THREE.MeshBasicMaterial({ color: 0xe07b1f });
  for (const l of LANES) {
    if (l.door) continue;
    const len = Math.hypot(l.b.x - l.a.x, l.b.z - l.a.z);
    for (let s = 0; s < len; s += 2.4) {
      const u = Math.min(len, s + 1.4), mx = (s + u) / 2 / len;
      const x = l.a.x + (l.b.x - l.a.x) * mx, z = l.a.z + (l.b.z - l.a.z) * mx;
      const m = flat(u - s, 0.28, flowMat, x, z, 0.013);
      m.rotation.z = -Math.atan2(l.b.z - l.a.z, l.b.x - l.a.x);
    }
  }
  // outside apron for the perimeter route of the plan (hypothesis)
  flat(5.5, 37, std(0x9aa3ad, 0, 0.8), -2.75, 64.2, 0.004);

  // ---- walls ----
  const wallMat = std(0xe3e7eb, 0.05, 0.85), lowMat = std(0xc9cfd6, 0.1, 0.7);
  const panelMat = std(0xf2f7fb, 0.05, 0.1, { transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
  const railMat = std(0xb9c1ca, 0.7, 0.3);
  /** Straight wall along x (horizontal) or z, with openings: [centre, width]. */
  function wall(x0: number, z0: number, x1: number, z1: number, h: number, mat: THREE.Material, gaps: [number, number][] = [], glass = false) {
    const alongX = Math.abs(z1 - z0) < 1e-6, a0 = alongX ? x0 : z0, a1 = alongX ? x1 : z1;
    const cuts = [...gaps].sort((p, q) => p[0] - q[0]);
    let s = a0;
    const seg = (u: number, v: number) => {
      if (v - u < 0.05) return;
      const mid = (u + v) / 2, len = v - u;
      const [X, Z] = alongX ? W(mid, z0) : W(x0, mid);
      if (glass) {
        root.add(at(box(alongX ? len : 0.06, h, alongX ? 0.06 : len, mat), X, h / 2, Z));
        root.add(at(box(alongX ? len : 0.1, 0.1, alongX ? 0.1 : len, railMat), X, h, Z));
        root.add(at(box(alongX ? len : 0.1, 0.1, alongX ? 0.1 : len, railMat), X, 0.05, Z));
        for (let p = u; p <= v + 1e-6; p += Math.min(2.5, len)) {
          const [PX, PZ] = alongX ? W(p, z0) : W(x0, p);
          root.add(at(box(0.08, h, 0.08, railMat), PX, h / 2, PZ));
        }
      } else root.add(at(box(alongX ? len : 0.25, h, alongX ? 0.25 : len, mat), X, h / 2, Z));
    };
    for (const [c, w] of cuts) { seg(s, c - w / 2); s = c + w / 2; }
    seg(s, a1);
  }
  // exterior: north and west full height, south and east cut low so the cameras see in
  wall(0, 0, 120, 0, 7, wallMat);
  wall(0, 0, 0, 90, 7, wallMat, [[47.5, 3], [80.8, 3]]);
  wall(0, 90, 120, 90, 1.1, lowMat, [[12, 4.5], [31, 4.5]]);
  wall(120, 0, 120, 50, 1.1, lowMat);
  wall(120, 75, 120, 90, 1.1, lowMat);
  const winMat = new THREE.MeshBasicMaterial({ color: 0xf4f8fb });
  for (let x = 6; x < 120; x += 12) { const [X, Z] = W(x, 0.14); root.add(at(box(8, 1.4, 0.04, winMat), X, 5.6, Z)); }
  // clean rooms ISO 6 / ISO 7: translucent panels, pass boxes at the lanes
  wall(0, 50, 120, 50, 3.2, panelMat, [[110, 2.4]], true);
  wall(0, 75, 120, 75, 3.2, panelMat, [[63.3, 2.4]], true);
  wall(80, 50, 80, 75, 3.2, panelMat, [[61.5, 2.4]], true);
  wall(120, 50, 120, 75, 3.2, panelMat, [], true);
  // utilities block, workshop and admin partitions
  wall(0, 20, 80, 20, 3.5, wallMat, [[5, 2.5], [45, 2.5]]);
  wall(80, 0, 80, 20, 3.5, wallMat, [[10, 2.5]]);
  wall(80, 20, 120, 20, 2.6, panelMat, [[90, 2.4], [110, 2.4]], true);
  wall(95, 75, 95, 90, 2.6, panelMat, [[82.5, 2]], true);
  // pass-box frames at the clean-room openings
  for (const [x, z, alongX] of [[110, 50, true], [63.3, 75, true], [80, 61.5, false]] as [number, number, boolean][]) {
    const [X, Z] = W(x, z);
    for (const s of [-1.25, 1.25]) root.add(at(box(0.18, 3.2, 0.18, M.zone.iso6), X + (alongX ? s : 0), 1.6, Z + (alongX ? 0 : s)));
    root.add(at(box(alongX ? 2.7 : 0.25, 0.3, alongX ? 0.25 : 2.7, M.zone.iso6), X, 3.05, Z));
  }

  // ---- equipment ----
  const equipList = opts.exclude ? EQUIPMENT.filter(e => !opts.exclude!(e)) : EQUIPMENT;
  for (const e of equipList) {
    const g = buildEquip(e, M, zoneOf(e.area));
    const [X, Z] = W(e.x, e.z);
    g.position.set(X, 0, Z);
    if (facesNorth(e)) g.rotation.y = Math.PI;
    root.add(g);
  }

  // ---- WIP shelves where lots queue (L01, L04 and E01 use the racks already on the plan) ----
  const shelves: Record<string, Shelf> = {};
  for (const [area, p] of Object.entries(RACKS)) {
    if (area === 'L01') { shelves[area] = { x: p.x, z: p.z, w: 2.0, levels: [0.25, 0.95, 1.6] }; continue; }
    if (area === 'L04') { shelves[area] = { x: p.x, z: p.z, w: 2.0, levels: [0.12, 0.85, 1.6] }; continue; }
    if (area === 'E01') { shelves[area] = { x: p.x, z: p.z, w: 3.0, levels: [0.12, 0.72, 1.32, 1.92] }; continue; }
    const sh: Shelf = { x: p.x, z: p.z, w: 1.6, levels: [0.3, 0.75, 1.2] };
    shelves[area] = sh;
    const [X, Z] = W(p.x, p.z), zone = zoneOf(area);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) root.add(at(box(0.04, 1.4, 0.04, M.steel), X + sx * 0.78, 0.7, Z + sz * 0.28));
    for (const y of sh.levels) root.add(at(box(1.6, 0.03, 0.6, M.body2), X, y, Z));
    root.add(at(box(1.6, 0.06, 0.03, M.zone[zone]), X, 1.4, Z + 0.3));
  }
  // receiving dock: pallet and a dock leveller
  {
    const [X, Z] = W(DOCK_IN.x, DOCK_IN.z + 1.6);
    root.add(at(box(1.2, 0.14, 1.0, M.wood), X, 0.07, Z));
    const [DX, DZ] = W(31, 89.7);
    root.add(at(box(4, 0.08, 0.6, M.facDark), DX, 0.04, DZ));
    const [EX, EZ] = W(12, 89.7);
    root.add(at(box(4, 0.08, 0.6, M.facDark), EX, 0.04, EZ));
  }

  const merged = mergeStatic(root);

  // ---- picking volumes (invisible) ----
  const pick = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), equipList.length);
  const m4 = new THREE.Matrix4();
  equipList.forEach((e, i) => {
    const [X, Z] = W(e.x, e.z);
    m4.compose(new THREE.Vector3(X, e.h / 2, Z), new THREE.Quaternion(), new THREE.Vector3(e.w + 0.1, e.h + 0.2, e.d + 0.1));
    pick.setMatrixAt(i, m4);
  });
  pick.visible = false;
  scene.add(pick);

  // ---- status: a coloured cap on each machine (seen from far) and a beacon (seen up close) ----
  const statusEquip = opts.status === false ? [] : equipList.filter(STATUS_EQUIP);
  const capMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, toneMapped: false });
  const caps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), capMat, statusEquip.length);
  caps.userData.noShadow = true;
  const col = new THREE.Color(0x888888);
  statusEquip.forEach((e, i) => {
    const [X, Z] = W(e.x, e.z);
    const onFloor = e.kind === 'bench';
    const top = onFloor ? 0.03 : e.kind === 'reflow' ? 1.31 : e.kind === 'mold' ? 1.1 : e.h + 0.012;
    const s = onFloor ? new THREE.Vector3(e.w + 0.7, 0.02, e.d + 0.7) : new THREE.Vector3(e.w * 0.98, 0.03, e.d * 0.98);
    m4.compose(new THREE.Vector3(X, top, Z), new THREE.Quaternion(), s);
    caps.setMatrixAt(i, m4);
    caps.setColorAt(i, col);
  });
  scene.add(caps);
  const beacons = createBeacons(scene, statusEquip.length, 0.09, 0.2);
  statusEquip.forEach((e, i) => { const p = equipPoint(e, ...beaconLocal(e)); beacons.place(i, p.x, p.y, p.z); });
  const statusIndex = new Map(statusEquip.map((e, i) => [e, i]));
  const capColor = new Int32Array(statusEquip.length).fill(-1);
  function setStatus(e: Equip, hex: number) {
    const i = statusIndex.get(e);
    if (i == null) return;
    beacons.color(i, hex);
    if (capColor[i] !== hex) { capColor[i] = hex; caps.setColorAt(i, col.set(hex)); caps.instanceColor!.needsUpdate = true; }
  }

  // ---- labels ----
  const areaLabels: Partial<Record<Zone, LabelDef[]>> = {};
  for (const a of AREAS) {
    const [X, Z] = W((a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2);
    const big = a.x1 - a.x0 >= 15;
    (areaLabels[a.zone] ??= []).push({ lines: big ? [`${a.id} · ${a.name}`] : [a.id, a.name], x: X, y: a.zone === 'fac' ? 6 : 4.6, z: Z });
  }
  const tagLabels: LabelDef[] = equipList.filter(e => e.counted).map(e => {
    const p = equipPoint(e, 0, (e.kind === 'bench' ? 1.6 : e.h) + 0.55, 0);
    return { lines: [e.tag], x: p.x, y: p.y, z: p.z };
  });

  return { root, merged, pick, equipList, statusEquip, setStatus, shelves, areaLabels, tagLabels, materials: M };
}

export type Plant = ReturnType<typeof buildPlant>;
