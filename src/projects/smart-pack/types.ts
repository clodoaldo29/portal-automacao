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
/** Box base on the box line: `inner` turns it so its length runs along the line (the TV standing sideways). */
export interface BoxItem extends LineItem { inner: THREE.Group; tv: TV | null; covered: boolean }
export type CoverItem = LineItem;

export interface Actor { seq: Step[]; pose: Pose }

export interface Robot extends Actor {
  arm: Cobot;
  state: 'idle' | 'busy';
  /** Pallet held at the pick stop. */
  pallet: PalletItem | null;
  carried: TV | null;
  /** Pallet the carried TV came from, and the TV just set down (the cups were on it): intended contact. */
  lastPallet: PalletItem | null;
  lastPlaced: TV | null;
  /** Stop one pallet before the pick point (interlock with the hook). */
  gate: Station<PalletItem>;
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
  boxes: Line<BoxItem>;
  mag: Line<CoverItem>;
  robot: Robot;
  /** item: the TV being bagged; inside: the TV in the cabin (one at a time); gate: stop before the cabin entry. */
  bagger: { item: PackItem | null; t: number; mouth: THREE.Object3D; inside: PackItem | null; gate: Station<PackItem> };
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
  /** Base infeed chute: bases waiting on it (slot 0 at the stopper), and the one sliding onto the box line. */
  feed: {
    queue: { obj: THREE.Group; inner: THREE.Group }[];
    moving: { obj: THREE.Group; inner: THREE.Group; t: number } | null;
    setStopper: (down: boolean) => void;
  };
  /** Empty base waiting under the clamps. */
  baseAt: BoxItem | null;
  /** Pallets due from the test line (feed at the line cadence). */
  due: number;
  stats: Stats;
  /** Collision check (bench, tests): smallest clearance seen since it was turned on, and between what. */
  clear?: { min: number; at: string; n: number; worst: Map<string, number> };
}
