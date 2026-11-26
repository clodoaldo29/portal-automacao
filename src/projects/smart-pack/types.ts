import type * as THREE from 'three';
import type { Line, LineItem, Station } from '../../sim/line';
import type { Materials } from '../../sim/materials';
import type { Cobot } from '../../sim/robots/ur-arm';
import type { Pose, Step } from '../../sim/sequencer';
import type { Feed, Inch, Timing } from './config';
import type { TV } from './products';

/** Test pallet on the end of the test line: one TV standing, or empty after the pick. */
export interface PalletItem extends LineItem { tv: TV | null }
/** TV lying screen-down on the packing line, with its bag (on once bagged). */
export interface PackItem extends LineItem { tv: TV; bag: THREE.Mesh; bagged: boolean }
/** Box base on the feeder or the box line: `inner` keeps the box square to the line on the feeder too. */
export interface BoxItem extends LineItem { inner: THREE.Group; tv: TV | null; covered: boolean }
export type CoverItem = LineItem;

export interface Actor { seq: Step[]; pose: Pose }

export interface Robot extends Actor {
  arm: Cobot;
  state: 'idle' | 'busy';
  /** Pallet held at the pick stop. */
  pallet: PalletItem | null;
  carried: TV | null;
  busyT: number;
  /** Largest IK error seen (m + weighted rad): the arm must reach every point. */
  maxErr: number;
}

export interface Params { inch: Inch; feed: Feed; timing: Timing }

export interface Stats {
  simT: number;
  /** TVs taken from the test line, bagged, set in a base, covered (packed), and boxes that left for station 5. */
  picked: number; bagged: number; boxed: number; packed: number; out: number;
  /** Busy time of the bagger, the upender (table and clamps) and the gantry. */
  bagT: number; upT: number; gantryT: number;
}

export interface World {
  scene: THREE.Scene;
  M: Materials;
  params: Params;
  test: Line<PalletItem>;
  pack: Line<PackItem>;
  feeder: Line<BoxItem>;
  boxes: Line<BoxItem>;
  mag: Line<CoverItem>;
  robot: Robot;
  bagger: { item: PackItem | null; t: number; mouth: THREE.Object3D };
  upender: Actor & {
    table: THREE.Object3D;
    /** Table free for the next TV (none on it or reserved for it). */
    free: boolean;
    /** TV standing on the table, waiting for the clamps. */
    tv: TV | null;
    tilted: boolean;
    gate: Station<PackItem>;
    stop: Station<PackItem>;
  };
  clamp: Actor & { group: THREE.Object3D; set: (x: number, padY: number, half: number) => void; tv: TV | null; busy: boolean };
  gantry: Actor & { head: THREE.Object3D; set: (z: number, cupY: number) => void; cover: CoverItem | null; target: BoxItem | null; busy: boolean };
  /** Base at the end of the feeder, under the clamps. */
  baseAt: BoxItem | null;
  /** Pallets due from the test line (feed at the line cadence). */
  due: number;
  stats: Stats;
}
