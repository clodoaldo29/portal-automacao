// Smart Pack layout and product data (Grupo Multi, flow TO-BE v4, stations 1 to 4). REAL SCALE: 1 unit = 1 metre.
//
// Top view (x along the flow, z across):
//   z = 0      end of the test line (the TV stands in the test pallet, screen toward +z, as on the Transfer Flow test belt)
//   z = −1.25  station 1: JAKA Zu 50 with the OnRobot VGP30 on the flange, on the TV's back side
//   z = −2.55  packing line: infeed → station 2 bagger → station 3 upender. The TV lies as on the Transfer Flow assembly
//              belt: screen down, its width along the belt, its top edge toward the robot.
//   z = −4.0   box line, parallel to the packing line: the bases (with the EPS corners) are prepared at its start, get
//              the TV standing sideways at station 3, the cover at station 4 (magazine on the −z side), then go on to
//              the existing stations 5 to 10 (grey, not animated)
// Distance between the lines is PROVISIONAL (flow document, pending item "distância e desníveis entre linhas").
import type { LabelDef } from '../../sim/labels';
import type { ViewDef } from '../../sim/views';
import { ARM_DX, ROBOT_Z as TF_ROBOT_Z, Z_PAL as TF_Z_PAL, INCHES, LINE_UPH, PAL_W, SEAT_Y, SIZES, TOP_TEST, TV_BACK, TV_T, type Inch } from '../transfer-flow/config';

export { INCHES, LINE_UPH, PAL_W, SEAT_Y, SIZES, TV_BACK, TV_T, type Inch };

// ---------- test line (end of it: the TV comes from the functional test) ----------
export const Z_TEST = 0, Y_TEST = TOP_TEST, BELT_TEST = 0.72, TEST_OUT = 0.75;
export const TEST_X0 = -12, TEST_X1 = 18.2; // along the whole layout; pallets return under the belt through the lift at the end
/** Release stop of the test line: the line comes full from the functional test (pallets queued behind this stop) and
 *  one TV is let go at the line cadence of the model. */
export const RELEASE_X = -4.6;
export const SPEED_TEST = 0.8;
export const PICK_X = 0; // pallet stop of station 1

// ---------- station 1: transfer robot ----------
/** As far from the test pallet as on the Transfer Flow (1.11 m): the arm passes over the top of a 75" TV waiting or arriving. */
const TF_PALLET_DIST = TF_ROBOT_Z - TF_Z_PAL;
/** The pedestal stands ARM_DX upstream of the pick and set-down points, as the Transfer Flow transfers: the arm reaches
 *  them on a slant and the forearm stays clear of a 75" TV while it is laid down; the hook reaches over the TV from here. */
export const ROBOT = { x: PICK_X - ARM_DX, z: Z_TEST - TF_PALLET_DIST, ped: 1.0 }; // 1.0 m pedestal (Transfer Flow: 0.8 m): the hook waits behind a 75" TV within reach

// ---------- packing line (TV lying screen-down, width along the belt, top edge toward the robot) ----------
export const Z_PACK = -2.55, Y_PACK = 0.85, BELT_PACK = 1.9, PACK_X0 = -1.3, SPEED_PACK = 0.6;
export const DROP_X = PICK_X + 0.9; // where the robot sets the TV down (a little downstream: the arm works open, not folded)
/** Every TV is set down with its bottom edge on this line (far side of the belt): the upender pivots there. */
export const Z_EDGE = Z_PACK - 0.45;
/** Station 2: automatic bagger (housing from x0 to x1, w across); the TV stops in the middle for the bag. */
export const BAGGER = { x0: 2.4, x1: 5.4, w: 2.0, h: 2.15 };
export const BAG_X = (BAGGER.x0 + BAGGER.x1) / 2;
/** Station 3: upender table from TABLE_X0 along x (TABLE_L), pivoting about an axis along x at its far edge (PIVOT_Z),
 *  where the foot stop is: the TV stands up sideways. */
/** Between the bagger and the upender cabin: belt room for one 75" TV waiting (BUFFER_X0 to CABIN_X0). */
export const BUFFER_X0 = BAGGER.x1, CABIN_X0 = BUFFER_X0 + 1.9, CABIN_L = 2.8;
export const TABLE_X0 = CABIN_X0 + 0.4, TABLE_L = 2.0, UP_X = TABLE_X0 + TABLE_L / 2, PIVOT_Z = Z_EDGE - 0.02, TABLE_D = 1.15;

// ---------- box line (lower, parallel to the packing line) ----------
export const Y_BOX = 0.5, Z_BASE = -4.0, BELT_BOX = 0.7, SPEED_BOX = 0.3;
/** Box line from the base feeder (start) to the end; the TV goes into the base at UP_X. */
/** The bases come ready (EPS corners in place): a feeder (magazine with the stack of bases) sets them on the start of the
 *  box line, one at a time, at FEED_X. */
