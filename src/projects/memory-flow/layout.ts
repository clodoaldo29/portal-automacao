// Plant layout: macro-areas, the 219 equipment positions and the floor lanes, rebuilt from the conceptual floor
// plan "ADATA Planta Baixa Rev. C" (sheets 01–06). Plan coordinates in metres: x from west (0) to east (120),
// z from north (0) to south (90). The 3D scene centres the plant on the origin (X = x − 60, Z = z − 45).
//
// The plan is a conceptual study (120 × 90 m equivalent geometry, symbolic footprints). Positions were measured on
// the PDF sheets; tags left blank on the sheets got a provisional tag (`prov: true`). When the DXF/CSV with the real
// coordinates arrives, this file is the only one to replace.
import type { Lane, P2 } from '../../sim/paths';

export const PLANT = { w: 120, d: 90 };

export type Zone = 'iso6' | 'iso7' | 'proc' | 'insp' | 'fac' | 'log' | 'eng';

/** Legend colours of the plan: strong (labels, stripes) and floor tint. */
export const ZONES: Record<Zone, { name: string; strong: number; tint: number }> = {
  iso6: { name: 'Front-end / ISO 6', strong: 0x2f6fb0, tint: 0x9fc4e6 },
  iso7: { name: 'Back-end / ISO 7', strong: 0x2f9e6a, tint: 0xa3d9bb },
  proc: { name: 'Processos / teste', strong: 0xd08a1c, tint: 0xf0cf8f },
  insp: { name: 'Inspeção / confiabilidade', strong: 0x8e5bb5, tint: 0xcfb6e6 },
  fac: { name: 'Facilities', strong: 0xc0503f, tint: 0xe9b0a6 },
  log: { name: 'Logística / estoques', strong: 0x5f6b7a, tint: 0xc3cad2 },
  eng: { name: 'Manutenção / engenharia', strong: 0x4f8a4a, tint: 0xbad6b3 },
};

export interface Area { id: string; name: string; zone: Zone; x0: number; z0: number; x1: number; z1: number }

export const AREAS: Area[] = [
  ...['Energia / trafo', 'UPS / geradores', 'Chiller CH-01', 'Chiller CH-02', 'Chiller CH-03', 'Torre TR-01', 'Torre TR-02', 'Torre TR-03']
    .map((name, i): Area => ({ id: `F0${i + 1}`, name, zone: 'fac', x0: i * 10, z0: 0, x1: i * 10 + 10, z1: 10 })),
  ...['Bombas / trocadores', 'UTA / AHU', 'Umidade / aquecimento', 'Exaustão', 'Ar comprimido / vácuo', 'Água / poços', 'UF / OR', 'BMS / ETE']
    .map((name, i): Area => ({ id: `F${String(i + 9).padStart(2, '0')}`, name, zone: 'fac', x0: i * 10, z0: 10, x1: i * 10 + 10, z1: 20 })),
  { id: 'M01', name: 'Oficina de manutenção', zone: 'eng', x0: 80, z0: 0, x1: 100, z1: 20 },
  { id: 'Q02', name: 'Engenharia e laboratório', zone: 'eng', x0: 100, z0: 0, x1: 120, z1: 20 },
  { id: 'E01', name: 'Buffer de produto acabado', zone: 'log', x0: 0, z0: 25, x1: 20, z1: 45 },
  { id: 'L05', name: 'Embalagem e serialização', zone: 'log', x0: 20, z0: 25, x1: 40, z1: 45 },
  { id: 'Q01', name: 'Qualidade, AOI e metrologia', zone: 'insp', x0: 40, z0: 25, x1: 60, z1: 45 },
  { id: 'T02', name: 'Confiabilidade e burn-in', zone: 'insp', x0: 60, z0: 25, x1: 80, z1: 45 },
  { id: 'T01', name: 'Teste elétrico (ATE)', zone: 'proc', x0: 80, z0: 25, x1: 100, z1: 45 },
  { id: 'P03', name: 'Pós-moldagem e singulação', zone: 'proc', x0: 100, z0: 25, x1: 120, z1: 45 },
  { id: 'P01A', name: 'Mapa e rastreabilidade', zone: 'iso6', x0: 0, z0: 50, x1: 15, z1: 75 },
  { id: 'P01B', name: 'Afinamento, fita e lavagem', zone: 'iso6', x0: 15, z0: 50, x1: 28, z1: 75 },
  { id: 'P01C', name: 'Corte e inspeção', zone: 'iso6', x0: 28, z0: 50, x1: 40, z1: 75 },
  { id: 'P01D', name: 'Die attach, plasma e cura', zone: 'iso6', x0: 40, z0: 50, x1: 52, z1: 75 },
  { id: 'P01E', name: 'Wire bonding', zone: 'iso6', x0: 52, z0: 50, x1: 67, z1: 75 },
  { id: 'P01F', name: 'AOI e metrologia', zone: 'iso6', x0: 67, z0: 50, x1: 80, z1: 75 },
  { id: 'P02A', name: 'Moldagem e pós-cura', zone: 'iso7', x0: 80, z0: 50, x1: 90, z1: 75 },
  { id: 'P02B', name: 'Esferas e refusão', zone: 'iso7', x0: 90, z0: 50, x1: 100, z1: 75 },
  { id: 'P02C', name: 'Marcação e limpeza', zone: 'iso7', x0: 100, z0: 50, x1: 110, z1: 75 },
  { id: 'P02D', name: 'Raio X e AOI', zone: 'iso7', x0: 110, z0: 50, x1: 120, z1: 75 },
  { id: 'L04', name: 'Expedição', zone: 'log', x0: 0, z0: 75, x1: 25, z1: 90 },
  { id: 'L01', name: 'Recebimento e inspeção', zone: 'log', x0: 25, z0: 75, x1: 55, z1: 90 },
  { id: 'L02', name: 'Almoxarifado ESD', zone: 'log', x0: 55, z0: 75, x1: 80, z1: 90 },
  { id: 'L03', name: 'Paramentação e SAS', zone: 'log', x0: 80, z0: 75, x1: 95, z1: 90 },
  { id: 'A01', name: 'Administração, SESMT e TI', zone: 'log', x0: 95, z0: 75, x1: 120, z1: 90 },
];

