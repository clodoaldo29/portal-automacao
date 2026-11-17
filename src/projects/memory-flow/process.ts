// Process model: product families, the route of a lot through the plant, cycle times and the three scenarios.
//
// EVERY NUMBER HERE IS PROVISIONAL. The documents give the sequence of operations, the areas and the equipment
// count, but no cycle times, lot sizes or mix. Values below are typical orders of magnitude for memory assembly
// and test, chosen so the default release reproduces the plan's historical capacity (~5 million chips/month).
// They are all editable in the Parameters tab and must be replaced by the client's data.

export type Family = 'DDR4' | 'DDR5' | 'NAND' | 'EMMC' | 'MCP';
export const FAMILIES: Family[] = ['DDR4', 'DDR5', 'NAND', 'EMMC', 'MCP'];

export const FAMILY_INFO: Record<Family, { name: string; color: number; chipsPerWafer: number; attach: number; bond: number; burnIn: boolean }> = {
  // chipsPerWafer: finished packages per wafer (dies per wafer ÷ dies per package × yield)
  // attach / bond: time factors for die attach (stacked dies) and wire bonding (wires per package)
  DDR4: { name: 'DDR4', color: 0x2f7fd8, chipsPerWafer: 1000, attach: 1, bond: 1, burnIn: true },
  DDR5: { name: 'DDR5', color: 0x14b8a6, chipsPerWafer: 700, attach: 1, bond: 1, burnIn: true },
  NAND: { name: 'NAND (SSD)', color: 0xf59e0b, chipsPerWafer: 150, attach: 2, bond: 1.5, burnIn: false },
  EMMC: { name: 'eMMC / UFS', color: 0xe0527a, chipsPerWafer: 150, attach: 2, bond: 1.5, burnIn: false },
  MCP: { name: 'MCP / uMCP', color: 0x8b5cf6, chipsPerWafer: 120, attach: 2.5, bond: 2, burnIn: false },
};

/** Wafers per lot. */
export const WAFERS_PER_LOT = 25;

export interface StepDef {
  key: string;
  name: string;
  /** Macro-step of the process sheet (01 Preparação … 08 Embalagem), for grouping in the panel. */
  stage: number;
  area: string;
  /** Machine tags in that area. Empty: a buffer with no machine (lots just dwell there). */
  tags: string[];
  /** Equipment that works as one cell with each machine (ATE + handler), same order as tags. */
  linked?: string[];
  /** Minutes per lot on one machine (25 wafers). */
  minutes: number;
  /** Lots one machine holds at once (batch ovens). */
  slots?: number;
  /** Time factor by family. */
  factor?: 'attach' | 'bond';
  /** Only these families go through this step. */
  only?: (f: Family) => boolean;
}

export const STAGES = ['', 'Preparação', 'Corte', 'Inspeção', 'Montagem', 'Interconexão', 'Encapsulamento', 'Teste', 'Embalagem'];

