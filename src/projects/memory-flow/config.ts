// Scene settings for Memory Flow 3D: cameras, tour, shadow bounds, fonts and simulation speeds.
import type { ViewDef } from '../../sim/views';

export const FONT = '"Barlow Semi Condensed", "Segoe UI", Arial, sans-serif';

/** World coordinates (plant centred on the origin; north is −Z). */
export const VIEWS: Record<string, ViewDef> = {
  planta: { pos: [30, 60, 70], target: [2, 0, 6] },
  limpa: { pos: [-2, 30, 50], target: [-12, 0, 16] },
  testes: { pos: [16, 28, 20], target: [4, 0, -10] },
  utilidades: { pos: [-4, 28, -4], target: [-18, 0, -35] },
  logistica: { pos: [-8, 22, 64], target: [-22, 0, 37] },
  cima: { pos: [0, 128, 2], target: [0, 0, 0.5] },
};

export const TOUR = {
  positions: [[-55, 40, 70], [10, 30, 62], [62, 34, 30], [55, 40, -48], [-10, 34, -55], [-62, 38, -10]] as [number, number, number][],
  targets: [[-20, 0, 25], [10, 0, 15], [30, 0, 0], [15, 0, -25], [-15, 0, -20], [-20, 0, 5]] as [number, number, number][],
  seconds: 60,
};

export const SHADOW_FRUSTUM = { left: -75, right: 75, top: 70, bottom: -70, near: 0.5, far: 120 };

/** Simulation speeds: simulated seconds per real second. */
export const SPEEDS = [10, 30, 120, 600, 3600];
export const DEFAULT_SPEED = 30;

/** Tag labels are shown only when the camera is this close (m). */
export const TAG_DISTANCE = 26;

export const STATUS_COLOR = { run: 0x22c55e, idle: 0xf59e0b, down: 0xef4444, lab: 0x60a5fa, off: 0x8a939c };
