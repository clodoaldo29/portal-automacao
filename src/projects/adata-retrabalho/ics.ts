// 3D measurement of the solder balls of a reworked BGA memory package (after reballing), and the pass/fail rule.
// Pure functions (no DOM, no three.js); every package comes from a seed, so runs repeat exactly.
//
// PROVISIONAL: package (FBGA 78, 0.8 mm pitch), ball size, process spread, defect rates and the tolerances are
// typical values; replace them with the component specification and the rework history of the client.
import { createRng } from '../../sim/des';

/** FBGA 78 (DDR4 x8): 9 × 13 mm body, balls in 2 blocks of 3 columns × 13 rows, 0.8 mm pitch. */
export const PKG = { w: 9, h: 13, pitch: 0.8, cols: [-2.4, -1.6, -0.8, 0.8, 1.6, 2.4], rows: 13 };
/** Nominal ball after reflow: diameter and height (mm). */
export const NOMINAL = { d: 0.45, h: 0.36 };

export type IcDefect = 'ausente' | 'ponte' | 'deformada' | 'desalinhamento' | 'coplanaridade';
export const DEFECTS: { id: IcDefect; name: string; color: string; visibleManual: number }[] = [
  // visibleManual: share an inspector at the microscope would catch (provisional)
  { id: 'ausente', name: 'Esfera ausente', color: '#ef4444', visibleManual: 0.95 },
  { id: 'ponte', name: 'Ponte de solda', color: '#f97316', visibleManual: 0.85 },
  { id: 'deformada', name: 'Esfera deformada', color: '#f59e0b', visibleManual: 0.5 },
  { id: 'desalinhamento', name: 'Desalinhamento', color: '#a78bfa', visibleManual: 0.3 },
  { id: 'coplanaridade', name: 'Coplanaridade', color: '#ec4899', visibleManual: 0.05 },
];

export interface Tolerances {
  /** Ball diameter: nominal ± this (mm). */
  dTol: number;
  /** Maximum coplanarity (highest − lowest ball top, mm). */
  copMax: number;
  /** Maximum ball position error (mm). */
  offMax: number;
}
export const DEFAULT_TOL: Tolerances = { dTol: 0.05, copMax: 0.08, offMax: 0.06 };

export interface Ball { x: number; y: number; h: number; d: number; dx: number; dy: number; missing: boolean; bridge: boolean }
export interface IcResult {
  balls: Ball[];
  coplanarity: number;
  dMin: number;
  dMax: number;
  offMax: number;
  missing: number;
  bridges: number;
  defects: IcDefect[];
  ok: boolean;
}

/** Per-package defect probabilities after rework. 'bad' simulates a poor reballing batch (stencil, flux, profile). */
export const RATES = {
  normal: { ausente: 0.008, ponte: 0.004, deformada: 0.01, desalinhamento: 0.008, coplanaridade: 0.012 },
  bad: { ausente: 0.03, ponte: 0.02, deformada: 0.04, desalinhamento: 0.035, coplanaridade: 0.05 },
};

const gauss = (rng: () => number) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

