// Transfer Flow layout and product data. REAL SCALE: 1 scene unit = 1 metre.
// Everything is sized from the largest TV (75", ~1.68 × 0.97 m with bezel).
import type { LabelDef } from '../../sim/labels';
import type { ViewDef } from '../../sim/views';

export const INCHES = [32, 43, 50, 55, 65, 75] as const;
export type Inch = (typeof INCHES)[number];

/** TV outline [width, height] in metres (16:9 panel from the diagonal + ~1 cm bezel); confirm against each spec sheet. */
export const SIZES: Record<Inch, [number, number]> = { 32: [0.73, 0.43], 43: [0.97, 0.57], 50: [1.12, 0.65], 55: [1.24, 0.72], 65: [1.45, 0.84], 75: [1.68, 0.97] };
export const TV_T = 0.06; // body thickness
export const TV_BACK = 0.06; // back cover (electronics bump) distance from the panel centre
/** Line LTV01 cadence by size (TV/h), from the Intellifix AI PUR (Grupo Multi): the target of the indicators. */
export const LINE_UPH: Record<Inch, number> = { 32: 230, 43: 220, 50: 115, 55: 110, 65: 90, 75: 75 };

// conveyors
// conveyors as measured on the line: assembly 1195 mm inside / 1318 mm outside, 890 mm high; test 720 / 750 mm, 850 mm
// high (40 mm lower); 1545 mm between them, where the transfers stand
export const TOP = 0.89; // assembly belt top (also the screwdriving cell's conveyor)
export const TOP_TEST = 0.85; // test belt top
export const BELT_ASM = 1.195, BELT_TEST = 0.72; // inside widths
export const ASM_OUT = 1.318, TEST_OUT = 0.75, BELT_GAP = 1.545;
/** Belt centres: the gap as measured, the transfers (z = 0) where the far TV of a pair and the test pallet are equally far. */
export const Z_ASM = (ASM_OUT / 2 + BELT_GAP + TEST_OUT / 2 + 0.352) / 2, Z_TEST = Z_ASM - (ASM_OUT / 2 + BELT_GAP + TEST_OUT / 2);
export const ROBOT_Z = 0; // transfers midway between the belts (as in the first, validated version)
export const LINE_X0 = -8.3, LINE_X1 = 5.1; // 13.4 m of belt; ~15.8 m overall with the lift units
export const Z_PAL = Z_TEST; // in the middle of the (720 mm) test belt
export const SPEED_ASM = 0.6, SPEED_TEST = 0.8; // m/s
export const LIFT_OPEN = 2.1; // clear height: a 75" standing on a pallet reaches ~1.98 m

// assembly jig = the "base colchão" of the Intellifix AI screwdriving cell (the same pallet goes on): 1.8 × 1.2 m,
// aluminium frame and blue foam; a pair of 32"/43" side by side ACROSS the belt, or one 50"–75" centred
export const JIG_L = 1.8, JIG_W = 1.2, JIG_FRAME = 0.05, JIG_TOP = 0.11, TV_GAP = 0.06;
/** Minimum pitch of the jigs queued on the assembly belt (kept from the original 2.3 m jig + 10 cm: the transfer
 *  work split was tuned to it). */
export const ASM_PITCH = 2.4;
// test pallet (standard, one TV): 1.9 × 0.55 m, TV seated 0.13 m above the belt
export const PAL_W = 1.9, PAL_D = 0.55, SEAT_Y = 0.13;
export const ITEM_GAP = 0.1; // accumulation: queued items keep 10 cm apart

// transfer robots (JAKA Zu 50) with the hook gripper: a bracket along the tool axis to a row of cups that face sideways. It
// picks the TV lying screen-down with the tool horizontal and stands it in the test pallet screen toward the robots,
// the hook reaching over the TV to hold its back.
// flange → cup row · bracket axis → cup face · grip point below the TV's top edge (the edge nearest the robot at the pick)
// gripper: a hook with an OnRobot VGP30 vacuum plate (compressed air ~6.3 bar at the gripper for its 60 % vacuum; its
// vacuum sensor interlocks the move). The plate holds the TV at half its height (its centre of mass): standing in the
// pallet the cups hold it by friction, with no moment peeling the top cups off; hence a 60 cm hook.
export const HOOK_D = 0.6, CUP_Z = 0.28; // cups 28 cm off the bracket: the wrist stays over the jig foam at the pick
/**
 * Option ?garra=direta (comparison; the hook stays the default): the VGP30 straight on the flange, no hook, and the TV
 * standing in the test pallet with its BACK toward the robots (screen toward the operator aisle, label at the bottom):
 * picked from above, turned half a turn with the robot while its top edge tilts up, set down in the pallet. DIRECT_D: flange → cup faces (VGP30 88.2 mm with its cups, plus the flange adapter and a spacer).
 */
