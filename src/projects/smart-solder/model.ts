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
  /** PCBs per blank: 1 (a single board, e.g. a TV or notebook PCB) to 10. */
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
  /** Share of blanks that fail the pre-solder check (LED or spring missing or misplaced). */
  preNok: number;
  /** Manual stations, seconds per PCB: IR LEDs (blank on the pallet included) and springs. */
  ledS: number;
  springS: number;
  /** The three soldering cells (or cartesian robots) on/off. */
  cells: boolean[];
}

export const DEFAULT_SOLDER: SolderParams = {
  boards: 6, points: 10, pointS: 2.5, alignS: 3, target: 350, nok: 0.015, inconclusive: 0.005, preNok: 0.02, ledS: 4, springS: 4, cells: [true, true, true],
};
/** NOK share when "Simular NOK" is on. */
export const NOK_HIGH = 0.08;
/** Pre-solder NOK share (of blanks) when "Simular NOK" is on. */
export const PRE_NOK_HIGH = 0.12;

/** Limits of the parameters form. */
export const LIMITS = { boards: [1, 10], points: [1, 100], pointS: [1.5, 8], alignS: [1, 10], target: [50, 1000], nok: [0, 30], preNok: [0, 30], ledS: [1, 15], springS: [1, 15] } as const;

// ---------- line layout (metres; the line runs along +x at z = 0) ----------
export const LINE = { x0: -5.6, x1: 4.45, top: 0.9, beltW: 0.5, speed: 0.35, gap: 0.55, retTop: 0.38 };
/** Stop positions on the main line. */
export const ST = { load: -4.85, spring: -4.05, pre: -3.2, buffer: -2.0, post: 2.95, divert: 3.55 };
/** NOK branch: a short conveyor leaves the main line at ST.divert toward the back, with a buffer of up to `cap` pallets
 *  ending on a lift (the operator unloads the blank there); the empty pallet comes back under it to the return belt. */
export const SPUR = { z0: -0.3, lift: -2.3, end: -2.55, cap: 4 };
/** Architecture B: the three cells along the line. */
export const CELLS_B = [-1.3, 0, 1.3];
/** Architecture A: the cobot takes the blank at PICK and puts the soldered one back at PLACE. */
export const A = { pick: -0.85, place: 0.85 };
/** Architecture A: the cartesians stand in a row behind the line, the arm in front of it. */
export const A_ROW = { x: [-0.7, 0, 0.7], z: -0.64, robotZ: 0.56 };
/** Pallet and PCB sizes. */
export const PALLET = { l: 0.44, h: 0.03, d: 0.38 };
export const PCB = { l: 0.16, w: 0.045, t: 0.0016, pitch: 0.05, rail: 0.015 };
/** Blank conveyor after the line: sorter and UnLoader. */
/** Blank conveyor, starting right at the end lift of the main line, to the UnLoader. */
export const OUT = { x0: 4.5, x1: 5.9, top: 0.95, speed: 0.25 };
export const MAGAZINE = { slots: 20 };

// ---------- blank geometry ----------
/** Blank: PCBs in two columns (long side along x), rails around; a single PCB sits alone in a one-column blank. */
export const blankCols = (boards: number) => (boards === 1 ? 1 : 2);
/** Room for the blank on the pallet (the adaptable nest), and the gap between PCBs in a blank. */
export const PALLET_FIT = { l: 0.42, w: 0.36 };
const GAP = 0.005;
/** Joint spacing: 9 mm wanted, down to 5 mm when the blank would not fit the pallet otherwise. */
export const JOINT_PITCH = { want: 0.009, min: 0.005 };

export interface PcbSize {
  /** PCB length (x) and width (z), metres. */
  l: number; w: number;
  /** Spacing of the extra joints and how many fit in one row of them. */
  pitch: number; perRow: number;
  /** False when even at the minimum spacing the blank is larger than the pallet. */
  fits: boolean;
  /** Several PCBs per blank: the remote control PCB, fixed size and joint pattern. */
  fixed: boolean;
}

/**
 * PCB size. With several PCBs per blank it is the remote control PCB (160 × 45 mm), always. A single PCB per blank
 * (a TV or notebook board) grows with its joints: beyond the 4 LED and spring joints, the others go in rows across the
 * middle, the PCB gets wider and then longer, up to the size of the pallet.
 */