export const STEPS: StepDef[] = [
  { key: 'REC', name: 'Recebimento e inspeção de entrada', stage: 1, area: 'L01', tags: ['INS01', 'INS02'], minutes: 20 },
  { key: 'ETQ', name: 'Etiqueta de lote', stage: 1, area: 'L01', tags: ['ETQ01', 'ETQ02'], minutes: 10 },
  { key: 'MAP', name: 'Mapa do wafer', stage: 1, area: 'P01A', tags: ['WTR01', 'WTR02', 'MAP01', 'MAP02'], minutes: 20 },
  { key: 'BGR', name: 'Afinamento (backgrinding)', stage: 1, area: 'P01B', tags: ['BGR01', 'BGR02'], minutes: 100 },
  { key: 'MNT', name: 'Filme, fita e anel', stage: 1, area: 'P01B', tags: ['MNT01', 'MNT02'], minutes: 40 },
  { key: 'DIC', name: 'Corte (laser ou disco)', stage: 2, area: 'P01C', tags: ['DIC01', 'DIC02', 'DIC03', 'DIC04'], minutes: 150 },
  { key: 'LAV', name: 'Limpeza e secagem', stage: 3, area: 'P01B', tags: ['LAV01', 'LAV02'], minutes: 40 },
  { key: 'INS', name: 'Inspeção pós-corte', stage: 3, area: 'P01C', tags: ['INS01', 'INS02'], minutes: 150 },
  { key: 'DAB', name: 'Die attach e empilhamento', stage: 4, area: 'P01D', tags: ['DAB01', 'DAB02', 'DAB03', 'DAB04', 'DAB05', 'DAB06'], minutes: 240, factor: 'attach' },
  { key: 'PLS', name: 'Plasma', stage: 4, area: 'P01D', tags: ['PLS01', 'PLS02'], minutes: 30 },
  { key: 'CUR', name: 'Cura em forno', stage: 4, area: 'P01D', tags: ['CUR01', 'CUR02', 'CUR03'], minutes: 120, slots: 4 },
  { key: 'WB', name: 'Wire bonding', stage: 5, area: 'P01E', tags: ['WB01', 'WB02', 'WB03', 'WB04', 'WB05', 'WB06', 'WB07', 'WB08', 'WB09', 'WB10', 'WB11', 'WB12', 'WB13', 'WB14'], minutes: 600, factor: 'bond' },
  { key: 'INW', name: 'Inspeção pós-bonding', stage: 5, area: 'P01E', tags: ['INS01', 'INS02'], minutes: 50 },
  { key: 'AOI', name: 'AOI', stage: 5, area: 'P01F', tags: ['AOI01', 'AOI02'], minutes: 40 },
  { key: 'MET', name: 'Metrologia', stage: 5, area: 'P01F', tags: ['MET01', 'MET02'], minutes: 30 },
  { key: 'MLD', name: 'Moldagem', stage: 6, area: 'P02A', tags: ['MLD01', 'MLD02', 'MLD03', 'MLD04'], minutes: 120 },
  { key: 'PMC', name: 'Pós-cura', stage: 6, area: 'P02A', tags: ['PMC01', 'PMC02', 'PMC03'], minutes: 240, slots: 4 },
  { key: 'BAL', name: 'Esferas de solda', stage: 6, area: 'P02B', tags: ['BAL01', 'BAL02', 'BAL03'], minutes: 90 },
  { key: 'RFL', name: 'Refusão', stage: 6, area: 'P02B', tags: ['RFL01', 'RFL02'], minutes: 45 },
  { key: 'DFL', name: 'Limpeza de fluxo', stage: 6, area: 'P02B', tags: ['DFL01', 'DFL02'], minutes: 40 },
  { key: 'MRK', name: 'Marcação a laser', stage: 6, area: 'P02C', tags: ['LAS01', 'LAS02'], minutes: 60 },
  { key: 'LVC', name: 'Limpeza', stage: 6, area: 'P02C', tags: ['LAV01', 'LAV02'], minutes: 30 },
  { key: 'XRA', name: 'Raio X e AOI', stage: 6, area: 'P02D', tags: ['XRY01', 'XRY02', 'AOI01', 'AOI02'], minutes: 50 },
  { key: 'SNG', name: 'Singulação', stage: 6, area: 'P03', tags: ['TRM01', 'TRM02', 'TRM03', 'TRM04', 'LAS01', 'LAS02'], minutes: 90 },
  { key: 'LVP', name: 'Lavagem', stage: 6, area: 'P03', tags: ['LAV01', 'LAV02'], minutes: 30 },
  { key: 'SRT', name: 'Classificação em bandejas', stage: 6, area: 'P03', tags: ['SOR01', 'SOR02', 'SOR03'], minutes: 60 },
  { key: 'ATE', name: 'Teste elétrico (ATE + handler)', stage: 7, area: 'T01', tags: ['ATE01', 'ATE02', 'ATE03', 'ATE04', 'ATE05', 'ATE06'], linked: ['HDL01', 'HDL02', 'HDL03', 'HDL04', 'HDL05', 'HDL06'], minutes: 300 },
  { key: 'FCT', name: 'Teste funcional', stage: 7, area: 'T01', tags: ['FCT01', 'FCT02'], minutes: 100 },
  { key: 'BIN', name: 'Burn-in (só DRAM)', stage: 7, area: 'T02', tags: ['BIN01', 'BIN02', 'BIN03', 'BIN04', 'BIN05', 'BIN06'], minutes: 480, slots: 4, only: f => FAMILY_INFO[f].burnIn },
  { key: 'QAO', name: 'Inspeção final', stage: 7, area: 'Q01', tags: ['AOI01', 'AOI02', 'AOI03'], minutes: 40 },
  { key: 'EMB', name: 'Bandejas e barreira à umidade', stage: 8, area: 'L05', tags: ['EMB01', 'EMB02'], minutes: 60 },
  { key: 'SER', name: 'Serialização e etiquetas', stage: 8, area: 'L05', tags: ['SER01', 'SER02'], minutes: 30 },
  { key: 'CNF', name: 'Conferência', stage: 8, area: 'L05', tags: ['CNF01', 'CNF02'], minutes: 20 },
  { key: 'E01', name: 'Buffer de produto acabado (FIFO)', stage: 8, area: 'E01', tags: [], minutes: 60 },
  { key: 'EXP', name: 'Conferência e expedição', stage: 8, area: 'L04', tags: ['CNF01', 'CNF02'], minutes: 20 },
];

