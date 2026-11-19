import type * as THREE from 'three';
import type { Andon } from '../../sim/andon';
import type { Line, LineItem, Station } from '../../sim/line';
import type { Materials } from '../../sim/materials';
import type { Cobot } from '../../sim/robots/ur-arm';
import type { Pose, Step } from '../../sim/sequencer';
import type { Stage } from '../../sim/stage';
import type { Inch } from './config';
import type { TV } from './products';

/** How the two transfers share the work (see transfers.ts). 'auto' = the best measured per model. */
export type Mode = 'auto' | 'free' | 'A' | 'B';
export type Arms = 'both' | 't1' | 't2';

/** Assembly jig on the assembly belt: one or two TVs lying screen-down. */
export interface Jig extends LineItem {
  ledMat: THREE.MeshStandardMaterial;
  /** Seats; a TV taken by a robot leaves null. */
  tvs: (TV | null)[];
  inch: Inch;
  inspected: boolean;
  ng: boolean;
  /** Order among approved jigs (alternates jigs between the robots). */
  okIndex?: number;
  /** TVs of this jig already committed to the last robot. */
  toLast?: number;
}

/** Test pallet on the test belt: holds one TV standing. */
export interface Pallet extends LineItem {
  tvs: TV[];
  /** Left the buffer for a robot. */
  released: boolean;
}

export type TransferState = 'idle' | 'pick' | 'waitPallet' | 'place' | 'return';

export interface Transfer {
  arm: Cobot;
  x: number;
  /** Flange → cup row of the hook gripper. */
  D: number;
  wrap: (phi: number) => number;
  enabled: boolean;
  seq: Step[];
  pose: Pose;
  home: Pose;
  state: TransferState;
  job: Jig | null;
  /** Empty pallet docked at this robot. */
  pallet: Pallet | null;
  /** Pallets this robot still needs (TVs committed to it). */
  need: number;
  carried: TV | null;
  /** Pallet that just left with a TV; the hook stays behind until it has moved away. */
  leaving: Pallet | null;
  zoneBusy: boolean;
  addNeed: (n: number) => void;
  pickSt: Station<Jig>;
  gateSt: Station<Pallet>;
  placeSt: Station<Pallet>;
  // indicators
  count: number;
  busyT: number;
  totT: number;
  palT: number;
}

export interface Inspector {
  arm: Cobot;
  lens: THREE.Object3D;
  beam: THREE.Mesh;
  seq: Step[];
  pose: Pose;
  idle: Pose;
  state: 'idle' | 'scan';
  job: Jig | null;
  /** Flange height while scanning. */
  yW: number;
  alarmT: number;
  prog: number;
  busyT: number;
}

export interface Stats {
  /** Jigs approved / rejected by the inspection. */
  ok: number;
  ng: number;
  /** TVs approved / rejected / inspected. */
  okTV: number;
  ngTV: number;
  inspTV: number;
  /** TVs placed on test pallets. */
  moved: number;
  /** Simulated seconds since the last reset. */
  simT: number;
}

export interface Params {
  inch: Inch;
  arms: Arms;
  mode: Mode;
  simulateNG: boolean;
  /** Target UPH (TV/h). */
  uphTarget: number;
}

export interface Hmi { c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.Texture; mat: THREE.MeshBasicMaterial }

export interface World {
  stage: Stage;
  scene: THREE.Scene;
  M: Materials;
  asm: Line<Jig>;
  test: Line<Pallet>;
  robots: Transfer[];
  insp: Inspector;
  /** Empty pallets waiting before Transfer 1. */
  palletBuffer: Pallet[];
  stats: Stats;
  params: Params;
  /** Approved jigs so far (alternates jigs between the robots). */
  okCount: number;
  /** Empty pallets the buffer still owes the robots. */
  palletDemand: number;
  /** Should stay at zero: a good TV leaving on the assembly belt, an empty pallet leaving the test belt. */
  losses: { tv: number; emptyPallet: number };
  hmi: Hmi;
  inspAndon: Andon;
  floorRect: (x1: number, z1: number, x2: number, z2: number, w?: number) => void;
  /** Integrated flow (Intellifix AI page): jigs handed over by the screwdriving cell and not yet on the belt.
   *  Undefined on the Transfer Flow page itself, where assembly keeps feeding as fast as the belt has room. */
  inbox?: number;
}