export function pcbSize(boards: number, points: number): PcbSize {
  if (boards > 1) return { l: PCB.l, w: PCB.w, pitch: 0, perRow: 0, fits: true, fixed: true };
  const rest = Math.max(0, points - 4);
  const maxL = PALLET_FIT.l - 2 * PCB.rail, maxW = PALLET_FIT.w - 2 * PCB.rail;
  const perRow = (l: number, p: number) => Math.max(1, Math.floor((l - 0.06) / p) + 1);
  const width = (l: number, p: number) => Math.max(PCB.w, Math.ceil(rest / perRow(l, p)) * p + 0.016);
  let last: PcbSize | null = null;
  for (let p = JOINT_PITCH.want; p >= JOINT_PITCH.min - 1e-9; p -= 0.001) {
    let l = PCB.l, w = width(l, p);
    while (w > maxW && l < maxL - 1e-9) { l = Math.min(maxL, l + 0.02); w = width(l, p); }
    last = { l, w, pitch: p, perRow: perRow(l, p), fits: w <= maxW + 1e-9, fixed: false };
    if (last.fits) return last;
  }
  return last!;
}

export function blankSize(boards: number, points = 10) {
  const pcb = pcbSize(boards, points), cols = blankCols(boards), rows = Math.ceil(boards / cols);
  const w = pcb.fixed ? rows * PCB.pitch + 2 * PCB.rail : rows * (pcb.w + GAP) - GAP + 2 * PCB.rail;
  return { l: cols * pcb.l + (cols + 1) * PCB.rail, w, rows, pcb };
}

/** Centre of each PCB in the blank (x along the blank, z across). */
export function boardCenters(boards: number, points = 10): { x: number; z: number; flip: boolean }[] {
  const { rows, pcb } = blankSize(boards, points);
  const out: { x: number; z: number; flip: boolean }[] = [];
  for (let i = 0; i < boards; i++) {
    if (blankCols(boards) === 1) { out.push({ x: 0, z: 0, flip: false }); continue; }
    const row = Math.floor(i / 2), col = i % 2;
    out.push({ x: (col ? 1 : -1) * (pcb.l / 2 + PCB.rail / 2), z: (row - (rows - 1) / 2) * PCB.pitch, flip: col === 0 });
  }
  return out;
}

/** Joint pattern on one PCB (local, LED end at +x): LED legs, spring tabs, then the other through-hole pins in rows. */
export function boardJoints(points: number, pcb: PcbSize = pcbSize(2, points)): { x: number; z: number }[] {
  if (pcb.fixed) { // remote control PCB: the extra joints share the middle of the board
    const out = [{ x: 0.068, z: -0.0025 }, { x: 0.068, z: 0.0025 }, { x: -0.06, z: -0.013 }, { x: -0.06, z: 0.013 }];
    const rest = points - 4;
    for (let k = 0; k < rest; k++) out.push({ x: -0.035 + (0.085 * (k + 0.5)) / Math.max(1, rest), z: k % 2 ? 0.011 : -0.011 });
    return out.slice(0, points);
  }
  const { l, w, pitch, perRow } = pcb, tab = Math.min(0.013, w / 2 - 0.006);
  const out = [{ x: l / 2 - 0.012, z: -0.0025 }, { x: l / 2 - 0.012, z: 0.0025 }, { x: -l / 2 + 0.02, z: -tab }, { x: -l / 2 + 0.02, z: tab }];
  const rest = Math.max(0, points - 4), rows = Math.ceil(rest / perRow);
  for (let k = 0; k < rest; k++) {
    const r = Math.floor(k / perRow), c = k % perRow, inRow = Math.min(perRow, rest - r * perRow);
    const span = (inRow - 1) * pitch; // each row centred along the PCB
    out.push({ x: -span / 2 + c * pitch + 0.005, z: (r - (rows - 1) / 2) * pitch });
  }
  return out.slice(0, points);
}

/**
 * Every joint of a blank in soldering order (blank local coordinates): board by board in a snake, so the tool only
 * makes short moves. `board` tells which PCB the joint belongs to.
 */
export function blankJoints(boards: number, points: number): { x: number; z: number; board: number }[] {
  const pcb = pcbSize(boards, points);
  const centers = boardCenters(boards, points), joints = boardJoints(points, pcb), out: { x: number; z: number; board: number }[] = [];
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
