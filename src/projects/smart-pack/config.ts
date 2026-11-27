// Smart Pack layout and product data (Grupo Multi, flow TO-BE v4, stations 1 to 4). REAL SCALE: 1 unit = 1 metre.
//
// Top view (x along the flow, z across):
//   z = 0      end of the test line (the TV stands in the test pallet, screen toward +z, as on the Transfer Flow test belt)
//   z = −1.25  station 1: JAKA Zu 50 with the OnRobot VGP30 on the flange, on the TV's back side
//   z = −2.55  packing line: infeed → station 2 bagger → station 3 upender. The TV lies as on the Transfer Flow assembly
//              belt: screen down, its width along the belt, its top edge toward the robot.
//   z = −4.0   box line, parallel to the packing line: the bases (with the EPS corners) are prepared at its start, get
//              the TV standing sideways at station 3, the box body at station 4 (tube erector on the −z side), then go on to
//              the existing stations 5 to 10 (grey, not animated)
// Distance between the lines is PROVISIONAL (flow document, pending item "distância e desníveis entre linhas").
import type { LabelDef } from '../../sim/labels';
import type { ViewDef } from '../../sim/views';
import { BELT_ASM, INCHES, LINE_UPH, PAL_W, SEAT_Y, SIZES, TOP_TEST, TV_BACK, TV_T, type Inch } from '../transfer-flow/config';

export { INCHES, LINE_UPH, PAL_W, SEAT_Y, SIZES, TV_BACK, TV_T, type Inch };

// ---------- test line (end of it: the TV comes from the functional test) ----------
export const Z_TEST = 0, Y_TEST = TOP_TEST, BELT_TEST = 0.72, TEST_OUT = 0.75;
export const TEST_X0 = -12, TEST_X1 = 18.2; // along the whole layout; pallets return under the belt through the lift at the end
/** Release stop of the test line: the line comes full from the functional test (pallets queued behind this stop) and
 *  one TV is let go at the line cadence of the model. */
export const RELEASE_X = -4.6;
export const SPEED_TEST = 0.8;
/** Station 1 sits where the infeed has room behind the bagger for two TVs waiting, 75" included (see DROP_X). */
export const STATION_X = -0.4;
export const PICK_X = STATION_X; // pallet stop of station 1

// ---------- station 1: transfer robot ----------
export const ROBOT = { x: STATION_X, z: -1.25, ped: 0.8 };
/** Flange → cup faces of the VGP30 straight on the flange (adapter and a 100 mm spacer). */
export const GRIP_D = 0.2;

// ---------- JAKA Zu 50 data (Hardware User Manual Zu15/Zu35/Zu50, V02: table 4-1 and figure 4-30) ----------
/** Rated joint speeds, °/s (joints 1 to 6). */
export const ZU50_JOINT_DEG_S = [110, 110, 150, 200, 200, 200];
/** Share of the rated joint speeds the station is programmed to (a heavy TV on the flange: not 100 %). */
export const JOINT_USE = 0.8;
/** Load capacity: payload (kg) against the distance of its centre of gravity from the flange (mm), read off fig. 4-30. */
const ZU50_LOAD: [number, number][] = [[0, 50], [40, 50], [110, 48], [200, 43], [300, 36.5], [400, 32], [500, 28.5], [600, 25]];
export function zu50Capacity(mm: number) {
  for (let i = 1; i < ZU50_LOAD.length; i++) {
    const [x0, y0] = ZU50_LOAD[i - 1], [x1, y1] = ZU50_LOAD[i];
    if (mm <= x1) return y0 + ((Math.max(mm, x0) - x0) / (x1 - x0)) * (y1 - y0);
  }
  return ZU50_LOAD[ZU50_LOAD.length - 1][1];
}
/** TV mass, kg (panel without stand). PROVISIONAL estimates for typical panels: replace with the Multi data. */
export const TV_KG: Record<Inch, number> = { 32: 5, 43: 8, 50: 11, 55: 15, 65: 23, 75: 33 };
/** OnRobot VGP30 with its adapter and spacer: mass (kg, estimate) and centre of gravity from the flange (m). */
export const GRIPPER_KG = 4.5, GRIPPER_COG = 0.08;
/** What the Zu 50 carries: TV + gripper, their centre of gravity from the flange and the manual's limit there. */
export function payloadOf(inch: Inch) {
  const tv = TV_KG[inch], kg = tv + GRIPPER_KG;
  const mm = ((tv * (GRIP_D + TV_BACK) + GRIPPER_KG * GRIPPER_COG) / kg) * 1000; // TV centre: cups + back cover depth
  const cap = zu50Capacity(mm);
  return { tv, kg, mm, cap, use: kg / cap };
}

