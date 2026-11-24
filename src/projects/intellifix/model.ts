// Intellifix AI · Grupo Multi: products, pallet and screw points (pure, no three.js).
//
// Final screwdriving of the TV back cover on line LTV01: two UR10e facing each other across the conveyor.
// 32" and 43": two TVs per pallet, side by side across the belt, one under each robot (each robot screws its own TV).
// 50" and up: one TV per pallet, the two robots share its screws half and half.
// TVs lie screen-down on the pallet ("base colchão"), back cover up. Pallet frame: x along the belt, z across it,
// robot 1 on +z, robot 2 on −z. A TV lies with its width along x and its height along z.
//
// PROVISIONAL: the screw points are plausible (evenly spaced on a ring inset from the back-cover edge); the real
// positions come from each model's drawing. Times are in balance.ts (study of 2026-11-19).
import { SIZES, TV_GAP, type Inch } from '../transfer-flow/config';

export interface TvModel {
  id: string;
  inch: Inch;
  /** Screws per TV (PUR, table 1). */
  screws: number;
  /** How many of them are self-tapping (slower: they cut the thread in the plastic). */
  selfTap: number;
  /** Required cadence, TVs per hour. */
  uph: number;
}

/** The seven LTV01 models (PUR, table 1; source: Grupo Multi). */
export const MODELS: TvModel[] = [
  { id: 'TL052M', inch: 32, screws: 6, selfTap: 0, uph: 230 },
  { id: '32V35RS', inch: 32, screws: 3, selfTap: 0, uph: 230 },
  { id: 'TL056', inch: 43, screws: 9, selfTap: 0, uph: 220 },
  { id: 'TL059', inch: 50, screws: 5, selfTap: 0, uph: 115 },
  { id: '55Q6QV', inch: 55, screws: 8, selfTap: 1, uph: 110 },
  { id: '65Q6QV', inch: 65, screws: 9, selfTap: 1, uph: 90 },
  { id: '75Q6QV', inch: 75, screws: 10, selfTap: 1, uph: 75 },
];

/** Limits of the "screws per model" parameter. */
export const SCREW_LIMITS = [1, 16] as const;

/** Cell geometry (metres). */
export const CELL = {
  /** Robot base centres at z = ±robotZ, x = 0: the pedestal stands just outside the 1.24 m pallet. */
  robotZ: 0.9,
  /** Useful horizontal reach of a UR10e with the screwdriver pointing down (nominal 1.3 m). */
  reach: 1.2,
  /** Tool home (clear of the TV, over the belt edge on the robot's side). */
  homeZ: 0.35,
  /** Gap between the two TVs of a 32"/43" pallet (the Transfer Flow jig). */
  tvGap: TV_GAP,
  /** Screws sit this far in from the back-cover edge. */
  inset: 0.04,
  /** Shared zone |z| < zone around the belt centre: only one robot inside at a time. */
  zone: 0.15,
};

export const tvsPerPallet = (inch: Inch) => (inch <= 43 ? 2 : 1);

/** TV outline on the pallet: width along x, height along z. */
export const tvSize = (inch: Inch) => ({ w: SIZES[inch][0], h: SIZES[inch][1] });

/** Centre z of each TV on the pallet: TV 0 on the robot-1 side (+z). */
export function tvCentersZ(inch: Inch): number[] {
  if (tvsPerPallet(inch) === 1) return [0];
  const c = tvSize(inch).h / 2 + CELL.tvGap / 2;
  return [c, -c];
}

export interface ScrewPoint {
  /** Pallet coordinates. */
  x: number; z: number;
  /** Which TV of the pallet (0 = robot-1 side). */
  tv: number;
  /** Index on that TV's ring. */
  idx: number;
  selfTap: boolean;
}

/** `n` points evenly spaced on the ring inset from a w × h back cover, half a step from the first corner. */
export function ringPoints(w: number, h: number, n: number): { x: number; z: number }[] {
  const a = w - 2 * CELL.inset, b = h - 2 * CELL.inset, per = 2 * (a + b), step = per / n;
  const out: { x: number; z: number }[] = [];
  for (let k = 0; k < n; k++) {
    let s = (k + 0.5) * step;
    // walk the ring: bottom edge (+x), right edge (+z), top edge (−x), left edge (−z)
    if (s < a) { out.push({ x: -a / 2 + s, z: -b / 2 }); continue; }
    s -= a;
    if (s < b) { out.push({ x: a / 2, z: -b / 2 + s }); continue; }
    s -= b;
    if (s < a) { out.push({ x: a / 2 - s, z: b / 2 }); continue; }
    s -= a;
    out.push({ x: -a / 2, z: b / 2 - s });
  }
  return out;
}

/** All screw points of a pallet for `model`, optionally overriding the number of screws per TV. */
export function screwPoints(model: TvModel, screws = model.screws): ScrewPoint[] {
  const { w, h } = tvSize(model.inch);
  const out: ScrewPoint[] = [];
  tvCentersZ(model.inch).forEach((cz, tv) => {
    const ring = ringPoints(w, h, screws);
    // the self-tapping screw(s): the ones nearest the middle of the bottom edge (stand bracket area)
    const tapIdx = new Set(
      ring.map((p, i) => ({ i, d: Math.hypot(p.x, p.z + h / 2) })).sort((a, b) => a.d - b.d).slice(0, Math.min(model.selfTap, screws)).map(o => o.i),
    );
    ring.forEach((p, idx) => out.push({ x: p.x, z: cz + p.z, tv, idx, selfTap: tapIdx.has(idx) }));
  });
  return out;
}

/** Pallet cycle the line demands: one pallet per (TVs per pallet) TVs at the model's UPH. */
export const requiredCycleS = (model: TvModel) => (3600 / model.uph) * tvsPerPallet(model.inch);

/** Robot base and tool home in pallet coordinates (robot 0 on +z, robot 1 on −z). */
export const robotBase = (r: 0 | 1) => ({ x: 0, z: r === 0 ? CELL.robotZ : -CELL.robotZ });
export const robotHome = (r: 0 | 1) => ({ x: 0, z: r === 0 ? CELL.homeZ : -CELL.homeZ });
export const inZone = (p: { z: number }) => Math.abs(p.z) < CELL.zone;