export const DIRECT = typeof location !== 'undefined' && new URLSearchParams(location.search).get('garra') === 'direta';
export const DIRECT_D = 0.2; // with a 100 mm spacer: the 390 mm plate clears the wrist
/** Grip point below the top edge for this TV: the plate centred on its height. */
export const gripOf = (inch: Inch) => SIZES[inch][1] / 2;
export const TRANSFER_PED = 0.8; // pedestal height: the Zu 50 reaches over a 75" standing in the pallet (top at ~1.94 m) from 0.8 m (at 0.6 m its forearm meets that TV)
export const ROBOT_X1 = -2.0, ROBOT_X2 = 2.0; // work stations (pick stop, pallet dock), 4.0 m apart: room for one full pallet queued between them
/** Each transfer's pedestal stands this far upstream of its stations: the TV of a 32"/43" pair nearest the robot is
 *  not right over the pedestal, so the arm reaches it without folding on itself. */
export const ARM_DX = 0.5;
export const BUFFER_X = ROBOT_X1 - 2.25; // empty-pallet buffer just before Transfer 1
/** Back-cover height of a TV lying screen-down on the jig. */
export const PICK_Y = TOP + JIG_TOP + TV_T / 2 + TV_BACK;

// inspection cell (2.4 × 1.8 × 2.3 m) beside the assembly belt, open side facing the belt, 3.8 m before Transfer 1
export const CELL = { x: -5.8, z: Z_ASM + BELT_ASM / 2 + 0.1 + 0.9, w: 2.4, d: 1.8, h: 2.3 };

export const FENCE_Z = -3.05; // 1.4 m aisle behind the test belt, where the screens face

/** 32" and 43": two TVs side by side across the jig (one TV per test pallet). 50" and up: one TV, centred. */
export const slotsFor = (inch: Inch) => (inch <= 43 ? 2 : 1);
/** Offset across the belt of TV k on the jig: TV 0 on the robots' side (−z), TV 1 on the far side. */
export const slotZ = (inch: Inch, k: number) => (slotsFor(inch) === 2 ? (k === 0 ? -1 : 1) * (SIZES[inch][1] / 2 + TV_GAP / 2) : 0);

export const SHADOW_FRUSTUM = { left: -14, right: 14, top: 10, bottom: -10, near: 1, far: 70 };

export const VIEWS: Record<string, ViewDef> = {
  persp: { pos: [-1.6, 6.4, 12], target: [-1.6, 0.6, 0] },
  robots: { pos: [4.6, 2.7, 3.4], target: [0, 1.1, 0] },
  insp: { pos: [-2.8, 2.5, 5.6], target: [-5.8, 1.2, 1.7] },
  test: { pos: [0, 2.3, 3.6], target: [0, 1.4, -0.75] }, // facing the screens on the test belt
  top: { pos: [0, 17, 0.01], target: [-1.6, 0, 0.3] },
};

export const TOUR = {
  positions: [[-9, 3, 6], [-3.5, 2, 5], [0.5, 2.2, 4], [5, 2.5, 2.8], [6, 3, -2], [2, 2, -2.4], [-3, 2.3, -2.4], [-9, 3.2, -1]] as [number, number, number][],
  targets: [[-5, 1, 1.5], [-5.4, 1.1, 1.6], [-1.6, 1.1, 0], [1.6, 1.1, 0], [1.5, 1.2, -1], [0, 1.3, -0.95], [-1.6, 1.2, -0.5], [-5, 1, 0.5]] as [number, number, number][],
  seconds: 60,
};

export const LABELS: LabelDef[] = [
  { lines: ['Esteira de Montagem'], x: LINE_X1 - 1.2, y: 1.7, z: Z_ASM + 0.2 },
  { lines: ['Esteira de Teste'], x: LINE_X0 + 1.0, y: 1.9, z: Z_TEST },
  { lines: ['Inspeção Visual', 'com Robô (IA) · UR10e'], x: CELL.x, y: 2.75, z: CELL.z + 0.3 },
  { lines: ['Transfer 1 · JAKA Zu 50', 'Telas 32” a 75”'], x: ROBOT_X1 - ARM_DX, y: 3.25, z: ROBOT_Z },
  { lines: ['Transfer 2 · JAKA Zu 50', 'Telas 32” a 75”'], x: ROBOT_X2 - ARM_DX, y: 3.25, z: ROBOT_Z },
  { lines: ['Pulmão de pallets'], x: BUFFER_X - 1.2, y: 2.3, z: Z_TEST - 0.3 },
];

export const FONT = '"Barlow Semi Condensed", "Segoe UI", Arial, sans-serif';