export const areaById = (id: string) => {
  const a = AREAS.find(x => x.id === id);
  if (!a) throw new Error(`unknown area ${id}`);
  return a;
};

/** Main corridors (5 m, between the macro-blocks). */
export const CORRIDORS = [{ x0: 0, z0: 20, x1: 120, z1: 25 }, { x0: 0, z0: 45, x1: 120, z1: 50 }];

// ---------------------------------------------------------------------------------------------------------------
// Equipment

export type Kind =
  // process
  | 'sorter' | 'reader' | 'grinder' | 'mounter' | 'washer' | 'dicer' | 'bench' | 'bonder' | 'plasma' | 'oven' | 'burnin'
  | 'aoi' | 'mold' | 'ballattach' | 'reflow' | 'xray' | 'laser' | 'saw' | 'ate' | 'handler' | 'fct' | 'pack' | 'printer'
  // logistics and people
  | 'rack' | 'wipcart' | 'esdshelf' | 'booth' | 'desk'
  // utilities
  | 'transformer' | 'panel' | 'genset' | 'chiller' | 'tower' | 'pump' | 'ahu' | 'humid' | 'fan' | 'compressor' | 'tank' | 'filter';

/** Footprint (w along x, d along z) and height in metres: symbolic reservations, not manufacturer drawings. */
export const SIZE: Record<Kind, [number, number, number]> = {
  sorter: [1.6, 1.4, 1.9], reader: [1.3, 1.1, 1.5], grinder: [1.9, 1.6, 1.9], mounter: [1.7, 1.4, 1.7], washer: [1.5, 1.4, 1.8],
  dicer: [1.7, 1.6, 1.85], bench: [1.7, 0.85, 0.9], bonder: [1.4, 1.2, 1.75], plasma: [1.3, 1.1, 1.6], oven: [1.5, 1.2, 2.0],
  burnin: [2.0, 1.4, 2.1], aoi: [1.6, 1.4, 1.8], mold: [2.2, 1.8, 2.1], ballattach: [1.9, 1.4, 1.8], reflow: [3.2, 1.2, 1.4],
  xray: [1.7, 1.5, 2.0], laser: [1.6, 1.3, 1.8], saw: [1.9, 1.6, 1.9], ate: [1.7, 1.2, 1.8], handler: [1.7, 1.4, 1.9],
  fct: [1.3, 0.9, 2.0], pack: [1.9, 1.3, 1.6], printer: [1.1, 0.8, 1.3],
  rack: [2.2, 2.4, 2.4], wipcart: [2.2, 1.4, 1.6], esdshelf: [5.0, 4.0, 2.4], booth: [2.2, 3.0, 2.5], desk: [1.6, 0.8, 0.75],
  transformer: [3.0, 2.1, 2.4], panel: [2.1, 1.0, 2.2], genset: [2.1, 2.1, 2.2], chiller: [5.6, 3.9, 2.6], tower: [4.4, 3.9, 4.5],
  pump: [1.4, 1.1, 1.1], ahu: [1.5, 1.3, 2.2], humid: [1.6, 1.2, 1.8], fan: [3.0, 2.1, 2.4], compressor: [1.8, 1.3, 1.7],
  tank: [1.4, 1.4, 2.4], filter: [3.0, 2.1, 2.2],
};