/** Post-dicing inspection time with automatic AI vision (the "Visão" front), minutes per lot. */
export const INS_AI_MINUTES = 40;

// ---------------------------------------------------------------------------------------------------------------
// Fleets and scenarios

export interface FleetSpec {
  kind: 'manual' | 'amr';
  count: number;
  /** Travel speed, m/s. */
  speed: number;
  /** Minutes to load and to unload a lot. */
  load: number;
  unload: number;
  /** Minutes of record keeping after each move (paper checklist + manual system entry). */
  record: number;
  /** Extra minutes to cross a door or pass box. */
  door: number;
  /**
   * Share of an operator's time available for moving material (they also run machines). After each move the
   * operator spends (move time) × (1 − share) / share on other tasks. 1 for AMRs.
   */
  share: number;
  /** Dispatching: oldest request first, or lots for idle machines first. */
  dispatch: 'fifo' | 'starving';
}

export type ScenarioId = 'atual' | 'amr' | 'amr-ia';
export const SCENARIOS: { id: ScenarioId; name: string; short: string }[] = [
  { id: 'atual', name: 'Atual: movimentação manual', short: 'Atual' },
  { id: 'amr', name: 'Proposto: AMR e despacho coordenado', short: 'AMR' },
  { id: 'amr-ia', name: 'Proposto: AMR + inspeção com IA', short: 'AMR + IA' },
];

export interface Params {
  /** Lots released per day at the receiving dock. */
  release: number;
  /** Family mix, percent (normalised when used). */
  mix: Record<Family, number>;
  /** Manual handling: operators, share of time on material moves, record minutes per move. */
  operators: number;
  share: number;
  record: number;
  /** AMR fleet size. */
  amrs: number;
  /** Machine availability (share of time not stopped by failures) and mean repair time in minutes. */
  avail: number;
  mttr: number;
  /** Cycle time overrides by step key, minutes per lot. */
  minutes: Record<string, number>;
  /** AI inspection minutes per lot. */
  insAi: number;
}

export const DEFAULT_PARAMS: Params = {
  release: 13.5,
  mix: { DDR4: 25, DDR5: 25, NAND: 20, EMMC: 15, MCP: 15 },
  operators: 8,
  share: 0.6,
  record: 3,
  amrs: 3,
  avail: 0.92,
  mttr: 120,
  minutes: {},
  insAi: INS_AI_MINUTES,
};

export function cloneParams(p: Params): Params {
  return { ...p, mix: { ...p.mix }, minutes: { ...p.minutes } };
}

/** Fleet and inspection mode of a scenario. */
export function scenarioSetup(id: ScenarioId, p: Params): { fleet: FleetSpec; aiInspection: boolean } {
  if (id === 'atual') {
    return { fleet: { kind: 'manual', count: p.operators, speed: 0.8, load: 2, unload: 2, record: p.record, door: 3, share: p.share, dispatch: 'fifo' }, aiInspection: false };
  }
  return { fleet: { kind: 'amr', count: p.amrs, speed: 1.0, load: 0.5, unload: 0.5, record: 0, door: 1, share: 1, dispatch: 'starving' }, aiInspection: id === 'amr-ia' };
}

/** Cycle time of a step for the scenario (overrides, then AI inspection). */
export function stepMinutes(s: StepDef, p: Params, aiInspection: boolean): number {
  if (s.key === 'INS' && aiInspection) return p.insAi;
  return p.minutes[s.key] ?? s.minutes;
}

/** Average chips per wafer for a mix. */
export function chipsPerWafer(mix: Record<Family, number>): number {
  const tot = FAMILIES.reduce((s, f) => s + Math.max(0, mix[f]), 0) || 1;
  return FAMILIES.reduce((s, f) => s + (Math.max(0, mix[f]) / tot) * FAMILY_INFO[f].chipsPerWafer, 0);
}
