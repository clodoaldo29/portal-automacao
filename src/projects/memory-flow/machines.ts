// Parametric equipment models: generic, brand-free shapes by kind (process tools, ovens, testers, utilities,
// shelving, booths, desks), built at real size from the layout footprints. All static: merged after building.
import * as THREE from 'three';
import { at, box, cyl, cylA, std } from '../../sim/kit';
import { ZONES, type Equip, type Kind, type Zone } from './layout';

export function createEquipMaterials() {
  const glassP = { transparent: true, opacity: 0.32, depthWrite: false };
  const zone = Object.fromEntries(Object.entries(ZONES).map(([k, v]) => [k, std(v.strong, 0.2, 0.45)])) as Record<Zone, THREE.MeshStandardMaterial>;
  return {
    zone,
    body: std(0xe2e6ea, 0.2, 0.42),
    body2: std(0xd5dae0, 0.35, 0.4),
    dark: std(0x2b3036, 0.3, 0.5),
    plinth: std(0x3a4048, 0.3, 0.6),
    glass: std(0x9cc6e0, 0.1, 0.05, glassP),
    tint: std(0x334b5e, 0.2, 0.15, { transparent: true, opacity: 0.6, depthWrite: false }),
    screen: std(0x0d2a4a, 0.2, 0.3, { emissive: new THREE.Color(0x1d6fd6), emissiveIntensity: 0.55 }),
    steel: std(0xb8bfc7, 0.8, 0.3),
    beam: std(0xe0702a, 0.2, 0.5),
    upright: std(0x2457a6, 0.3, 0.45),
    fac: std(0xc5cbd2, 0.45, 0.45),
    facDark: std(0x59626c, 0.4, 0.5),
    green: std(0x5f8f5a, 0.2, 0.5),
    genset: std(0xd9b43a, 0.3, 0.45),
    blueCab: std(0x3d6fb5, 0.3, 0.45),
    wood: std(0xc8b08a, 0.0, 0.8),
    carton: std(0xb58a5a, 0.0, 0.85),
    rubber: std(0x22262b, 0.0, 0.8),
    led: new THREE.MeshBasicMaterial({ color: 0x7fd3ff, toneMapped: false }),
  };
}
export type EquipMaterials = ReturnType<typeof createEquipMaterials>;

/** Facing the corridor: the local +z side is the front (load port). */
export function facesNorth(e: Equip) { return !!e.access && e.access.z < e.z; }