export interface Equip {
  tag: string;
  area: string;
  kind: Kind;
  /** Centre of the footprint. */
  x: number;
  z: number;
  /** Load port on the corridor this machine faces (process equipment only). */
  access?: P2;
  /** Tag not on the plan sheets (position blank there): provisional. */
  prov?: boolean;
  /** Sizes (defaults from SIZE). */
  w: number;
  d: number;
  h: number;
  /** Counted in the 219 equipment of the plan (PC desks are extra detail). */
  counted: boolean;
}

/** Corridor each block's machines face (load ports). */
const ACCESS_Z: Record<string, number> = {
  P01A: 61.5, P01B: 61.5, P01C: 61.5, P01D: 61.5, P01E: 61.5, P01F: 61.5, P02A: 61.5, P02B: 61.5, P02C: 61.5, P02D: 61.5,
  E01: 35, L05: 35, Q01: 35, T02: 35, T01: 35, P03: 35, L01: 80.8, L04: 80.8,
};

export const EQUIPMENT: Equip[] = [];

function put(area: string, kind: Kind, items: [string, number, number][], opt: { prov?: string[]; counted?: boolean; size?: [number, number, number] } = {}) {
  const [w, d, h] = opt.size ?? SIZE[kind];
  for (const [tag, x, z] of items) {
    const az = ACCESS_Z[area];
    EQUIPMENT.push({
      tag, area, kind, x, z, w, d, h,
      access: az != null && !['rack', 'wipcart', 'desk'].includes(kind) ? { x, z: az } : undefined,
      prov: opt.prov?.includes(tag) || undefined,
      counted: opt.counted ?? true,
    });
  }
}
const row = (tags: string[], xs: number[], z: number): [string, number, number][] => tags.map((t, i) => [t, xs[i], z]);
const seq = (p: string, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `${p}${String(a + i).padStart(2, '0')}`);

