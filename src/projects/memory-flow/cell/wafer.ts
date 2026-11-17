// Die map of a diced 300 mm wafer and the post-dicing defects the AI inspection classifies.
// Pure functions (no DOM, no three.js); every map comes from a seed, so runs repeat exactly.
//
// PROVISIONAL: die size, defect rates and the rejection rule are orders of magnitude for memory dies, chosen to
// make the cell behave plausibly. Replace them with the client's defect history (classes, rates, criteria).
import { createRng } from '../../../sim/des';

export const WAFER_MM = 300;
/** Edge exclusion: dies must lie inside this radius (mm). */
export const USABLE_R = 147;
export const DIE_W = 8.4, DIE_H = 9.6;

export type DefectClass = 0 | 1 | 2 | 3 | 4;
export const CLASSES: { name: string; color: string }[] = [
  { name: 'OK', color: '#2dd4bf' },
  { name: 'Trinca', color: '#ef4444' },
  { name: 'Lascamento', color: '#f59e0b' },
  { name: 'Contaminação', color: '#a78bfa' },
  { name: 'Risco', color: '#f472b6' },
];

export interface Die {
  /** Centre in mm, wafer centre at the origin (x to the right, y down). */
  x: number;
  y: number;
  /** In the outer ring: chipping concentrates there. */
  edge: boolean;
  cls: DefectClass;
  /** Low-confidence call sent to human review. */
  review: boolean;
}

export interface WaferMap {
  dies: Die[];
  counts: [number, number, number, number, number];
  defects: number;
  review: number;
  /** Good dies ÷ dies. */
  yield: number;
  ng: boolean;
}

/** Defect rates. 'worn' simulates a worn dicing blade: much more chipping and some extra cracks. */
export const RATES = {
  normal: { crack: 0.0004, chipEdge: 0.02, chipIn: 0.001, contam: 0.005, scratchWafer: 0.06 },
  worn: { crack: 0.004, chipEdge: 0.15, chipIn: 0.015, contam: 0.005, scratchWafer: 0.06 },
};

/** Die grid inside the usable radius (same for every wafer). */
export const DIE_GRID: { x: number; y: number; edge: boolean }[] = (() => {
  const out: { x: number; y: number; edge: boolean }[] = [];
  const nx = Math.ceil(WAFER_MM / DIE_W), ny = Math.ceil(WAFER_MM / DIE_H);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = (i - nx / 2 + 0.5) * DIE_W, y = (j - ny / 2 + 0.5) * DIE_H;
    const far = Math.hypot(Math.abs(x) + DIE_W / 2, Math.abs(y) + DIE_H / 2);
    if (far <= USABLE_R) out.push({ x, y, edge: far > USABLE_R - 14 });
  }
  return out;
})();

export interface MapOptions {
  worn?: boolean;
  /** Reject the wafer above this share of defective dies. */
  rejectPct?: number;
}

export function makeWaferMap(seed: number, opts: MapOptions = {}): WaferMap {
  const rng = createRng(seed * 7919 + 17);
  const R = opts.worn ? RATES.worn : RATES.normal;
  const dies: Die[] = DIE_GRID.map(d => {
    const u = rng();
    let cls: DefectClass = 0;
    const chip = d.edge ? R.chipEdge : R.chipIn;
    if (u < R.crack) cls = 1;
    else if (u < R.crack + chip) cls = 2;
    else if (u < R.crack + chip + R.contam) cls = 3;
    return { ...d, cls, review: false };
  });
  // a scratch: a straight line across the wafer marks the dies it crosses
  if (rng() < R.scratchWafer) {
    const a = rng() * Math.PI, c = (rng() - 0.5) * 160, len = 60 + rng() * 90;
    const nx = Math.cos(a), ny = Math.sin(a);
    for (const d of dies) {
      const along = d.x * nx + d.y * ny, across = -d.x * ny + d.y * nx;
      if (Math.abs(across - c) < DIE_H * 0.5 && Math.abs(along) < len / 2 && d.cls === 0) d.cls = 4;
    }
  }
  // low-confidence calls go to a person: some random dies and a third of the contaminations
  for (const d of dies) d.review = rng() < 0.008 || (d.cls === 3 && rng() < 0.3);
  const counts: WaferMap['counts'] = [0, 0, 0, 0, 0];
  for (const d of dies) counts[d.cls]++;
  const defects = dies.length - counts[0];
  const review = dies.filter(d => d.review).length;
  const ng = defects / dies.length > (opts.rejectPct ?? 3) / 100 || counts[1] >= 3;
  return { dies, counts, defects, review, yield: counts[0] / dies.length, ng };
}

/**
 * Draw the map on a square canvas: wafer disc, die grid, and the result of every die inside the scanned region
 * (rows scanned so far, 0..1). `full` shows the whole result at once (panel, HMI).
 */
export function drawWafer(g: CanvasRenderingContext2D, size: number, map: WaferMap | null, scanned = 1, opts: { background?: string } = {}) {
  const s = size / WAFER_MM, c = size / 2;
  g.clearRect(0, 0, size, size);
  if (opts.background) { g.fillStyle = opts.background; g.fillRect(0, 0, size, size); }
  g.fillStyle = '#4b4f6b';
  g.beginPath(); g.arc(c, c, (WAFER_MM / 2) * s, 0, Math.PI * 2); g.fill();
  // notch
  g.fillStyle = opts.background ?? '#0a1520';
  g.beginPath(); g.arc(c, c + (WAFER_MM / 2) * s, 3 * s, 0, Math.PI * 2); g.fill();
  const limitY = -WAFER_MM / 2 + scanned * WAFER_MM;
  for (let k = 0; k < DIE_GRID.length; k++) {
    const d = DIE_GRID[k], x = c + (d.x - DIE_W / 2) * s, y = c + (d.y - DIE_H / 2) * s, w = DIE_W * s - 1, h = DIE_H * s - 1;
    const die = map && d.y - DIE_H / 2 < limitY ? map.dies[k] : null;
    if (!die) { g.fillStyle = '#6b7096'; g.fillRect(x, y, w, h); continue; }
    g.fillStyle = die.cls ? CLASSES[die.cls].color : 'rgba(45, 212, 191, 0.55)';
    g.fillRect(x, y, w, h);
    if (die.review) { g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(1, s * 1.2); g.strokeRect(x + 1, y + 1, w - 2, h - 2); }
  }
  if (map && scanned < 1) {
    const y = c + limitY * s;
    g.fillStyle = 'rgba(125, 211, 252, 0.9)';
    g.fillRect(c - (WAFER_MM / 2) * s, y - 1.5, WAFER_MM * s, 3);
  }
}
