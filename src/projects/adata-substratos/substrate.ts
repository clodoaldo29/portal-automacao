// Inspection result of a BGA substrate strip: every unit gets an RGB verdict (particle, residue, scratch on the
// metallisation) and a spectral oxidation index (oxidation, corrosion). Units out of limits are marked X-out in
// the strip map sent to the MES, so die attach skips them. Pure functions, every strip from a seed.
//
// PROVISIONAL: strip format, defect rates, the oxidation index scale and the limits are typical values; replace
// them with the substrate specification, the supplier data and the incoming inspection history of the client.
import { createRng } from '../../sim/des';

/** Strip 240 × 74 mm, 4 blocks of 5 × 4 units (80 units of 9 × 13 mm). */
export const STRIP = { l: 240, w: 74, blocks: 4, bx: 5, by: 4 };
export const UNITS = STRIP.blocks * STRIP.bx * STRIP.by;

export type UnitClass = 0 | 1 | 2 | 3 | 4 | 5;
export const UNIT_CLASSES: { name: string; color: string; spectral: boolean }[] = [
  { name: 'OK', color: '#22c55e', spectral: false },
  { name: 'Partícula', color: '#f59e0b', spectral: false },
  { name: 'Contaminação / resíduo', color: '#a78bfa', spectral: false },
  { name: 'Risco na metalização', color: '#f472b6', spectral: false },
  { name: 'Oxidação', color: '#ef4444', spectral: true },
  { name: 'Corrosão', color: '#b91c1c', spectral: true },
];

export interface StripLimits {
  /** Oxidation index above which a unit is marked (0–1 scale of the spectral model). */
  oxLimit: number;
  /** Strip goes to the NG magazine when more than this share of its units is X-out. */
  xoutMax: number;
}
export const DEFAULT_LIMITS: StripLimits = { oxLimit: 0.35, xoutMax: 0.1 };

export interface Unit { x: number; y: number; cls: UnitClass; ox: number }
export interface StripResult { units: Unit[]; counts: number[]; xouts: number; oxMean: number; ng: boolean }

/** Centre of unit k in mm (strip centre at the origin, x along the strip). */
export function unitPos(k: number) {
  const b = Math.floor(k / (STRIP.bx * STRIP.by)), r = k % (STRIP.bx * STRIP.by), i = r % STRIP.bx, j = Math.floor(r / STRIP.bx);
  const blockW = STRIP.l / STRIP.blocks;
  return { x: -STRIP.l / 2 + blockW * (b + 0.5) + (i - (STRIP.bx - 1) / 2) * 11, y: (j - (STRIP.by - 1) / 2) * 16 };
}

const RATES = { particle: 0.012, residue: 0.008, scratch: 0.006, corrosion: 0.002 };

export function inspectStrip(seed: number, opts: { oxidized?: boolean; limits?: StripLimits } = {}): StripResult {
  const rng = createRng(seed * 7727 + 3);
  const lim = opts.limits ?? DEFAULT_LIMITS;
  // oxidation: a lot stored with humidity has a high index, stronger toward one end of the strip
  const base = opts.oxidized ? 0.3 + rng() * 0.08 : 0.1 + rng() * 0.04, slope = opts.oxidized ? 0.18 : 0.04;
  const units: Unit[] = Array.from({ length: UNITS }, (_, k) => {
    const p = unitPos(k);
    const ox = Math.max(0, base + slope * (p.x / (STRIP.l / 2)) + (rng() - 0.5) * 0.1);
    let cls: UnitClass = 0;
    const u = rng(), c = RATES.corrosion * (opts.oxidized ? 5 : 1);
    if (u < c) cls = 5;
    else if (u < c + RATES.particle) cls = 1;
    else if (u < c + RATES.particle + RATES.residue) cls = 2;
    else if (u < c + RATES.particle + RATES.residue + RATES.scratch) cls = 3;
    if (cls === 0 && ox > lim.oxLimit) cls = 4;
    return { x: p.x, y: p.y, cls, ox };
  });
  const counts = [0, 0, 0, 0, 0, 0];
  for (const u of units) counts[u.cls]++;
  const xouts = UNITS - counts[0];
  return { units, counts, xouts, oxMean: units.reduce((s, u) => s + u.ox, 0) / UNITS, ng: xouts / UNITS > lim.xoutMax };
}

/** False colour of the oxidation index (dark blue clean → yellow → red oxidised). */
export function oxColor(ox: number) {
  const u = Math.max(0, Math.min(1, ox / 0.6));
  return `hsl(${(230 - u * 230).toFixed(0)}, 80%, ${(30 + u * 25).toFixed(0)}%)`;
}

/**
 * Draw the strip: 'rgb' looks like the substrate (green solder mask, gold fingers) with the X-out marks of the
 * scanned part; 'spec' is the spectral false-colour map. `scanned` (0–1) is how much of the strip passed the camera.
 */
export function drawStrip(g: CanvasRenderingContext2D, W: number, H: number, s: StripResult | null, scanned: number, mode: 'rgb' | 'spec') {
  const sx = W / STRIP.l, sy = H / STRIP.w;
  g.fillStyle = mode === 'rgb' ? '#1f5f3f' : '#0b1530';
  g.fillRect(0, 0, W, H);
  if (mode === 'rgb') { g.fillStyle = '#b8892f'; for (let x = 4; x < W; x += 12) { g.fillRect(x, 2, 6, 3); g.fillRect(x, H - 5, 6, 3); } }
  const limitX = -STRIP.l / 2 + scanned * STRIP.l;
  for (let k = 0; k < UNITS; k++) {
    const p = unitPos(k), x = (p.x + STRIP.l / 2 - 4.5) * sx, y = (p.y + STRIP.w / 2 - 6.5) * sy, w = 9 * sx, h = 13 * sy;
    const u = s && p.x - 4.5 < limitX ? s.units[k] : null;
    if (mode === 'spec') {
      g.fillStyle = u ? oxColor(u.ox) : '#1a2440';
      g.fillRect(x, y, w, h);
      if (u && u.cls === 5) { g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.strokeRect(x + 1, y + 1, w - 2, h - 2); }
      continue;
    }
    g.fillStyle = '#2d7a52'; g.fillRect(x, y, w, h);
    g.fillStyle = '#d4a63a';
    for (let f = 0; f < 4; f++) { g.fillRect(x + 1, y + 2 + f * (h - 4) / 4, w * 0.22, (h - 4) / 8); g.fillRect(x + w - 1 - w * 0.22, y + 2 + f * (h - 4) / 4, w * 0.22, (h - 4) / 8); }
    if (u && u.cls) {
      g.strokeStyle = UNIT_CLASSES[u.cls].color; g.lineWidth = Math.max(1.5, w * 0.12);
      g.beginPath(); g.moveTo(x + 2, y + 2); g.lineTo(x + w - 2, y + h - 2); g.moveTo(x + w - 2, y + 2); g.lineTo(x + 2, y + h - 2); g.stroke();
    }
  }
  if (s && scanned < 1) { g.fillStyle = mode === 'rgb' ? 'rgba(125, 211, 252, 0.95)' : 'rgba(255, 255, 255, 0.9)'; g.fillRect((limitX + STRIP.l / 2) * sx - 1, 0, 2, H); }
}