// ---- P01: front-end, ISO 6 (sheet 02) ----
put('P01A', 'sorter', row(['WTR01', 'WTR02'], [4.1, 10.9], 55.6));
put('P01A', 'reader', row(['MAP01', 'MAP02'], [4.1, 10.9], 66.8), { prov: ['MAP01', 'MAP02'] });
put('P01B', 'mounter', [['MNT01', 17.6, 55.6], ['MNT02', 25.4, 66.8]], { prov: ['MNT01', 'MNT02'] });
put('P01B', 'washer', row(['LAV01', 'LAV02'], [21.5, 25.4], 55.6));
put('P01B', 'grinder', row(['BGR01', 'BGR02'], [17.6, 21.5], 66.8));
put('P01C', 'dicer', [['DIC04', 30.5, 55.6], ...row(['DIC01', 'DIC02', 'DIC03'], [30.5, 34.0, 37.5], 66.8)]);
put('P01C', 'bench', row(['INS01', 'INS02'], [34.0, 37.5], 55.6));
put('P01D', 'oven', [['CUR03', 42.1, 53.8], ...row(['CUR01', 'CUR02'], [47.4, 50.0], 57.3)], { size: [1.6, 1.2, 2.0] });
put('P01D', 'plasma', row(['PLS01', 'PLS02'], [42.1, 44.7], 57.3), { size: [1.4, 1.1, 1.6] });
put('P01D', 'bonder', [...row(['DAB05', 'DAB06'], [42.1, 44.7], 65.3), ...row(['DAB01', 'DAB02', 'DAB03', 'DAB04'], [42.1, 44.7, 47.4, 50.0], 68.3)], { size: [1.5, 1.2, 1.75] });
{
  const cols = [54.4, 57.9, 61.3, 64.7];
  const wb = seq('WB', 1, 14);
  put('P01E', 'bonder', [...row(wb.slice(0, 2), cols, 53.8), ...row(wb.slice(2, 6), cols, 57.3), ...row(wb.slice(6, 10), cols, 65.3), ...row(wb.slice(10, 14), cols, 68.3)], { prov: wb });
  put('P01E', 'aoi', row(['INS01', 'INS02'], [61.3, 64.7], 53.8), { size: [1.4, 1.2, 1.7] });
}
put('P01F', 'aoi', [...row(['MET01', 'MET02'], [70.6, 76.4], 55.6), ...row(['AOI01', 'AOI02'], [70.6, 76.4], 66.8)]);

// ---- P02: back-end, ISO 7 (sheet 02) ----
put('P02A', 'oven', [['PMC03', 82.8, 53.5], ...row(['PMC01', 'PMC02'], [82.8, 87.1], 57.2)], { size: [1.7, 1.2, 2.0] });
put('P02A', 'mold', [...row(['MLD03', 'MLD04'], [82.8, 87.1], 65.2), ...row(['MLD01', 'MLD02'], [82.8, 87.1], 68.2)], { size: [2.2, 1.5, 2.1] });
put('P02B', 'reflow', [['RFL02', 94.0, 53.8], ['RFL01', 97.4, 57.2]], { size: [2.6, 1.1, 1.4] });
put('P02B', 'ballattach', [['BAL03', 92.6, 57.2], ...row(['BAL01', 'BAL02'], [92.8, 97.1], 65.2)], { size: [1.8, 1.3, 1.8] });
put('P02B', 'washer', row(['DFL01', 'DFL02'], [92.8, 97.1], 68.2), { size: [1.8, 1.3, 1.6] });
put('P02C', 'washer', row(['LAV01', 'LAV02'], [102.9, 107.1], 55.0));
put('P02C', 'laser', row(['LAS01', 'LAS02'], [102.9, 107.1], 66.8));
put('P02D', 'xray', row(['XRY01', 'XRY02'], [112.9, 117.2], 55.0));
put('P02D', 'aoi', row(['AOI01', 'AOI02'], [112.9, 117.2], 66.8));

