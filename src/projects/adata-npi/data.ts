// NPI platform prototype: data model, sample data and the rules of the release workflow. Pure functions (no DOM).
//
// A new product (part number) goes through: registration → process route → recipes (versioned) → work
// instructions → pilot lot → Quality approval → release to the MES. Nothing is released while a recipe or an
// instruction is still a draft, or while the pilot lot has not met its criteria.
//
// SAMPLE DATA: part numbers, parameters and people are illustrative, not client data.
import { FAMILY_INFO, STEPS, type Family } from '../memory-flow/process';

export type Status = 'rascunho' | 'em-aprovacao' | 'aprovado';
export type Stage = 'cadastro' | 'rota' | 'receitas' | 'instrucoes' | 'piloto' | 'aprovacao' | 'liberado';
export const STAGES: { id: Stage; name: string }[] = [
  { id: 'cadastro', name: 'Cadastro' }, { id: 'rota', name: 'Rota' }, { id: 'receitas', name: 'Receitas' },
  { id: 'instrucoes', name: 'Instruções' }, { id: 'piloto', name: 'Lote piloto' }, { id: 'aprovacao', name: 'Aprovação' },
  { id: 'liberado', name: 'Liberado no MES' },
];

export interface Param { key: string; name: string; unit: string; value: number; min: number; max: number }
export interface RecipeVersion { v: number; params: Param[]; status: Status; author: string; date: string; note: string; approvedBy?: string }
export interface Recipe { step: string; versions: RecipeVersion[] }
export interface Instruction { step: string; title: string; rev: number; status: Status; checks: string[] }
export interface PilotLot { lot: string; wafers: number; yieldTarget: number; yield: number | null; checks: { name: string; done: boolean }[] }
export interface HistoryItem { date: string; who: string; what: string }
export interface Product {
  pn: string; name: string; family: Family; pkg: string; rev: string;
  route: string[]; recipes: Recipe[]; instructions: Instruction[]; pilot: PilotLot; history: HistoryItem[];
  released: boolean;
}

/** Steps a family goes through (burn-in only for DRAM), in route order. */
export const routeFor = (f: Family) => STEPS.filter(s => !s.only || s.only(f)).map(s => s.key);
export const stepName = (key: string) => STEPS.find(s => s.key === key)?.name ?? key;
export const stepArea = (key: string) => STEPS.find(s => s.key === key)?.area ?? '';

/** Recipe templates for the steps that have process parameters. */
const TEMPLATES: Record<string, Omit<Param, 'value'>[]> = {
  BGR: [{ key: 'esp', name: 'Espessura final', unit: 'µm', min: 50, max: 400 }, { key: 'rot', name: 'Rotação do rebolo', unit: 'rpm', min: 1000, max: 6000 }, { key: 'av', name: 'Avanço', unit: 'µm/s', min: 0.1, max: 5 }],
  DIC: [{ key: 'vel', name: 'Velocidade de corte', unit: 'mm/s', min: 5, max: 300 }, { key: 'pot', name: 'Potência do laser', unit: 'W', min: 0.5, max: 10 }, { key: 'prof', name: 'Profundidade', unit: 'µm', min: 10, max: 400 }],
  DAB: [{ key: 'forca', name: 'Força de colagem', unit: 'N', min: 1, max: 50 }, { key: 'temp', name: 'Temperatura', unit: '°C', min: 25, max: 200 }, { key: 'tempo', name: 'Tempo', unit: 'ms', min: 50, max: 2000 }],
  WB: [{ key: 'us', name: 'Potência ultrassônica', unit: 'mW', min: 20, max: 200 }, { key: 'forca', name: 'Força de bonding', unit: 'gf', min: 5, max: 60 }, { key: 'loop', name: 'Altura do loop', unit: 'µm', min: 60, max: 300 }],
  MLD: [{ key: 'temp', name: 'Temperatura do molde', unit: '°C', min: 150, max: 200 }, { key: 'press', name: 'Pressão de transferência', unit: 'MPa', min: 3, max: 15 }, { key: 'cura', name: 'Tempo de cura', unit: 's', min: 60, max: 240 }],
  RFL: [{ key: 'pico', name: 'Temperatura de pico', unit: '°C', min: 220, max: 260 }, { key: 'tal', name: 'Tempo acima do líquido', unit: 's', min: 30, max: 120 }, { key: 'n2', name: 'Oxigênio residual', unit: 'ppm', min: 50, max: 1000 }],
  ATE: [{ key: 'vdd', name: 'Tensão VDD', unit: 'V', min: 1.0, max: 1.4 }, { key: 'freq', name: 'Frequência de teste', unit: 'MT/s', min: 1600, max: 8000 }, { key: 'temp', name: 'Temperatura', unit: '°C', min: -40, max: 125 }],
  BIN: [{ key: 'temp', name: 'Temperatura', unit: '°C', min: 85, max: 150 }, { key: 'horas', name: 'Duração', unit: 'h', min: 1, max: 48 }, { key: 'vdd', name: 'Tensão de estresse', unit: 'V', min: 1.1, max: 1.6 }],
};
const DEFAULTS: Record<string, number[]> = {
  BGR: [100, 4000, 1.2], DIC: [80, 3.5, 100], DAB: [12, 140, 400], WB: [90, 25, 150], MLD: [175, 8, 120],
  RFL: [245, 60, 300], ATE: [1.2, 3200, 25], BIN: [125, 8, 1.35],
};
export const RECIPE_STEPS = Object.keys(TEMPLATES);

