// "Projetos" layer of the plant: where each automation project of the Adata Technology portfolio acts. A numbered
// pin with the project name stands over its main area, the areas it covers get an outline on the floor in the
// project's colour, and clicking the pin opens the project's own page.
import * as THREE from 'three';
import { createLabels, type LabelDef } from '../../sim/labels';
import { AREAS, areaById } from './layout';
import { W } from './plant3d';

export interface PlantProject {
  num: string;
  name: string;
  url: string;
  color: string;
  /** Area the pin stands on, and every area the project covers. */
  pin: string;
  areas: string[];
  /** Pin position inside the pin area (0–1 of its width and depth; default centre). */
  at?: [number, number];
  note: string;
}

/** Matrix of the portfolio presentation: which project acts in which area. */
export const PLANT_PROJECTS: PlantProject[] = [
  { num: '01', name: 'Microscopia digital', url: '/projetos/adata-microscopia/', color: '#8e5bb5', pin: 'Q01', areas: ['Q01', 'Q02', 'P01F', 'P01E'], at: [0.85, 0.75], note: 'Bancadas de microscópio do front-end, do back-end e da Qualidade.' },
  { num: '02', name: 'Inspeção de substratos', url: '/projetos/adata-substratos/', color: '#1572d6', pin: 'P01D', areas: ['P01D'], note: 'Entrada do substrato na montagem, antes do die attach.' },
  { num: '03', name: 'ICs retrabalhados', url: '/projetos/adata-retrabalho/', color: '#d97706', pin: 'P02B', areas: ['P02B'], note: 'Depois da reposição de esferas e da refusão.' },
  { num: '04', name: 'Plataforma NPI', url: '/projetos/adata-npi/', color: '#0f766e', pin: 'Q02', areas: ['Q02'], note: 'Engenharia; atende todas as áreas (rota, receitas, instruções).' },
  { num: '05', name: 'Embalagem final', url: '/projetos/adata-embalagem/', color: '#b45309', pin: 'L05', areas: ['L05'], note: 'Dry pack, etiqueta e caixa de expedição.' },
  { num: '06', name: 'Movimentação com AMR', url: '/projetos/adata-movimentacao/', color: '#0891b2', pin: 'P01A', areas: ['P01A', 'P01B', 'P01C', 'P01D', 'P01E', 'P01F', 'P02A', 'P02B', 'P02C', 'P02D', 'T01', 'L05'], at: [0.5, 0.15], note: 'Salas limpas, testes e embalagem: os AMRs dos cenários desta planta.' },
  { num: 'IA', name: 'Inspeção pós-corte', url: '/projetos/adata-inspecao-pos-corte/', color: '#dc2626', pin: 'P01C', areas: ['P01C'], at: [0.5, 0.25], note: 'Célula com IA no lugar das bancadas INS01 e INS02.' },
];

export function createProjectsLayer(scene: THREE.Scene, font: string) {
  const group = new THREE.Group();
  scene.add(group);
  const pins: { sprite: THREE.Sprite; project: PlantProject }[] = [];
  const labelSets = PLANT_PROJECTS.map(p => {
    const a = areaById(p.pin), [fx, fz] = p.at ?? [0.5, 0.5];
    const x = a.x0 + (a.x1 - a.x0) * fx, z = a.z0 + (a.z1 - a.z0) * fz, [X, Z] = W(x, z);
    const color = new THREE.Color(p.color);
    // pin: pole and a ball on top
    const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 7.5, 10), mat);
    pole.position.set(X, 3.75, Z);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), mat);
    ball.position.set(X, 7.7, Z);
    group.add(pole, ball);
    // floor outline of every area the project covers (slightly inset, a different inset per project so they show side by side)
    const k = PLANT_PROJECTS.indexOf(p);
    for (const id of p.areas) {
      const ar = AREAS.find(r => r.id === id)!, inset = 0.4 + k * 0.32;
      const w = ar.x1 - ar.x0 - 2 * inset, d = ar.z1 - ar.z0 - 2 * inset, [cx, cz] = W((ar.x0 + ar.x1) / 2, (ar.z0 + ar.z1) / 2);
      const strip = (sw: number, sd: number, sx: number, sz: number) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(sw, sd), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(sx, 0.04, sz);
        m.userData.noShadow = true;
        group.add(m);
      };
      strip(w, 0.22, cx, cz - d / 2); strip(w, 0.22, cx, cz + d / 2); strip(0.22, d, cx - w / 2, cz); strip(0.22, d, cx + w / 2, cz);
    }
    const labels = createLabels(scene, font, { scale: 11, color: p.color });
    const def: LabelDef = { lines: [`${p.num} · ${p.name}`], x: X, y: 9.5, z: Z };
    labels.build([def]);
    return { labels, def, p };
  });
  const rebuild = () => {
    pins.length = 0;
    for (const s of labelSets) { s.labels.build([s.def]); pins.push({ sprite: s.labels.sprites[0], project: s.p }); }
  };
  rebuild();
  let visible = true;

  return {
    group,
    rebuild,
    get visible() { return visible; },
    setVisible(v: boolean) { visible = v; group.visible = v; labelSets.forEach(s => s.labels.setVisible(v)); },
    /** Back to the user's choice after a temporary hide (floor reflection, PNG). */
    restore() { labelSets.forEach(s => s.labels.restore()); },
    sprites: () => labelSets.flatMap(s => s.labels.sprites),
    /** The project whose pin label the ray hits, if any. */
    pick(ray: THREE.Raycaster): PlantProject | null {
      if (!visible) return null;
      const hit = ray.intersectObjects(pins.map(p => p.sprite))[0];
      return hit ? pins.find(p => p.sprite === hit.object)!.project : null;
    },
  };
}