// ---- process, test and quality bays (sheet 03) ----
put('E01', 'rack', [...row(['WIP01', 'WIP02', 'WIP03'], [3.0, 8.4, 13.8], 29.3), ...row(['WIP04', 'WIP05', 'WIP06'], [3.0, 8.4, 13.8], 39.1), ...row(['WIP07', 'WIP08', 'WIP09'], [3.0, 8.4, 13.8], 42.0)], { counted: false, size: [3.3, 1.6, 2.0] });
put('L05', 'printer', [['SER02', 23.8, 29.3], ['SER01', 36.2, 40.9]]);
put('L05', 'bench', [...row(['CNF01', 'CNF02'], [30.0, 36.2], 29.3)]);
put('L05', 'pack', row(['EMB01', 'EMB02'], [23.8, 30.0], 40.9));
put('L05', 'rack', row(['RACK01', 'RACK02', 'RACK03'], [22.7, 28.3, 33.9], 37.9), { counted: false, size: [3.3, 0.8, 1.8] });
put('Q01', 'bench', [...row(['MIC02', 'MIC03'], [43.0, 47.7], 29.3), ['MIC01', 57.5, 40.9]]);
put('Q01', 'aoi', [...row(['MET01', 'MET02'], [52.3, 57.0], 29.3), ...row(['AOI01', 'AOI02', 'AOI03'], [42.6, 46.2, 50.0], 40.9)]);
put('Q01', 'xray', [['XRY01', 53.8, 40.9]]);
put('T02', 'burnin', [['BIN06', 62.6, 29.3], ...row(['BIN01', 'BIN02', 'BIN03', 'BIN04', 'BIN05'], [62.6, 66.3, 70.0, 73.7, 77.4], 40.9)]);
put('T02', 'oven', [...row(['CTE01', 'CTE02', 'CLI01', 'CLI02'], [66.3, 70.0, 73.7, 77.4], 29.3)], { size: [1.8, 1.3, 2.0] });
put('T01', 'handler', [...row(['HDL02', 'HDL03', 'HDL04', 'HDL05', 'HDL06'], [82.0, 84.7, 87.3, 90.0, 92.6], 29.3), ['HDL01', 97.95, 40.9]], { size: [1.6, 1.4, 1.9] });
put('T01', 'fct', row(['FCT01', 'FCT02'], [95.3, 97.95], 29.3));
put('T01', 'ate', row(['ATE01', 'ATE02', 'ATE03', 'ATE04', 'ATE05', 'ATE06'], [82.0, 84.7, 87.3, 90.0, 92.6, 95.3], 40.9), { size: [1.6, 1.2, 1.8] });
put('P03', 'washer', row(['LAV01', 'LAV02'], [102.6, 106.2], 29.3));
put('P03', 'sorter', row(['SOR01', 'SOR02', 'SOR03'], [110.0, 113.8, 117.5], 29.3));
put('P03', 'saw', row(['TRM01', 'TRM02', 'TRM03', 'TRM04'], [102.3, 105.4, 108.4, 111.5], 40.9), { size: [1.8, 1.5, 1.9] });
put('P03', 'laser', row(['LAS01', 'LAS02'], [114.7, 117.7], 40.9), { size: [1.5, 1.3, 1.8] });

// ---- logistics, gowning and admin (sheet 05) ----
put('L04', 'bench', row(['CNF01', 'CNF02'], [6.7, 14.5], 78.9));
put('L04', 'rack', row(seq('RACK', 1, 7), [2.2, 5.2, 8.2, 11.2, 14.2, 17.2, 20.2], 83.2), { counted: false });
put('L01', 'bench', row(['INS01', 'INS02'], [30.2, 36.3], 78.6));
put('L01', 'printer', row(['ETQ01', 'ETQ02'], [44.2, 50.3], 78.6));
put('L01', 'wipcart', row(seq('WIP', 1, 8), [27.6, 31.1, 34.5, 38.0, 41.5, 45.0, 48.5, 52.0], 83.3), { counted: false });
put('L02', 'esdshelf', row(['ESD01', 'ESD02', 'ESD03'], [59.9, 66.8, 73.6], 79.9));
put('L03', 'booth', [...row(['SAS01', 'SAS02', 'ASH01', 'ASH02'], [82.2, 85.3, 88.5, 91.7], 83.4)]);
put('A01', 'desk', [...[97.2, 101.8, 106.4, 111.0, 115.6].flatMap((x, i) => [[`PC${String(i + 1).padStart(2, '0')}`, x, 77.9], [`PC${String(i + 6).padStart(2, '0')}`, x, 83.4]] as [string, number, number][])], { counted: false });

// ---- maintenance and engineering (sheet 05) ----
put('M01', 'bench', [['REP01', 85.5, 5.3], ['ULT01', 94.8, 5.3], ['CAL01', 85.5, 15.5], ['CAL02', 94.8, 15.5]], { prov: ['REP01', 'ULT01', 'CAL01', 'CAL02'], size: [2.0, 1.0, 0.9] });
put('Q02', 'bench', [['MIC01', 105.5, 5.3], ['ENG01', 114.8, 5.3], ['TST01', 103.9, 15.5], ['MET01', 110.2, 15.5], ['MET02', 116.3, 15.5]], { prov: ['MIC01', 'ENG01', 'TST01', 'MET01', 'MET02'], size: [2.0, 1.0, 0.9] });

