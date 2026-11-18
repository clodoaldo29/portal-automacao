// Smart Solder AI · Grupo Multi: shared model (no three.js) for both soldering architectures.
//
// The line (proposal, slides 10 and 11): straight and one-way, with pallets that return under it. Blank on the pallet,
// manual insertion of the IR LEDs and the battery springs, model identification and pre-solder inspection, robotic
// soldering in three cells working in parallel, post-solder inspection, manual removal of the blank, automatic NOK
// sorter, UnLoader into magazines and an AMR to assembly and test.
//
// PROVISIONAL: the documents leave the board models, solder points and times open. The values below are hypotheses
// for the study (a remote control board with ~10 points, 2.5 s per point with a robotic iron).

export type Arch = 'A' | 'B';

export interface SolderParams {
  /** PCBs per blank (the client: 4 to 10). */
  boards: number;
  /** Solder points per PCB. */
  points: number;
  /** Seconds per point: move to the joint, touch, feed the wire, lift. */
  pointS: number;
  /** Vision alignment (fiducials) per blank, approach and return included. */
  alignS: number;
  /** Target in PCBs per hour (proposal: 150 to 350 UPH). */
  target: number;
  /** Share of NOK and inconclusive PCBs at the post-solder inspection. */
  nok: number;
  inconclusive: number;
  /** Manual stations, seconds per PCB: IR LEDs (blank on the pallet included) and springs. */
  ledS: number;
  springS: number;
  /** The three soldering cells (or cartesian robots) on/off. */
  cells: boolean[];
}

export const DEFAULT_SOLDER: SolderParams = {
  boards: 6, points: 10, pointS: 2.5, alignS: 3, target: 350, nok: 0.015, inconclusive: 0.005, ledS: 4, springS: 4, cells: [true, true, true],
};
/** NOK share when "Simular NOK" is on. */
export const NOK_HIGH = 0.08;

/** Limits of the parameters form. */
export const LIMITS = { boards: [4, 10], points: [2, 30], pointS: [1.5, 8], alignS: [1, 10], target: [50, 1000], nok: [0, 30], ledS: [1, 15], springS: [1, 15] } as const;

// ---------- line layout (metres; the line runs along +x at z = 0) ----------
export const LINE = { x0: -7.6, x1: 5.0, top: 0.9, beltW: 0.5, speed: 0.35, gap: 0.55, retTop: 0.38 };
/** Stop positions on the main line. */
export const ST = { load: -6.6, spring: -5.5, pre: -4.3, buffer: -2.6, post: 3.3, removal: 4.4 };
/** Architecture B: the three cells along the line. */
export const CELLS_B = [-1.3, 0, 1.3];
/** Architecture A: the cobot takes the blank at PICK and puts the soldered one back at PLACE. */
export const A = { pick: -0.85, place: 0.85 };
/** Pallet and PCB sizes. */
export const PALLET = { l: 0.44, h: 0.03, d: 0.38 };
export const PCB = { l: 0.16, w: 0.045, t: 0.0016, pitch: 0.05, rail: 0.015 };
/** Blank conveyor after the line: sorter and UnLoader. */
export const OUT = { x0: 5.45, x1: 8.0, top: 0.95, speed: 0.25, sorter: 6.5, unloader: 7.6 };
export const MAGAZINE = { slots: 20 };

// ---------- blank geometry ----------
/** Blank: PCBs in two columns (long side along x), rails around. */
export function blankSize(boards: number) {
  const rows = Math.ceil(boards / 2);
  return { l: 2 * PCB.l + 3 * PCB.rail, w: rows * PCB.pitch + 2 * PCB.rail, rows };
}

/** Centre of each PCB in the blank (x along the blank, z across). */
export function boardCenters(boards: number): { x: number; z: number; flip: boolean }[] {
  const { rows } = blankSize(boards);
  const out: { x: number; z: number; flip: boolean }[] = [];
  for (let i = 0; i < boards; i++) {
    const row = Math.floor(i / 2), col = i % 2;
    out.push({ x: (col ? 1 : -1) * (PCB.l / 2 + PCB.rail / 2), z: (row - (rows - 1) / 2) * PCB.pitch, flip: col === 0 });
  }
  return out;
}

/** Joint pattern on one PCB (local, LED end at +x): LED legs, spring tabs, then the other through-hole pins. */
export function boardJoints(points: number): { x: number; z: number }[] {
  const out = [{ x: 0.068, z: -0.0025 }, { x: 0.068, z: 0.0025 }, { x: -0.06, z: -0.013 }, { x: -0.06, z: 0.013 }];
  const rest = points - 4;
  for (let k = 0; k < rest; k++) out.push({ x: -0.035 + (0.085 * (k + 0.5)) / Math.max(1, rest), z: k % 2 ? 0.011 : -0.011 });
  return out.slice(0, points);
}