export const FEED_X = BAG_X, BOX_X0 = FEED_X - 1.2, BOX_END = 18.2; // the base infeed beside the bagger; the box line starts there
/** Station 4: cover gantry over the box line; the covers queue on a magazine fed from the far side of the box line. */
export const COVER_X = CABIN_X0 + CABIN_L + 1.45, Z_MAG = Z_BASE - 0.62, MAG_Z0 = Z_BASE - 3.2, GANTRY_Y = 3.7;
/** Existing stations 5 to 10 (grey). */
export const EXIST_X0 = COVER_X + 1.65;

// ---------- packaging (provisional: the flow document lists the box geometry as pending) ----------
/** Bottom part of the box (tray) with the two EPS corners: length (along the TV's width), depth, wall height. */
export const trayOf = (inch: Inch) => ({ l: SIZES[inch][0] + 0.16, d: 0.3, h: 0.2 });
/** Top part of the box: slides down over the TV and telescopes over the tray. */
export const coverOf = (inch: Inch) => ({ l: trayOf(inch).l + 0.024, d: 0.324, h: SIZES[inch][1] + 0.15 });
/** The TV's bottom edge in the base: tray floor plus the EPS under it. */
export const SEAT_BOX = 0.05;
/** Centre of a TV lying screen-down on a belt, above the belt top. */
export const LYING_Y = TV_T / 2 + 0.0015;

// ---------- timing (provisional) ----------
/** bagS: bagger cycle per TV (s); beltSpeed: speed of the bagging belt, through the bagger cabin (m/s). */
export interface Timing { bagS: number; beltSpeed: number }
export const DEFAULT_TIMING: Timing = { bagS: 12, beltSpeed: SPEED_PACK };

export type Feed = 'linha' | 'max';

export const SHADOW_FRUSTUM = { left: -13, right: 13, top: 10, bottom: -10, near: 1, far: 70 };

export const VIEWS: Record<string, ViewDef> = {
  linha: { pos: [-4.5, 7.5, 6.5], target: [5.5, 0.6, -2.8] },
  robo: { pos: [-3.2, 2.9, 1.9], target: [0, 1.2, -1.5] },
  ensaque: { pos: [1.2, 2.6, 0.6], target: [4.2, 1.0, -2.6] },
  vertical: { pos: [UP_X + 2.6, 2.7, -0.9], target: [UP_X, 1.0, -3.3] },
  bases: { pos: [-6.5, 7.5, -10.5], target: [5, 0.6, -2.8] }, // from the far side: the box line parallel to the packing line
  cobertura: { pos: [14.6, 3.2, -1.4], target: [COVER_X, 1.3, -4.3] },
  cima: { pos: [5.5, 22, -2.61], target: [5.5, 0, -2.6] }, // as the layout sketch: test line on top, flow right to left
};

export const TOUR = {
  positions: [[-6, 3, 3], [-3, 2.6, 1.6], [1.4, 2.4, 0.8], [9.6, 2.7, -0.9], [4, 2.6, -7.5], [14.6, 3.2, -1.4], [16, 4.5, -9], [4, 6, -10]] as [number, number, number][],
  targets: [[-2, 1.2, -0.5], [0, 1.2, -1.5], [4, 1, -2.6], [UP_X, 1, -3.3], [5, 0.9, -3.8], [COVER_X, 1.3, -4.3], [11, 1, -4.2], [3, 1, -3]] as [number, number, number][],
  seconds: 60,
};

export const LABELS: LabelDef[] = [
  { lines: ['Vem do teste funcional', 'TV aprovada no pallet'], x: TEST_X0 + 1.6, y: 2.4, z: Z_TEST },
  { lines: ['1 · Transferência', 'JAKA Zu 50 + VGP30'], x: ROBOT.x - 0.4, y: 3.3, z: ROBOT.z },
  { lines: ['2 · Ensacadora automática'], x: BAG_X, y: BAGGER.h + 0.55, z: Z_PACK },
  { lines: ['3 · Cabine da verticalizadora', 'TV em pé na base com isopor'], x: UP_X, y: 3.35, z: (PIVOT_Z + Z_BASE) / 2 },
  { lines: ['Alimentador de bases', '(bases prontas com isopor)'], x: FEED_X, y: 1.55, z: Z_BASE - 1.1 },
  { lines: ['4 · Fechamento com a parte', 'superior · pórtico com ventosas'], x: COVER_X, y: GANTRY_Y + 0.6, z: (Z_MAG + Z_BASE) / 2 },
  { lines: ['Magazine de coberturas'], x: COVER_X, y: 2.0, z: MAG_Z0 + 0.3 },
  { lines: ['Espaço para 1 TV 75″'], x: (BUFFER_X0 + CABIN_X0) / 2, y: 1.45, z: Z_PACK + 0.9 },
  { lines: ['5 a 10 · Postos existentes', 'fechamento, conferência, etiqueta,', 'arqueação, paletização'], x: EXIST_X0 + 2.4, y: 2.7, z: Z_BASE },
];

export const FONT = '"Barlow Semi Condensed", "Segoe UI", Arial, sans-serif';