export function measureIc(seed: number, opts: { bad?: boolean; tol?: Tolerances } = {}): IcResult {
  const rng = createRng(seed * 104729 + 7);
  const R = opts.bad ? RATES.bad : RATES.normal, tol = opts.tol ?? DEFAULT_TOL;
  const balls: Ball[] = [];
  for (let r = 0; r < PKG.rows; r++) for (const x of PKG.cols) {
    balls.push({
      x, y: (r - (PKG.rows - 1) / 2) * PKG.pitch,
      h: NOMINAL.h + gauss(rng) * 0.007, d: NOMINAL.d + gauss(rng) * 0.009,
      dx: gauss(rng) * 0.008, dy: gauss(rng) * 0.008, missing: false, bridge: false,
    });
  }
  const pick = () => balls[Math.floor(rng() * balls.length)];
  // process defects (each one changes the geometry; the classification below finds them from the measurement)
  if (rng() < R.ausente) pick().missing = true;
  if (rng() < R.ponte) { const b = pick(), n = balls.find(o => o !== b && Math.abs(o.y - b.y) < 1e-6 && Math.abs(Math.abs(o.x - b.x) - PKG.pitch) < 1e-6); if (n) { b.bridge = n.bridge = true; b.d += 0.12; n.d += 0.12; } }
  if (rng() < R.deformada) { const b = pick(); b.d += (rng() < 0.5 ? -1 : 1) * (0.08 + rng() * 0.05); b.h -= 0.04; }
  if (rng() < R.desalinhamento) { const ox = (0.07 + rng() * 0.05) * (rng() < 0.5 ? -1 : 1); for (const b of balls) if (b.x > 0) b.dx += ox; }
  if (rng() < R.coplanaridade) { const tilt = 0.012 + rng() * 0.01; for (const b of balls) b.h += (b.y / (PKG.h / 2)) * tilt * 6; }

  const present = balls.filter(b => !b.missing);
  const tops = present.map(b => b.h);
  const coplanarity = Math.max(...tops) - Math.min(...tops);
  const ds = present.map(b => b.d);
  const offMax = Math.max(...present.map(b => Math.hypot(b.dx, b.dy)));
  const missing = balls.length - present.length, bridges = balls.filter(b => b.bridge).length / 2;
  const defects: IcDefect[] = [];
  if (missing) defects.push('ausente');
  if (bridges) defects.push('ponte');
  if (present.some(b => !b.bridge && Math.abs(b.d - NOMINAL.d) > tol.dTol)) defects.push('deformada');
  if (offMax > tol.offMax) defects.push('desalinhamento');
  if (coplanarity > tol.copMax) defects.push('coplanaridade');
  return { balls, coplanarity, dMin: Math.min(...ds), dMax: Math.max(...ds), offMax, missing, bridges, defects, ok: defects.length === 0 };
}

/** Colour of a ball top height relative to the nominal (blue low → green → red high), for the height maps. */
export function heightColor(h: number, span = 0.06): string {
  const u = Math.max(0, Math.min(1, (h - NOMINAL.h) / span / 2 + 0.5));
  const hue = 240 - u * 240;
  return `hsl(${hue.toFixed(0)}, 85%, ${(48 + 6 * Math.sin(u * Math.PI)).toFixed(0)}%)`;
}

/** Draw the measured package seen from the ball side, balls coloured by height (w × h canvas). */
export function drawIc(g: CanvasRenderingContext2D, W: number, H: number, ic: IcResult | null, scanned = 1, opts: { background?: string } = {}) {
  g.fillStyle = opts.background ?? '#0a1520';
  g.fillRect(0, 0, W, H);
  const s = Math.min(W / (PKG.w + 1.5), H / (PKG.h + 1.5)), cx = W / 2, cy = H / 2;
  g.fillStyle = '#2b3442';
  g.fillRect(cx - (PKG.w / 2) * s, cy - (PKG.h / 2) * s, PKG.w * s, PKG.h * s);
  g.strokeStyle = '#475569'; g.lineWidth = 1;
  g.strokeRect(cx - (PKG.w / 2) * s, cy - (PKG.h / 2) * s, PKG.w * s, PKG.h * s);
  if (!ic) return;
  const limit = -PKG.h / 2 + scanned * PKG.h;
  for (const b of ic.balls) {
    const x = cx + (b.x + b.dx * 4) * s, y = cy + (b.y + b.dy * 4) * s, r = (b.d / 2) * s;
    if (b.y - 0.4 > limit) { g.fillStyle = '#3a4556'; g.beginPath(); g.arc(cx + b.x * s, cy + b.y * s, (NOMINAL.d / 2) * s, 0, Math.PI * 2); g.fill(); continue; }
    if (b.missing) { g.strokeStyle = '#ef4444'; g.lineWidth = 2; g.beginPath(); g.arc(cx + b.x * s, cy + b.y * s, (NOMINAL.d / 2) * s, 0, Math.PI * 2); g.stroke(); continue; }
    g.fillStyle = heightColor(b.h);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    if (b.bridge) { g.strokeStyle = '#f97316'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r + 2, 0, Math.PI * 2); g.stroke(); }
  }
  if (scanned < 1) { g.fillStyle = 'rgba(255, 64, 64, 0.9)'; g.fillRect(cx - (PKG.w / 2 + 0.4) * s, cy + limit * s - 1, (PKG.w + 0.8) * s, 2); }
}