/**
 * Every joint of a blank in soldering order (blank local coordinates): board by board in a snake, so the tool only
 * makes short moves. `board` tells which PCB the joint belongs to.
 */
export function blankJoints(boards: number, points: number): { x: number; z: number; board: number }[] {
  const centers = boardCenters(boards), joints = boardJoints(points), out: { x: number; z: number; board: number }[] = [];
  const order: number[] = [];
  const rows = Math.ceil(boards / 2);
  for (let r = 0; r < rows; r++) for (const c of r % 2 ? [1, 0] : [0, 1]) { const i = r * 2 + c; if (i < boards) order.push(i); }
  for (const b of order) {
    const c = centers[b], s = c.flip ? -1 : 1;
    const js = joints.map(j => ({ x: c.x + s * j.x, z: c.z + j.z }));
    if (c.flip) js.reverse();
    js.forEach(j => out.push({ ...j, board: b }));
  }
  return out;
}

// ---------- capacity ----------
export const activeCells = (p: SolderParams) => p.cells.filter(Boolean).length;
/** Soldering time of one blank (all its joints). */
export const solderS = (p: SolderParams) => p.boards * p.points * p.pointS;
/** One cell soldering a whole blank: alignment plus every joint. */
export const blankS = (p: SolderParams) => solderS(p) + p.alignS;

/** Architecture B, a group of n pallets: the first one rides from the buffer stop to the farthest active cell. */
export function groupIndexS(p: SolderParams) {
  const far = Math.max(...CELLS_B.filter((_, i) => p.cells[i]));
  return (far - ST.buffer) / LINE.speed;
}

export interface Strategy { id: string; name: string; how: string; cycle: number; uph: number; share: number[] }

/**
 * Ways to share the work among the three cells of architecture B on a straight line (no bypass):
 * - group of 3: three pallets go in together, each cell solders a whole blank, all three at the same time;
 * - series: each pallet stops at every cell, and each cell solders a third of the joints.
 * Both load the robots equally; the group pays the alignment and the pallet move once per robot and per blank.
 */
export function strategiesB(p: SolderParams): Strategy[] {
  const n = Math.max(1, activeCells(p)), share = p.cells.map(on => (on ? 1 / n : 0));
  const group = blankS(p) + groupIndexS(p);
  const pitch = n > 1 ? (CELLS_B[2] - CELLS_B[0]) / 2 : 0;
  const series = solderS(p) / n + p.alignS + pitch / LINE.speed;
  return [
    { id: 'lote', name: `Lote de ${n}`, how: 'cada robô solda um blank inteiro, os três ao mesmo tempo', cycle: group / n, uph: (n * p.boards * 3600) / group, share },
    { id: 'serie', name: 'Em série', how: `cada robô solda 1/${n} dos pontos de cada blank`, cycle: series, uph: (p.boards * 3600) / series, share },
  ];
}

/**
 * Architecture A, measured in the simulation (default layout): seconds a cartesian waits while the arm takes its
 * soldered blank to the pallet and brings the next one (plus the frame rounding of its moves), and the arm's time per
 * blank (both transfers).
 */
export const A_SWAP_S = 15.5;
export const A_COBOT_S = 12;

/**
 * Architecture A: the cobot feeds the three cartesian robots in turn (round-robin), so each one solders one blank in
 * three. The line rate is the cartesians' rate unless the cobot cannot keep up.
 */
export function capacityA(p: SolderParams) {
  const n = Math.max(1, activeCells(p));
  const cellCycle = blankS(p) + A_SWAP_S;
  const cellsUph = (n * p.boards * 3600) / cellCycle, cobotUph = (p.boards * 3600) / A_COBOT_S;
  return { cellCycle, cellsUph, cobotUph, uph: Math.min(cellsUph, cobotUph), cobotLoad: Math.min(1, (n * A_COBOT_S) / cellCycle), bottleneck: cobotUph < cellsUph ? 'cobot' : 'cartesianos' };
}

/** Manual stations: capacity in PCBs per hour. */
export const manualUph = (p: SolderParams) => ({
  led: 3600 / (p.ledS + 3 / p.boards),
  spring: 3600 / p.springS,
});
/** Seconds at the manual stations per blank. */
export const ledStationS = (p: SolderParams) => 3 + p.boards * p.ledS;
export const springStationS = (p: SolderParams) => p.boards * p.springS;