// ---- facilities (sheet 04): 78 functional volumes ----
put('F01', 'transformer', row(['TRA01', 'TRA02'], [2.9, 7.1], 3.5));
put('F01', 'panel', row(['QGBT01', 'QGBT02'], [2.9, 7.1], 7.5), { size: [3.0, 1.2, 2.2] });
put('F02', 'panel', [['ATS02', 12.2, 3.5], ['UPS01', 12.2, 7.5], ['UPS02', 15.0, 7.5], ['ATS01', 17.9, 7.5]]);
put('F02', 'genset', row(['GER01', 'GER02'], [15.0, 17.9], 3.5), { prov: ['GER01', 'GER02'] });
put('F03', 'chiller', [['CH01', 25.0, 5.5]]);
put('F04', 'chiller', [['CH02', 35.0, 5.5]], { prov: ['CH02'] });
put('F05', 'chiller', [['CH03', 45.0, 5.5]], { prov: ['CH03'] });
put('F06', 'tower', [['TR01', 55.0, 5.5]], { prov: ['TR01'] });
put('F07', 'tower', [['TR02', 65.0, 5.5]], { prov: ['TR02'] });
put('F08', 'tower', [['TR03', 75.0, 5.5]], { prov: ['TR03'] });
{
  const grid = (xs: number[], tags: string[], kinds: Kind[], area: string) => {
    const zs = [12.9, 15.5, 18.1];
    tags.forEach((t, i) => put(area, kinds[i], [[t, xs[i % 4], zs[Math.floor(i / 4)]]], { prov: [t], size: kinds[i] === 'filter' ? [1.5, 1.1, 1.5] : undefined }));
  };
  const pumps = seq('BOM', 1, 10);
  grid([1.8, 3.9, 6.1, 8.2], [...pumps, 'HX01', 'HX02'], [...pumps.map((): Kind => 'pump'), 'filter', 'filter'], 'F09');
  grid([11.8, 13.9, 16.1, 18.2], seq('UTA', 1, 12), Array(12).fill('ahu'), 'F10');
}
put('F11', 'humid', [['UMI01', 22.1, 12.9], ...row(['UMI02', 'UMI03', 'UMI04'], [22.1, 25.0, 27.9], 15.5), ...row(['UMI05', 'UMI06', 'AQC01'], [22.1, 25.0, 27.9], 18.1)], { prov: ['UMI01', 'UMI02', 'UMI03', 'UMI04', 'UMI05', 'UMI06', 'AQC01'] });
put('F12', 'fan', [['EXA03', 32.9, 13.5], ...row(['EXA01', 'EXA02'], [32.9, 37.1], 17.4)]);
put('F13', 'compressor', [...row(['CDA01', 'CDA02'], [42.1, 45.0], 12.9), ...row(['CDA03', 'SEC01', 'SEC02'], [42.1, 45.0, 47.9], 15.5), ...row(['VAC01', 'VAC02', 'VAC03'], [42.1, 45.0, 47.9], 18.1)], { prov: ['CDA01', 'CDA02', 'CDA03', 'SEC01', 'SEC02', 'VAC01', 'VAC02', 'VAC03'], size: [1.6, 1.2, 1.6] });
put('F14', 'pump', row(['POC01', 'POC02'], [51.8, 53.9], 12.9), { prov: ['POC01', 'POC02'] });
put('F14', 'filter', row(['FIL01', 'FIL02', 'FIL03', 'FIL04'], [51.8, 53.9, 56.1, 58.2], 15.5), { prov: ['FIL01', 'FIL02', 'FIL03', 'FIL04'], size: [1.4, 1.2, 1.9] });
put('F14', 'tank', row(['TQ01', 'TQ02', 'TQ03', 'TQ04'], [51.8, 53.9, 56.1, 58.2], 18.1), { prov: ['TQ01', 'TQ02', 'TQ03', 'TQ04'], size: [1.5, 1.5, 2.4] });
put('F15', 'filter', [['BRU01', 62.9, 13.5], ['BRU02', 67.1, 13.5], ['UF01', 62.9, 17.5], ['OR01', 67.1, 17.5]]);
put('F16', 'panel', [['PLC01', 72.1, 13.5], ['PLC02', 75.0, 13.5], ['BMS01', 77.9, 13.5], ['SCA01', 75.0, 17.5], ['SCA02', 77.9, 17.5]], { prov: ['BMS01'] });
put('F16', 'filter', [['ETE01', 72.1, 17.5]], { size: [2.1, 1.6, 2.0] });