function recipe(step: string, values: number[], status: Status, author: string, date: string): Recipe {
  const params = TEMPLATES[step].map((t, i) => ({ ...t, value: values[i] }));
  return { step, versions: [{ v: 1, params, status, author, date, note: 'Versão inicial', approvedBy: status === 'aprovado' ? 'Qualidade · M. Souza' : undefined }] };
}

const INSTR: Record<string, [string, string[]]> = {
  BGR: ['Afinamento do wafer', ['Conferir espessura inicial', 'Montar fita de proteção', 'Medir espessura final em 5 pontos']],
  DIC: ['Corte do wafer', ['Conferir mapa do wafer', 'Alinhar ruas de corte', 'Inspecionar 5 dies após o primeiro corte']],
  DAB: ['Die attach', ['Conferir lote de adesivo', 'Verificar coplanaridade do die', 'Registrar força de cisalhamento da amostra']],
  WB: ['Wire bonding', ['Conferir capilar e fio', 'Teste de tração em 5 fios', 'Inspeção de loop no microscópio']],
  MLD: ['Moldagem', ['Pré-aquecer o composto', 'Conferir o molde', 'Inspecionar vazios no raio X']],
  ATE: ['Teste elétrico', ['Carregar programa de teste da revisão correta', 'Rodar unidade de referência', 'Conferir bins no MES']],
  EMB: ['Embalagem', ['Conferir MSL e dessecante', 'Verificar cartão de umidade', 'Conferir etiqueta com o lote']],
};

export function sampleProducts(): Product[] {
  const mk = (pn: string, name: string, family: Family, pkg: string, stage: 'liberado' | 'piloto' | 'receitas'): Product => {
    const route = routeFor(family);
    const recipes = RECIPE_STEPS.filter(s => route.includes(s)).map(s => {
      const base = DEFAULTS[s].map((v, i) => (family === 'DDR5' && s === 'ATE' && i === 1 ? 6400 : v));
      const status: Status = stage === 'receitas' && (s === 'WB' || s === 'MLD') ? 'rascunho' : 'aprovado';
      return recipe(s, base, status, 'Engenharia · R. Lima', '2026-10-02');
    });
    const instructions = Object.entries(INSTR).filter(([s]) => route.includes(s)).map(([s, [title, checks]]) => ({
      step: s, title, rev: 1, status: (stage === 'receitas' && s === 'ATE' ? 'rascunho' : 'aprovado') as Status, checks,
    }));
    const pilotDone = stage !== 'receitas';
    return {
      pn, name, family, pkg, rev: 'A', route, recipes, instructions, released: stage === 'liberado',
      pilot: {
        lot: `P${pn.slice(-4)}-01`, wafers: 5, yieldTarget: 0.95, yield: stage === 'liberado' ? 0.972 : stage === 'piloto' ? 0.958 : null,
        checks: [
          { name: 'Rota conferida com a engenharia', done: true },
          { name: 'Receitas carregadas nas máquinas', done: pilotDone },
          { name: 'Amostras de confiabilidade enviadas', done: pilotDone },
          { name: 'Rendimento acima da meta', done: stage !== 'receitas' },
        ],
      },
      history: [
        { date: '2026-09-15', who: 'Engenharia · R. Lima', what: 'Produto cadastrado' },
        { date: '2026-09-22', who: 'Engenharia · R. Lima', what: 'Rota definida' },
        ...(stage !== 'receitas' ? [{ date: '2026-10-20', who: 'Produção · A. Costa', what: 'Lote piloto concluído' }] : []),
        ...(stage === 'liberado' ? [{ date: '2026-11-04', who: 'Qualidade · M. Souza', what: 'Liberado no MES' }] : []),
      ],
    };
  };
  return [
    mk('ADT-D4-8G-0101', 'DDR4 8 Gb x8', 'DDR4', 'FBGA 78', 'liberado'),
    mk('ADT-D5-16G-0207', 'DDR5 16 Gb x8', 'DDR5', 'FBGA 82', 'piloto'),
    mk('ADT-EM-64G-0311', 'eMMC 64 GB', 'EMMC', 'FBGA 153', 'receitas'),
  ];
}

