// Smart Pack layout and product data (Grupo Multi, flow TO-BE v4, stations 1 to 4). REAL SCALE: 1 unit = 1 metre.
//
// Top view (x along the flow, z across):
//   z = 0      end of the test line (the TV stands in the test pallet, screen toward +z, as on the Transfer Flow test belt)
//   z = −1.25  station 1: JAKA Zu 50 with the OnRobot VGP30 on the flange, on the TV's back side
//   z = −2.55  packing line: infeed (TV lying screen-down) → station 2 bagger → station 3 upender, then the box line
//              (lower) with the bases coming from the +z side → station 4 cover gantry (magazine on the −z side) →
//              existing stations 5 to 10 (grey, not animated)
// Distance between the lines is PROVISIONAL (flow document, pending item "distância e desníveis entre linhas").
import type { LabelDef } from '../../sim/labels';
import type { ViewDef } from '../../sim/views';
import { INCHES, LINE_UPH, PAL_W, SEAT_Y, SIZES, TOP_TEST, TV_BACK, TV_T, type Inch } from '../transfer-flow/config';

export { INCHES, LINE_UPH, PAL_W, SEAT_Y, SIZES, TV_BACK, TV_T, type Inch };

// ---------- test line (end of it: the TV comes from the functional test) ----------
export const Z_TEST = 0, Y_TEST = TOP_TEST, BELT_TEST = 0.72, TEST_OUT = 0.75;
export const TEST_X0 = -7.6, TEST_X1 = 4.2; // pallets return under the belt through the lift at the end
export const SPEED_TEST = 0.8;
export const PICK_X = 0; // pallet stop of station 1

// ---------- station 1: transfer robot ----------
export const ROBOT = { x: 0, z: -1.25, ped: 0.8 };
/** Flange → cup faces of the VGP30 straight on the flange (adapter and a 100 mm spacer). */
export const GRIP_D = 0.2;

// ---------- packing line (TV lying screen-down, its width across the belt, bottom edge leading) ----------
export const Z_PACK = -2.55, Y_PACK = 0.85, BELT_PACK = 1.9, PACK_X0 = -1.3, SPEED_PACK = 0.35;
export const DROP_X = 0; // where the robot sets the TV down
/** Station 2: automatic bagger (housing from x0 to x1); the TV stops in the middle for the bag. */
export const BAGGER = { x0: 2.4, x1: 5.4, w: 2.5, h: 2.15 };
export const BAG_X = (BAGGER.x0 + BAGGER.x1) / 2;
/** Station 3: upender table from TABLE_X0 to its pivot at PIVOT_X (the foot stop is at the pivot). */
export const TABLE_X0 = 5.95, PIVOT_X = 7.1, TABLE_W = 1.9;

// ---------- box line (lower), bases and covers ----------
export const Y_BOX = 0.5, BELT_BOX = 2.0, SPEED_BOX = 0.3;
/** Where the upender's clamps set the TV into the base: the end of the base feeder, start of the box line. */
export const BOX_X = 7.95, BOX_END = 18.2;
/** Base feeder: from the operator's preparation table (+z, bases with the EPS corners) to the box line. */
export const FEED_Z0 = 2.6, FEED_W = 0.55;
/** Station 4: cover gantry over the box line and the cover magazine (−z side). */
export const COVER_X = 11.3, Z_MAG = -4.85, MAG_X0 = COVER_X - 3.3, GANTRY_Y = 3.7;
/** Existing stations 5 to 10 (grey). */
export const EXIST_X0 = 13.4;

// ---------- packaging (provisional: the flow document lists the box geometry as pending) ----------
/** Bottom part of the box (tray) with the two EPS corners: length across the line (z), depth along it (x), wall height. */
export const trayOf = (inch: Inch) => ({ l: SIZES[inch][0] + 0.16, d: 0.3, h: 0.2 });
/** Top part of the box: slides down over the TV and telescopes over the tray. */
export const coverOf = (inch: Inch) => ({ l: trayOf(inch).l + 0.024, d: 0.324, h: SIZES[inch][1] + 0.15 });
/** The TV's bottom edge in the base: tray floor plus the EPS under it. */
export const SEAT_BOX = 0.05;
/** Centre of a TV lying screen-down on a belt, above the belt top. */
export const LYING_Y = TV_T / 2 + 0.0015;

// ---------- timing (provisional) ----------
export interface Timing { bagS: number }
export const DEFAULT_TIMING: Timing = { bagS: 12 };

export type Feed = 'linha' | 'max';

export const SHADOW_FRUSTUM = { left: -13, right: 13, top: 10, bottom: -10, near: 1, far: 70 };

export const VIEWS: Record<string, ViewDef> = {
  linha: { pos: [-4.5, 7.5, 6.5], target: [5.5, 0.6, -2.4] },
  robo: { pos: [-3.2, 2.9, 1.9], target: [0, 1.2, -1.3] },
  ensaque: { pos: [1.2, 2.6, 0.6], target: [4.2, 1.0, -2.5] },
  vertical: { pos: [6.0, 2.5, 1.7], target: [7.5, 1.0, -2.55] },
  cobertura: { pos: [14.4, 3.2, 1.2], target: [11.3, 1.4, -3.4] },
  cima: { pos: [5, 21, 0.01], target: [5, 0, -1.8] },
};

export const TOUR = {
  positions: [[-6, 3, 3], [-3, 2.6, 1.6], [1.4, 2.4, 0.8], [5.4, 2.6, 0.4], [9.4, 2.8, 1.0], [14.6, 3.2, 0.6], [16, 4.5, -7.5], [4, 6, -8]] as [number, number, number][],
  targets: [[-2, 1.2, -0.5], [0, 1.2, -1.3], [4, 1, -2.5], [7.5, 1, -2.5], [8.4, 0.9, -1.2], [11.3, 1.4, -3.4], [11, 1, -3.5], [3, 1, -2.5]] as [number, number, number][],
  seconds: 60,
};

export const LABELS: LabelDef[] = [
  { lines: ['Vem do teste funcional', 'TV aprovada no pallet'], x: TEST_X0 + 1.6, y: 2.4, z: Z_TEST },
  { lines: ['1 · Transferência', 'JAKA Zu 50 + VGP30'], x: ROBOT.x - 0.4, y: 3.3, z: ROBOT.z },
  { lines: ['2 · Ensacadora automática'], x: BAG_X, y: BAGGER.h + 0.55, z: Z_PACK },
  { lines: ['3 · Verticalização', 'e base com isopor'], x: (PIVOT_X + BOX_X) / 2, y: 3.15, z: Z_PACK },
  { lines: ['Preparo das bases', '(manual)'], x: BOX_X, y: 1.9, z: FEED_Z0 - 0.3 },
  { lines: ['4 · Cobertura da caixa', 'pórtico com ventosas'], x: COVER_X, y: GANTRY_Y + 0.6, z: (Z_MAG + Z_PACK) / 2 },
  { lines: ['Magazine de coberturas'], x: MAG_X0 + 1.2, y: 2.3, z: Z_MAG - 0.2 },
  { lines: ['5 a 10 · Postos existentes', 'fechamento, conferência, etiqueta,', 'arqueação, paletização'], x: EXIST_X0 + 2.4, y: 2.7, z: Z_PACK },
];

export const FONT = '"Barlow Semi Condensed", "Segoe UI", Arial, sans-serif';