/** Build one piece of equipment in local coordinates (footprint centred at the origin, front towards +z). */
export function buildEquip(e: Equip, M: EquipMaterials, zone: Zone): THREE.Group {
  const g = new THREE.Group();
  const { w, d, h } = e;
  const add = (m: THREE.Mesh, x: number, y: number, z: number) => { g.add(at(m, x, y, z)); return m; };
  const stripe = M.zone[zone];

  /** Standard process tool: plinth, cabinet, front window, coloured band, touch screen and a load port. */
  const tool = (opt: { window?: boolean; port?: boolean; hood?: boolean } = {}) => {
    add(box(w, 0.08, d, M.plinth), 0, 0.04, 0);
    add(box(w, h - 0.08, d, M.body), 0, 0.08 + (h - 0.08) / 2, 0);
    add(box(w + 0.01, 0.07, d + 0.01, stripe), 0, h * 0.64, 0);
    if (opt.window !== false) add(box(w * 0.56, h * 0.26, 0.02, M.tint), -w * 0.12, h * 0.8, d / 2 + 0.005);
    add(box(0.32, 0.24, 0.03, M.screen), w / 2 - 0.26, h * 0.8, d / 2 + 0.02);
    if (opt.port !== false) {
      add(box(0.5, 0.06, 0.32, M.body2), -w / 2 + 0.38, 0.92, d / 2 + 0.16);
      add(box(0.46, 0.04, 0.04, M.dark), -w / 2 + 0.38, 0.96, d / 2 + 0.31);
    }
    if (opt.hood) add(box(w * 0.7, 0.3, d * 0.7, M.glass), 0, h + 0.15, 0);
  };

  switch (e.kind as Kind) {
    case 'dicer': case 'grinder': case 'saw': case 'mounter':
      tool();
      add(box(w * 0.42, 0.24, d * 0.5, M.body2), w * 0.18, h + 0.12, -d * 0.1);
      add(box(0.06, 0.4, 0.06, M.steel), w / 2 - 0.1, h + 0.2, -d / 2 + 0.1);
      break;
    case 'bonder':
      tool({ hood: true });
      break;
    case 'sorter': case 'reader': case 'aoi': case 'handler': case 'ballattach': case 'laser': case 'plasma': case 'washer':
      tool();
      if (e.kind === 'laser') add(box(0.3, 0.3, 0.3, M.dark), 0, h + 0.15, 0);
      if (e.kind === 'washer') add(cyl(0.12, 0.12, 0.5, M.steel, 12), -w / 2 + 0.2, h + 0.25, -d / 2 + 0.2);
      break;
    case 'xray':
      tool({ window: false });
      add(box(0.35, 0.35, 0.02, M.zone.proc), -w * 0.15, h * 0.8, d / 2 + 0.01);
      break;
    case 'pack':
      tool();
      add(box(0.9, 0.08, 0.5, M.rubber), -w / 2 - 0.4, 0.88, 0);
      break;
    case 'oven': case 'burnin': {
      add(box(w, 0.08, d, M.plinth), 0, 0.04, 0);
      add(box(w, h - 0.08, d, M.body2), 0, 0.08 + (h - 0.08) / 2, 0);
      add(box(w * 0.86, h * 0.68, 0.03, M.body), 0, h * 0.44, d / 2 + 0.01);
      add(box(0.05, 0.5, 0.06, M.steel), w * 0.36, h * 0.46, d / 2 + 0.05);
      add(box(w + 0.01, 0.07, d + 0.01, stripe), 0, h * 0.86, 0);
      add(box(0.3, 0.2, 0.03, M.screen), -w * 0.3, h * 0.92, d / 2 + 0.02);
      add(cylA(0.12, 0.4, M.steel, 'y', 12), w * 0.3, h + 0.2, -d * 0.2);
      break;
    }
    case 'reflow': {
      add(box(w, 0.75, d * 0.8, M.body2), 0, 0.375, 0);
      add(box(w * 0.9, 0.55, d, M.body), 0, 1.03, 0);
      add(box(w + 0.01, 0.06, d + 0.01, stripe), 0, 1.24, 0);
      add(box(0.5, 0.06, 0.4, M.rubber), -w / 2 - 0.2, 0.92, 0);
      add(box(0.5, 0.06, 0.4, M.rubber), w / 2 + 0.2, 0.92, 0);
      add(box(0.3, 0.22, 0.03, M.screen), w * 0.3, 1.05, d / 2 + 0.02);
      break;
    }
    case 'mold': {
      add(box(w, 0.08, d, M.plinth), 0, 0.04, 0);
      add(box(w, 1.0, d, M.body), 0, 0.58, 0);
      add(box(w * 0.5, 0.9, d * 0.6, M.body2), w * 0.2, 1.53, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(cyl(0.05, 0.05, 0.9, M.steel, 10), w * 0.2 + sx * w * 0.2, 1.53, sz * d * 0.24);
      add(box(w * 0.36, 0.5, d * 0.7, M.body), -w * 0.28, 1.33, 0);
      add(box(w + 0.01, 0.07, d + 0.01, stripe), 0, 1.06, 0);
      add(box(0.32, 0.24, 0.03, M.screen), -w * 0.28, 1.4, d * 0.35 + 0.02);
      break;
    }
    case 'ate': {
      add(box(w * 0.55, h, d, M.dark), -w * 0.22, h / 2, 0);
      add(box(w * 0.55 + 0.01, 0.07, d + 0.01, stripe), -w * 0.22, h * 0.7, 0);
      add(box(w * 0.4, 0.55, d * 0.8, M.body2), w * 0.28, 1.05, 0);
      add(box(0.06, 0.8, 0.06, M.steel), w * 0.28, 0.4, 0);
      for (let i = 0; i < 4; i++) add(box(w * 0.5, 0.02, 0.01, M.led), -w * 0.22, 0.5 + i * 0.3, d / 2 + 0.01);
      break;
    }
    case 'fct': {
      add(box(w, h, d, M.dark), 0, h / 2, 0);
      add(box(w + 0.01, 0.07, d + 0.01, stripe), 0, h * 0.92, 0);
      for (let i = 0; i < 6; i++) add(box(w * 0.8, 0.02, 0.01, M.led), 0, 0.4 + i * 0.22, d / 2 + 0.01);
      break;
    }
    case 'printer':
      add(box(w, h, d, M.body), 0, h / 2, 0);
      add(box(w + 0.01, 0.06, d + 0.01, stripe), 0, h * 0.8, 0);
      add(box(w * 0.6, 0.04, 0.3, M.body2), 0, h * 0.62, d / 2 + 0.15);
      add(box(0.26, 0.2, 0.03, M.screen), w * 0.25, h * 0.92, d / 2 + 0.02);
      break;
    case 'bench': case 'desk': {
      const top = e.kind === 'desk' ? 0.74 : 0.9;
      add(box(w, 0.04, d, e.kind === 'desk' ? M.wood : M.body), 0, top, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(box(0.04, top, 0.04, M.steel), sx * (w / 2 - 0.05), top / 2, sz * (d / 2 - 0.05));
      add(box(0.5, 0.32, 0.03, M.screen), -w * 0.15, top + 0.3, -d / 2 + 0.12);
      add(box(0.05, 0.14, 0.05, M.dark), -w * 0.15, top + 0.09, -d / 2 + 0.12);
      if (e.kind === 'bench') {
        // stereo microscope on inspection benches
        add(box(0.22, 0.04, 0.3, M.dark), w * 0.22, top + 0.04, 0);
        add(cyl(0.025, 0.025, 0.4, M.steel, 8), w * 0.22, top + 0.24, -0.1);
        add(cylA(0.06, 0.22, M.dark, 'z', 10), w * 0.22, top + 0.38, 0);
        add(box(w + 0.01, 0.05, 0.03, stripe), 0, top - 0.05, d / 2);
      }
      break;
    }
    case 'rack': case 'wipcart': case 'esdshelf': {
      const levels = e.kind === 'wipcart' ? 3 : 4, wheels = e.kind === 'wipcart';
      const up = wheels ? M.steel : M.upright, bm = wheels ? M.steel : M.beam;
      const y0 = wheels ? 0.15 : 0;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(box(0.06, h - y0, 0.06, up), sx * (w / 2 - 0.03), y0 + (h - y0) / 2, sz * (d / 2 - 0.03));
      for (let i = 0; i < levels; i++) {
        const y = y0 + 0.1 + (i * (h - y0 - 0.2)) / (levels - 1);
        add(box(w, 0.03, d, e.kind === 'esdshelf' ? M.body2 : M.steel), 0, y, 0);
        add(box(w, 0.08, 0.05, bm), 0, y, d / 2 - 0.03);
        if (i < levels - 1 && e.kind !== 'wipcart') for (let k = 0; k < Math.max(1, Math.floor(w / 1.1)); k++) {
          if ((k + i) % 3 === 2) continue;
          add(box(0.7, 0.35, d * 0.7, M.carton), -w / 2 + 0.55 + k * 1.1, y + 0.19, 0);
        }
      }
      if (wheels) for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(cylA(0.07, 0.04, M.rubber, 'x', 10), sx * (w / 2 - 0.12), 0.07, sz * (d / 2 - 0.12));
      break;
    }
    case 'booth': {
      add(box(w, 0.1, d, M.body2), 0, 0.05, 0);
      add(box(w, 0.25, d, M.body), 0, h - 0.125, 0);
      for (const sx of [-1, 1]) add(box(0.12, h - 0.35, d, M.body), sx * (w / 2 - 0.06), (h - 0.25) / 2 + 0.05, 0);
      add(box(w - 0.24, h - 0.35, 0.03, M.glass), 0, (h - 0.25) / 2 + 0.05, d / 2 - 0.02);
      add(box(w - 0.24, h - 0.35, 0.03, M.glass), 0, (h - 0.25) / 2 + 0.05, -d / 2 + 0.02);
      add(box(w + 0.01, 0.06, d + 0.01, stripe), 0, h - 0.3, 0);
      break;
    }
    // ---- utilities ----
    case 'transformer': {
      add(box(w * 0.7, h, d * 0.6, M.fac), 0, h / 2, 0);
      for (let i = 0; i < 7; i++) add(box(0.03, h * 0.7, d * 0.9, M.facDark), -w * 0.33 + i * w * 0.11, h * 0.45, 0);
      for (let i = 0; i < 3; i++) add(cyl(0.07, 0.09, 0.4, M.body2, 10), -w * 0.2 + i * w * 0.2, h + 0.2, 0);
      break;
    }
    case 'panel': {
      const n = Math.max(1, Math.round(w / 0.7));
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + (i + 0.5) * (w / n);
        add(box(w / n - 0.02, h, d, M.fac), x, h / 2, 0);
        add(box(0.03, 0.2, 0.04, M.dark), x + w / n * 0.35, h * 0.55, d / 2 + 0.02);
      }
      add(box(w + 0.01, 0.08, d + 0.01, stripe), 0, h - 0.1, 0);
      break;
    }
    case 'genset':
      add(box(w, h, d, M.genset), 0, h / 2, 0);
      add(box(w * 0.9, 0.1, d * 0.9, M.facDark), 0, h + 0.05, 0);
      add(cyl(0.12, 0.12, 0.7, M.facDark, 10), w * 0.3, h + 0.35, -d * 0.25);
      break;
    case 'chiller': {
      add(box(w, h, d, M.fac), 0, h / 2, 0);
      add(box(w + 0.01, 0.1, d + 0.01, stripe), 0, h * 0.85, 0);
      for (let i = 0; i < 3; i++) add(cyl(0.7, 0.7, 0.2, M.facDark, 20), -w / 3 + (i * w) / 3, h + 0.1, 0);
      add(cylA(0.18, w * 1.05, M.blueCab, 'x', 12), 0, 0.5, d / 2 + 0.25);
      break;
    }
    case 'tower': {
      add(box(w, h * 0.75, d, M.fac), 0, (h * 0.75) / 2, 0);
      for (let i = 0; i < 8; i++) add(box(w + 0.02, 0.04, 0.05, M.facDark), 0, 0.4 + i * 0.35, d / 2);
      add(cyl(1.5, 1.7, h * 0.25, M.facDark, 24), 0, h * 0.875, 0);
      break;
    }
    case 'pump': {
      add(box(w, 0.15, d, M.facDark), 0, 0.075, 0);
      add(cylA(0.22, w * 0.5, M.blueCab, 'x', 14), -w * 0.18, 0.45, 0);
      add(cyl(0.25, 0.25, 0.25, M.fac, 14), w * 0.25, 0.45, 0);
      add(cylA(0.08, 0.6, M.steel, 'y', 10), w * 0.25, 0.85, 0);
      break;
    }
    case 'ahu': case 'humid': case 'compressor': {
      add(box(w, h, d, e.kind === 'compressor' ? M.blueCab : M.fac), 0, h / 2, 0);
      add(box(w + 0.01, 0.06, d + 0.01, stripe), 0, h * 0.85, 0);
      if (e.kind === 'ahu') add(box(w * 0.6, 0.8, d * 0.6, M.steel), 0, h + 0.4, 0);
      else add(box(0.3, 0.2, 0.03, M.screen), w * 0.25, h * 0.7, d / 2 + 0.02);
      break;
    }
    case 'fan':
      add(box(w, h * 0.6, d, M.fac), 0, h * 0.3, 0);
      add(cylA(0.6, h * 0.9, M.steel, 'y', 18), -w * 0.2, h * 0.6 + (h * 0.9) / 2, 0);
      break;
    case 'tank':
      add(cyl(w / 2, w / 2, h, M.body2, 20), 0, h / 2, 0);
      add(cyl(w / 2 + 0.01, w / 2 + 0.01, 0.07, stripe, 20), 0, h * 0.8, 0);
      break;
    case 'filter': {
      add(box(w, 0.15, d, M.facDark), 0, 0.075, 0);
      const n = w > 2 ? 3 : 1;
      for (let i = 0; i < n; i++) add(cyl(0.3, 0.3, h - 0.3, M.body2, 16), n === 1 ? 0 : -w / 3 + (i * w) / 3, 0.15 + (h - 0.3) / 2, -d * 0.1);
      add(cylA(0.06, w, M.steel, 'x', 8), 0, 0.5, d / 2 - 0.15);
      break;
    }
  }
  return g;
}

/** Local position of the status light on top of a machine (back right corner). */
export function beaconLocal(e: Equip): [number, number, number] {
  const top = e.kind === 'bench' || e.kind === 'desk' ? 1.6 : e.kind === 'reflow' ? 1.45 : e.kind === 'mold' ? 2.1 : e.h;
  return [e.w / 2 - 0.18, top + 0.12, -e.d / 2 + 0.18];
}

export const KIND_NAME: Record<Kind, string> = {
  sorter: 'Sorter / manipulador de wafer', reader: 'Leitora de mapa e ID', grinder: 'Retífica de afinamento', mounter: 'Montadora de fita e anel',
  washer: 'Lavadora / secadora', dicer: 'Máquina de corte', bench: 'Bancada de inspeção', bonder: 'Bonder', plasma: 'Limpeza a plasma',
  oven: 'Forno / câmara', burnin: 'Forno de burn-in', aoi: 'Inspeção óptica (AOI)', mold: 'Prensa de moldagem', ballattach: 'Aplicadora de esferas',
  reflow: 'Forno de refusão', xray: 'Raio X', laser: 'Laser', saw: 'Singuladora', ate: 'Testador (ATE)', handler: 'Handler de teste',
  fct: 'Rack de teste funcional', pack: 'Embaladora', printer: 'Impressora / serialização', rack: 'Rack de WIP', wipcart: 'Carrinho de WIP',
  esdshelf: 'Estante ESD', booth: 'SAS / air shower', desk: 'Posto com PC', transformer: 'Transformador', panel: 'Painel elétrico / controle',
  genset: 'Grupo gerador', chiller: 'Chiller', tower: 'Torre de resfriamento', pump: 'Bomba', ahu: 'Unidade de tratamento de ar',
  humid: 'Umidificador / aquecedor', fan: 'Exaustor', compressor: 'Compressor / vácuo', tank: 'Tanque', filter: 'Filtro / trocador / tratamento',
};
