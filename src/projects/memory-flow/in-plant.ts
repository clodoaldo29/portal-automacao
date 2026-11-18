// Project cells shown inside the Memory Flow plant, at the place where they would be installed (like the post-dicing
// cell in P01C). The cell stays at the scene origin, so its robot kinematics do not change; the whole plant is
// built around it, shifted so the chosen plant point lands on the origin, without the equipment the cell replaces.
//
// A project page shows this mode when its <body> has data-in-plant="1" (pages under projetos/memory-flow-3d/<slug>/).
import * as THREE from 'three';
import { EQUIPMENT, areaById, type Equip } from './layout';
import { W, buildPlant } from './plant3d';

export interface Placement {
  slug: string;
  /** Plant point (m, plan coordinates) where the cell's origin goes. */
  x: number;
  z: number;
  /** Area of the plant, and the equipment the cell replaces there. */
  area: string;
  replaces: string[];
  /** Floor footprint of the cell around its origin (x0, x1, z0, z1, metres): no plant equipment may remain inside. */
  footprint: [number, number, number, number];
  label: string;
}

export const PLACEMENTS: Record<'microscopia' | 'substratos' | 'retrabalho' | 'embalagem', Placement> = {
  microscopia: { slug: 'microscopia', x: 45.5, z: 29.2, area: 'Q01', replaces: ['MIC02', 'MIC03'], footprint: [-1.95, 1.95, -0.45, 0.95], label: 'Q01 · no lugar das bancadas MIC02 e MIC03' },
  substratos: { slug: 'substratos', x: 46, z: 71.5, area: 'P01D', replaces: [], footprint: [-1.6, 1.6, -0.95, 0.45], label: 'P01D · entrada do substrato na montagem' },
  retrabalho: { slug: 'retrabalho', x: 95, z: 71.5, area: 'P02B', replaces: [], footprint: [-1.3, 1.3, -0.6, 1.0], label: 'P02B · depois da reposição de esferas e da refusão' },
  embalagem: { slug: 'embalagem', x: 30, z: 30.6, area: 'L05', replaces: ['EMB01', 'EMB02', 'SER01', 'SER02', 'CNF01', 'CNF02'], footprint: [-3.4, 3.95, -1.45, 1.75], label: 'L05 · no lugar das embaladoras, da serialização e da conferência' },
};

export const inPlant = () => document.body.dataset.inPlant === '1';

/** Footprint of an equipment in plan coordinates. */
const eqBox = (e: Equip) => [e.x - e.w / 2, e.x + e.w / 2, e.z - e.d / 2, e.z + e.d / 2];

/** Plant equipment that would overlap the cell (excluding what it replaces). Empty when the placement is clean. */
export function overlaps(p: Placement, list: Equip[] = EQUIPMENT): Equip[] {
  const [fx0, fx1, fz0, fz1] = p.footprint, x0 = p.x + fx0, x1 = p.x + fx1, z0 = p.z + fz0, z1 = p.z + fz1;
  return list.filter(e => !(e.area === p.area && p.replaces.includes(e.tag))).filter(e => {
    const [a0, a1, b0, b1] = eqBox(e);
    return a0 < x1 && a1 > x0 && b0 < z1 && b1 > z0;
  });
}

/** Build the plant around the cell. Returns the plant group (already shifted). */
export function buildPlantAround(scene: THREE.Scene, p: Placement) {
  areaById(p.area); // fails early on a wrong area id
  const g = new THREE.Group();
  scene.add(g);
  buildPlant(g as unknown as THREE.Scene, { exclude: e => e.area === p.area && p.replaces.includes(e.tag), status: false });
  const [X, Z] = W(p.x, p.z);
  g.position.set(-X, 0, -Z);
  document.body.dataset.plantBuilt = p.area; // tests and styles can tell the plant is around the cell
  // the cell's own area marking on the plant floor
  const [fx0, fx1, fz0, fz1] = p.footprint, w = fx1 - fx0 + 0.6, d = fz1 - fz0 + 0.6;
  const tape = new THREE.MeshBasicMaterial({ color: 0xf2c230 });
  const strip = (sw: number, sd: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sw, sd), tape);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.045, z);
    m.userData.noShadow = true;
    scene.add(m);
  };
  const cx = (fx0 + fx1) / 2, cz = (fz0 + fz1) / 2;
  strip(w, 0.1, cx, cz - d / 2); strip(w, 0.1, cx, cz + d / 2); strip(0.1, d, cx - w / 2, cz); strip(0.1, d, cx + w / 2, cz);
  return g;
}

/** Stage options for a cell page: in the plant the floor, fog and camera range must cover the whole hall. */
export const plantStage = { fog: { near: 60, far: 260 }, floor: { w: 300, d: 260 }, cameraFar: 600, maxDistance: 120 };
/** Camera views added in the plant: the whole plant, looking at the cell. */
export const plantView = { pos: [16, 18, 26] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
