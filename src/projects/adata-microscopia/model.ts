// Microscope inspection model: the time a lot takes at a bench today (eyepieces, paper form, later typed into the
// system) and with the digital retrofit (camera, monitor, barcode, pedal capture, record in the MES), and the
// sample images. Pure functions; every lot and image comes from a seed.
//
// PROVISIONAL: every time and rate below is an estimate to be replaced by a time study at the client's benches.
import { createRng } from '../../sim/des';

export type Mode = 'hoje' | 'digital';

export interface MicroParams {
  /** Samples inspected per lot. */
  samples: number;
  /** Seconds to inspect one sample (eyepieces) and on the monitor. */
  inspectS: number;
  inspectDigitalS: number;
  /** Chance a sample shows a defect worth recording. */
  defectRate: number;
  /** Today: lot header on the form, writing one defect, closing the form, typing the form into the system later. */
  headerS: number;
  writeS: number;
  closeS: number;
  typeS: number;
  /** Digital: barcode read, pedal capture + class on the screen, automatic closing. */
  scanS: number;
  tagS: number;
  autoCloseS: number;
}

export const DEFAULT_MICRO: MicroParams = {
  samples: 20, inspectS: 20, inspectDigitalS: 18, defectRate: 0.12,
  headerS: 90, writeS: 35, closeS: 30, typeS: 180,
  scanS: 5, tagS: 8, autoCloseS: 5,
};

/** Expected seconds per lot and the share spent recording, for each mode. */
export function lotTime(p: MicroParams, mode: Mode) {
  const d = p.samples * p.defectRate;
  if (mode === 'hoje') {
    const record = p.headerS + d * p.writeS + p.closeS + p.typeS;
    return { total: p.samples * p.inspectS + record, record };
  }
  const record = p.scanS + d * p.tagS + p.autoCloseS;
  return { total: p.samples * p.inspectDigitalS + record, record };
}

export const DEFECT_CLASSES = [
  { id: 'trinca', name: 'Trinca', color: '#ef4444' },
  { id: 'lasca', name: 'Lascamento', color: '#f59e0b' },
  { id: 'particula', name: 'Partícula', color: '#a78bfa' },
  { id: 'risco', name: 'Risco', color: '#f472b6' },
  { id: 'mancha', name: 'Mancha / resíduo', color: '#22d3ee' },
] as const;
export type DefectId = (typeof DEFECT_CLASSES)[number]['id'];

/** Defects of the samples of a lot: the class of each defective sample, or null. */
export function lotDefects(seed: number, p: MicroParams, rateFactor = 1): (DefectId | null)[] {
  const rng = createRng(seed * 4099 + 11);
  return Array.from({ length: p.samples }, () => (rng() < p.defectRate * rateFactor ? DEFECT_CLASSES[Math.floor(rng() * DEFECT_CLASSES.length)].id : null));
}

/**
 * A microscope image of a die corner (metal lines, bond pads) with the defect, as the camera sees it.
 * `pan` (0–1) slides the field of view (live image while the operator moves the stage).
 */
export function drawMicroscope(g: CanvasRenderingContext2D, W: number, H: number, seed: number, defect: DefectId | null, pan = 0.5) {
  const rng = createRng(seed * 31 + 5);
  const ox = (pan - 0.5) * W * 0.3;
  g.fillStyle = '#5b5f73'; g.fillRect(0, 0, W, H);
  // die area and saw street
  g.fillStyle = '#6f7591'; g.fillRect(ox + W * 0.12, H * 0.1, W * 0.9, H * 0.8);
  g.fillStyle = '#3b3e4c'; g.fillRect(ox + W * 0.05, 0, W * 0.07, H);
  // metal lines and pads
  g.strokeStyle = 'rgba(214, 190, 120, 0.55)'; g.lineWidth = Math.max(1, W * 0.004);
  for (let i = 0; i < 14; i++) { const y = H * (0.15 + i * 0.05); g.beginPath(); g.moveTo(ox + W * 0.3, y); g.lineTo(ox + W * (0.85 + rng() * 0.1), y); g.stroke(); }
  g.fillStyle = '#d8c27a';
  for (let i = 0; i < 6; i++) g.fillRect(ox + W * 0.16, H * (0.18 + i * 0.11), W * 0.08, H * 0.06);
  // vignette of the optics
  const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
  if (defect) {
    const cx = ox + W * (0.35 + rng() * 0.4), cy = H * (0.25 + rng() * 0.5);
    g.save();
    if (defect === 'trinca') { g.strokeStyle = '#1b1c22'; g.lineWidth = W * 0.006; g.beginPath(); g.moveTo(cx - W * 0.15, cy - H * 0.1); g.lineTo(cx - W * 0.02, cy + H * 0.02); g.lineTo(cx + W * 0.04, cy - H * 0.04); g.lineTo(cx + W * 0.16, cy + H * 0.12); g.stroke(); }
    else if (defect === 'lasca') { g.fillStyle = '#3b3e4c'; g.beginPath(); g.moveTo(ox + W * 0.12, cy - H * 0.08); g.lineTo(ox + W * 0.2, cy - H * 0.02); g.lineTo(ox + W * 0.17, cy + H * 0.07); g.lineTo(ox + W * 0.12, cy + H * 0.09); g.fill(); }
    else if (defect === 'particula') { g.fillStyle = '#20222b'; g.beginPath(); g.arc(cx, cy, W * 0.018, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(cx + W * 0.02, cy + H * 0.01, W * 0.009, 0, Math.PI * 2); g.fill(); }
    else if (defect === 'risco') { g.strokeStyle = 'rgba(230, 230, 240, 0.85)'; g.lineWidth = W * 0.004; g.beginPath(); g.moveTo(cx - W * 0.2, cy + H * 0.05); g.lineTo(cx + W * 0.2, cy - H * 0.06); g.stroke(); }
    else { const r = g.createRadialGradient(cx, cy, 0, cx, cy, W * 0.08); r.addColorStop(0, 'rgba(120, 90, 50, 0.8)'); r.addColorStop(1, 'rgba(120, 90, 50, 0)'); g.fillStyle = r; g.fillRect(cx - W * 0.1, cy - W * 0.1, W * 0.2, W * 0.2); }
    g.restore();
  }
  g.fillStyle = v; g.fillRect(0, 0, W, H);
}