// ---------- packing line (TV lying screen-down, width along the belt, top edge toward the robot) ----------
/** Bagging belt: as wide as the Transfer Flow assembly belt (BELT_ASM, 1.195 m inside). */
export const Z_PACK = -2.55, Y_PACK = 0.85, BELT_PACK = BELT_ASM, PACK_X0 = -1.5, SPEED_PACK = 0.6;
/** Where the robot sets the TV down: the last place of the queue before the bagger (1 inside, 2 waiting). */
export const DROP_X = STATION_X;
/** TVs that may wait on the infeed for the bagger (the one inside not counted). */
export const QUEUE_MAX = 2;
/** Every TV is set down with its bottom edge on this line (far side of the belt): the upender pivots there. */
export const Z_EDGE = Z_PACK - 0.45;
/** Station 2: automatic bagger (housing from x0 to x1, w across); the TV stops in the middle for the bag. */
export const BAGGER = { x0: 2.4, x1: 5.4, w: 2.0, h: 2.15 };
export const BAG_X = (BAGGER.x0 + BAGGER.x1) / 2;
/** Station 3: upender table from TABLE_X0 along x (TABLE_L), pivoting about an axis along x at its far edge (PIVOT_Z),
 *  where the foot stop is: the TV stands up sideways. */
/** Between the bagger and the upender cabin: belt room for one 75" TV waiting (BUFFER_X0 to CABIN_X0). */
export const BUFFER_X0 = BAGGER.x1, CABIN_X0 = BUFFER_X0 + 1.9, CABIN_L = 2.8;
export const TABLE_X0 = CABIN_X0 + 0.4, TABLE_L = 2.0, UP_X = TABLE_X0 + TABLE_L / 2, PIVOT_Z = Z_EDGE - 0.02;
/** Upender table depth: from the pivot (foot stop) to the near edge of the bagging belt, so the conveyor in the cabin is as wide as the belt. */
export const TABLE_D = Z_PACK + BELT_PACK / 2 - PIVOT_Z;

// ---------- box line (lower, parallel to the packing line) ----------
export const Y_BOX = 0.5, Z_BASE = -4.0, BELT_BOX = 0.7, SPEED_BOX = 0.3;
/** Box line from the base feeder (start) to the end; the TV goes into the base at UP_X. */
/** The bases come ready (EPS corners in place): a feeder (magazine with the stack of bases) sets them on the start of the
 *  box line, one at a time, at FEED_X. */
export const FEED_X = BAG_X, BOX_X0 = FEED_X - 1.2, BOX_END = 18.2; // the base infeed beside the bagger; the box line starts there
/**
 * Station 4: the box bodies come folded flat, stacked on a pallet. A tube erector (far side of the box line) takes the top
 * one, stands it up and opens it into a tube on its table at Z_MAG; the gantry takes the open tube there by its long
 * sides and lowers it over the TV onto the base. The top flaps stay open (kit and EPS go in at station 5).
 */
export const COVER_X = CABIN_X0 + CABIN_L + 1.45, Z_MAG = Z_BASE - 0.62, MAG_Z0 = Z_BASE - 3.2, GANTRY_Y = 3.7;
/**
 * Tube erector: the stack of folded boxes on a lift table (its top kept at yS; fed from outside with a pallet jack),
 * centred at zS; folded box thickness (two walls) and boxes per pallet (stack about 1 m high). PROVISIONAL.
 */
export const ERECT = { zS: Z_MAG - 1.55, yS: 1.45, sheet: 0.012, n: 80 };
/** Erector axes (m/s), the turn from lying to standing and the opening (s); the gantry axes run at 0.8 m/s. PROVISIONAL. */
export const ERECT_SPEED = { z: 0.8, y: 0.6, turnS: 1.0, openS: 1.2 };
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
  robo: { pos: [-3.6, 2.9, 1.9], target: [-0.4, 1.2, -1.5] },
  ensaque: { pos: [1.2, 2.6, 0.6], target: [4.2, 1.0, -2.6] },
  vertical: { pos: [UP_X + 2.6, 2.7, -0.9], target: [UP_X, 1.0, -3.3] },
  bases: { pos: [-6.5, 7.5, -10.5], target: [5, 0.6, -2.8] }, // from the far side: the box line parallel to the packing line
  cobertura: { pos: [15.2, 3.6, -1.6], target: [COVER_X, 1.2, -4.9] },
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
  { lines: ['4 · Caixa por cima da TV', 'formadora de tubo + pórtico'], x: COVER_X, y: GANTRY_Y + 0.6, z: (Z_MAG + Z_BASE) / 2 },
  { lines: ['Caixas dobradas', '(pilha na mesa elevatória)'], x: COVER_X, y: 2.1, z: ERECT.zS - 0.5 },
  { lines: ['Espaço para 1 TV 75″'], x: (BUFFER_X0 + CABIN_X0) / 2, y: 1.45, z: Z_PACK + 0.9 },
  { lines: ['5 a 10 · Postos existentes', 'fechamento, conferência, etiqueta,', 'arqueação, paletização'], x: EXIST_X0 + 2.4, y: 2.7, z: Z_BASE },
];

export const FONT = '"Barlow Semi Condensed", "Segoe UI", Arial, sans-serif';