/** Current (latest) version of a recipe. */
export const current = (r: Recipe) => r.versions[r.versions.length - 1];
/** Latest approved version (the one the machines use), if any. */
export const inUse = (r: Recipe) => [...r.versions].reverse().find(v => v.status === 'aprovado') ?? null;

/** What blocks the release of a product, in workflow order. Empty: ready to release. */
export function blockers(p: Product): string[] {
  const out: string[] = [];
  if (!p.route.length) out.push('A rota está vazia.');
  for (const r of p.recipes) { const c = current(r); if (c.status !== 'aprovado') out.push(`Receita ${stepName(r.step)} v${c.v} ainda não aprovada.`); }
  for (const i of p.instructions) if (i.status !== 'aprovado') out.push(`Instrução "${i.title}" rev. ${i.rev} ainda não aprovada.`);
  for (const c of p.pilot.checks) if (!c.done) out.push(`Lote piloto: ${c.name.toLowerCase()}.`);
  if (p.pilot.yield == null) out.push('Lote piloto ainda sem rendimento.');
  else if (p.pilot.yield < p.pilot.yieldTarget) out.push('Rendimento do lote piloto abaixo da meta.');
  return out;
}

/** Workflow stage a product is at. */
export function stageOf(p: Product): Stage {
  if (p.released) return 'liberado';
  if (!p.route.length) return 'rota';
  if (p.recipes.some(r => current(r).status !== 'aprovado')) return 'receitas';
  if (p.instructions.some(i => i.status !== 'aprovado')) return 'instrucoes';
  if (p.pilot.yield == null || p.pilot.checks.some(c => !c.done) || p.pilot.yield < p.pilot.yieldTarget) return 'piloto';
  return 'aprovacao';
}

/** Change a parameter: edits the current draft, or opens a new draft version from the current one. */
export function editParam(r: Recipe, key: string, value: number, author: string, date: string): RecipeVersion {
  let c = current(r);
  if (c.status !== 'rascunho') {
    c = { v: c.v + 1, params: c.params.map(p => ({ ...p })), status: 'rascunho', author, date, note: '' };
    r.versions.push(c);
  }
  const p = c.params.find(x => x.key === key);
  if (!p) throw new Error(`unknown parameter ${key}`);
  p.value = value;
  return c;
}

/** Parameters that differ between two versions. */
export function diff(a: RecipeVersion, b: RecipeVersion) {
  return b.params.filter(p => a.params.find(q => q.key === p.key)?.value !== p.value).map(p => ({ key: p.key, name: p.name, unit: p.unit, from: a.params.find(q => q.key === p.key)!.value, to: p.value }));
}

/** Values out of the allowed range of a version. */
export const outOfRange = (v: RecipeVersion) => v.params.filter(p => p.value < p.min || p.value > p.max);

/** Provisional comparison: today (spreadsheets, e-mail, paper) × platform. */
export const COMPARE = [
  { name: 'Tempo até liberar um produto novo', today: '6 a 8 semanas', platform: '3 a 4 semanas' },
  { name: 'Onde ficam receitas e instruções', today: 'Planilhas e pastas por área', platform: 'Um cadastro, com versões' },
  { name: 'Receita errada na máquina', today: 'Possível (cópia manual)', platform: 'Bloqueada: só versão aprovada' },
  { name: 'Aprovações', today: 'E-mail e assinatura em papel', platform: 'Fluxo com registro de quem e quando' },
  { name: 'Histórico de mudanças', today: 'Disperso', platform: 'Completo, com diferença entre versões' },
];

export const familyName = (f: Family) => FAMILY_INFO[f].name;