// ---- PC workstations shown on sheet 01 (detail, not in the 219) ----
for (const a of AREAS) {
  if (a.zone === 'fac' || ['A01', 'L02', 'E01'].includes(a.id)) continue;
  const n = a.id === 'P01E' ? 4 : a.id.startsWith('P01D') || a.id === 'Q02' ? 3 : 2;
  for (let i = 0; i < n; i++) put(a.id, 'desk', [[`${a.id}-PC${i + 1}`, a.x0 + 1.4 + i * 1.9, a.z0 + 0.9]], { counted: false, size: [1.6, 0.7, 0.75] });
}

export const equipByKey = new Map(EQUIPMENT.map(e => [`${e.area}-${e.tag}`, e]));
export const equip = (area: string, tag: string) => {
  const e = equipByKey.get(`${area}-${tag}`);
  if (!e) throw new Error(`unknown equipment ${area}-${tag}`);
  return e;
};

// ---------------------------------------------------------------------------------------------------------------
// Floor lanes for carts and AMRs (flow lines of sheets 01–03 and the corridors)

const L = (ax: number, az: number, bx: number, bz: number, door = false): Lane => ({ a: { x: ax, z: az }, b: { x: bx, z: bz }, door });

export const LANES: Lane[] = [
  L(0.6, 80.8, 55, 80.8), // L04 + L01, in front of the benches
  L(3, 87.5, 63.3, 87.5), // L01 → L02, pallet corridor
  L(24, 80.8, 24, 87.5), L(55, 80.8, 55, 87.5),
  L(63.3, 87.5, 63.3, 75.6), L(63.3, 75.6, 63.3, 74.4, true), L(63.3, 74.4, 63.3, 61.5), // material entry into ISO 6
  L(11, 73, 67, 73), L(11, 73, 11, 61.5), // segregated WIP lane of the plan
  L(1, 61.5, 79.4, 61.5), L(79.4, 61.5, 80.6, 61.5, true), L(80.6, 61.5, 119, 61.5), // ISO 6 → pass box → ISO 7
  L(110, 61.5, 110, 50.6), L(110, 50.6, 110, 49.4, true), L(110, 49.4, 110, 35), // ISO 7 exit → P03
  L(0.6, 47.5, 119, 47.5), // corridor 2
  L(1, 35, 119, 35), // technical corridor of the test bays
  L(12, 35, 12, 47.5),
  L(0.6, 47.5, -0.6, 47.5, true), L(-0.6, 47.5, -2.5, 47.5), L(-2.5, 47.5, -2.5, 80.8), L(-2.5, 80.8, -0.6, 80.8), L(-0.6, 80.8, 0.6, 80.8, true), // outside perimeter to L04 (plan hypothesis)
];

/** Where lots wait in each area (WIP shelf in front of the machines). */
export const RACKS: Record<string, P2> = {
  L01: { x: 41.5, z: 83.3 }, L04: { x: 11.2, z: 83.2 }, E01: { x: 8.4, z: 39.1 },
  P01A: { x: 7.5, z: 59.3 }, P01B: { x: 21.5, z: 59.3 }, P01C: { x: 34, z: 59.3 }, P01D: { x: 46, z: 59.3 }, P01E: { x: 59.6, z: 59.3 }, P01F: { x: 73.5, z: 59.3 },
  P02A: { x: 85, z: 59.3 }, P02B: { x: 95, z: 59.3 }, P02C: { x: 105, z: 59.3 }, P02D: { x: 115, z: 59.3 },
  L05: { x: 30, z: 32.3 }, Q01: { x: 50, z: 32.3 }, T02: { x: 70, z: 32.3 }, T01: { x: 90, z: 32.3 }, P03: { x: 106, z: 32.3 },
};

/** Receiving dock (lots released into the plant) and the fleet's starting points. */
export const DOCK_IN: P2 = { x: 31, z: 87.5 };
export const PARKING: P2[] = [{ x: 40, z: 47.5 }, { x: 70, z: 47.5 }, { x: 30, z: 61.5 }, { x: 60, z: 35 }, { x: 45, z: 80.8 }, { x: 95, z: 61.5 }, { x: 20, z: 47.5 }, { x: 100, z: 35 }];
