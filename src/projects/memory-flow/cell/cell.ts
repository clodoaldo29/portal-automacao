// Post-dicing AI inspection cell (proposal for area P01C, in place of the two manual benches INS01/INS02).
// REAL SCALE (metres). A UR10e with a fork end effector moves 300 mm wafer frames from the input cassette to an
// XY stage under a fixed camera, then to the output cassette. The stage scans the wafer in stripes while the
// AI classifies every die; at the end of the lot an AMR swaps the cassettes.
//
// Cell frame: origin at the cell centre on the floor, +z towards the corridor (front), robot at the back.
import * as THREE from 'three';
import { createAndons } from '../../../sim/andon';
import { at, box, canvasTex, cyl, mk, shadowify, std } from '../../../sim/kit';
import type { Materials } from '../../../sim/materials';
import { armClearance, obstacleBox, orientedObstacle, type Obstacle } from '../../../sim/robots/collision';
import { LED, makeCobot, poseAt, solve, upgradeArm, urTrack, type Cobot } from '../../../sim/robots/ur-arm';
import { UR10E } from '../../../sim/robots/ur-kinematics';
import { runSeq, type Pose, type Step } from '../../../sim/sequencer';
import { makeAmr } from '../actors';
import { CLASSES, drawWafer, makeWaferMap, type WaferMap } from './wafer';

export const SLOTS = 25;
export const CELL_DIM = { x0: -1.5, x1: 1.5, z0: -1.45, z1: 1.0, h: 2.1 };
const ROBOT = { x: 0, z: -0.85, ped: 0.7 };
const STAGE = { x: 0, z: 0.35 };
/** Chuck top (frame rests here when the pins are down) and pin stroke. */
const CHUCK_TOP = 0.93, PIN = 0.03;
const CASS = [{ x: -0.92, z: 0.0 }, { x: 0.92, z: 0.0 }];
const CASS_BASE = 0.84, SLOT0 = 0.02, PITCH = 0.012;
/** Fork end effector: frame centre sits FORK_DOWN below the flange and FORK_F ahead of it. */
const FORK_DOWN = 0.129, FORK_F = 0.34; // long enough for the wrist to stay outside the cassette
/** Fork stand-off when entering a cassette or the stage (frame centre distance). */
const OUT = 0.42;
const STRIPES = 10;

export interface CellParams {
  /** Seconds the stage takes to scan one wafer. */
  scanS: number;
  /** Reject a wafer above this share of defective dies (%). */
  rejectPct: number;
  /** Target wafers per hour (OEE performance). */
  target: number;
  /** Worn dicing blade: much more chipping. */
  worn: boolean;
}
export const DEFAULT_CELL_PARAMS: CellParams = { scanS: 80, rejectPct: 3, target: 36, worn: false };

type V3 = { x: number; y: number; z: number };

interface Frame { obj: THREE.Group; wafer: THREE.Mesh }

export interface CellStats {
  t: number;
  wafers: number;
  ok: number;
  ng: number;
  lots: number;
  dies: number;
  counts: [number, number, number, number, number];
  review: number;
  scanT: number;
  robotT: number;
  swapT: number;
  maxIkErr: number;
  /** Smallest clearance between the arm links and the equipment (the fork goes into the cassettes by design). */
  minClear: number;
  minClearAt: string;
}

const newStats = (): CellStats => ({ t: 0, wafers: 0, ok: 0, ng: 0, lots: 0, dies: 0, counts: [0, 0, 0, 0, 0], review: 0, scanT: 0, robotT: 0, swapT: 0, maxIkErr: 0, minClear: Infinity, minClearAt: '' });

/** Ring frame (300 mm wafer frame) with tape and the wafer. */
function makeFrameGeometry() {
  const s = 0.2, c = 0.035, shape = new THREE.Shape();
  shape.moveTo(-s + c, -s); shape.lineTo(s - c, -s); shape.lineTo(s, -s + c); shape.lineTo(s, s - c);
  shape.lineTo(s - c, s); shape.lineTo(-s + c, s); shape.lineTo(-s, s - c); shape.lineTo(-s, -s + c); shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.175, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const ring = new THREE.ExtrudeGeometry(shape, { depth: 0.0015, bevelEnabled: false, curveSegments: 40 });
  ring.rotateX(-Math.PI / 2);
  return ring;
}

export function createCell(scene: THREE.Scene, M: Materials, origin: THREE.Vector3, font: string) {
  const root = new THREE.Group();
  root.position.copy(origin);
  scene.add(root);
  const L = (x: number, y: number, z: number) => new THREE.Vector3(origin.x + x, y, origin.z + z);
  const params: CellParams = { ...DEFAULT_CELL_PARAMS };

  // ---------- enclosure ----------
  const { x0, x1, z0, z1, h } = CELL_DIM, cw = x1 - x0, cd = z1 - z0, cz = (z0 + z1) / 2;
  for (const x of [x0, x1]) for (const z of [z0, z1]) root.add(at(box(0.06, h, 0.06, M.alu), x, h / 2, z));
  for (const z of [z0, z1]) root.add(at(box(cw, 0.06, 0.06, M.alu), 0, h, z));
  for (const x of [x0, x1]) root.add(at(box(0.06, 0.06, cd, M.alu), x, h, cz));
  for (const z of [z0, z1]) root.add(at(box(cw, 0.05, 0.05, M.alu), 0, 0.75, z));
  for (const x of [x0, x1]) root.add(at(box(0.05, 0.05, cd, M.alu), x, 0.75, cz));
  const glass = new THREE.MeshStandardMaterial({ color: 0xbcd6ea, transparent: true, opacity: 0.14, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const panel = (w: number, x: number, z: number, ry: number, y0 = 0.05, y1 = h - 0.05) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, y1 - y0), glass);
    p.rotation.y = ry;
    p.position.set(x, (y0 + y1) / 2, z);
    p.userData.noShadow = true;
    root.add(p);
  };
  panel(cw, 0, z0, 0); panel(cd, x0, cz, Math.PI / 2); panel(cd, x1, cz, Math.PI / 2);
  panel(cw, 0, z1, 0, 1.15, h - 0.05); // front: open below for the cassette ports, light curtain
  for (const x of [x0 + 0.02, x1 - 0.02]) root.add(at(box(0.04, 1.0, 0.04, std(0x15171b, 0.2, 0.4)), x, 0.6, z1));
  root.add(at(box(cw - 0.2, 0.05, 0.12, new THREE.MeshBasicMaterial({ color: 0xffffff })), 0, h - 0.06, cz)); // light bar
  // floor marking around the cell
  const tape = new THREE.MeshBasicMaterial({ color: 0xf2c230 });
  for (const [w, d, x, z] of [[cw + 0.5, 0.1, 0, z0 - 0.25], [cw + 0.5, 0.1, 0, z1 + 0.25], [0.1, cd + 0.5, x0 - 0.25, cz], [0.1, cd + 0.5, x1 + 0.25, cz]] as const) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), tape);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.015, z);
    m.userData.noShadow = true;
    root.add(m);
  }

  // ---------- stage: cabinet, granite, XY carriage, chuck with lift pins, camera bridge ----------
  root.add(at(box(1.0, 0.82, 0.8, M.cabinet), STAGE.x, 0.41, STAGE.z));
  root.add(at(box(0.94, 0.06, 0.76, std(0x2b2f36, 0.1, 0.35)), STAGE.x, 0.85, STAGE.z));
  const xCarriage = new THREE.Group();
  xCarriage.position.set(STAGE.x, 0.88, STAGE.z);
  root.add(xCarriage);
  xCarriage.add(at(box(0.62, 0.025, 0.5, M.aluDark), 0, 0.0125, 0));
  const chuck = new THREE.Group(); // origin at the chuck top
  chuck.position.y = CHUCK_TOP - 0.88;
  xCarriage.add(chuck);
  chuck.add(at(cyl(0.2, 0.2, 0.02, std(0x9aa1a9, 0.6, 0.25), 48), 0, -0.01, 0));
  chuck.add(at(cyl(0.16, 0.16, 0.022, std(0x5b6170, 0.4, 0.2), 48), 0, -0.01, 0));
  const pins = [0, 1, 2].map(i => { const p = cyl(0.006, 0.006, PIN + 0.01, M.alu, 8); p.position.set(Math.cos(i * 2.094) * 0.12, -0.005, Math.sin(i * 2.094) * 0.12); chuck.add(p); return p; });
  for (const sx of [-1, 1]) root.add(at(box(0.08, 0.7, 0.08, M.alu), STAGE.x + sx * 0.52, 0.88 + 0.35, STAGE.z + 0.36));
  root.add(at(box(1.12, 0.1, 0.1, M.alu), STAGE.x, 1.58, STAGE.z + 0.36));
  root.add(at(box(0.1, 0.06, 0.4, M.alu), STAGE.x, 1.58, STAGE.z + 0.18));
  root.add(at(box(0.12, 0.22, 0.12, M.black), STAGE.x, 1.46, STAGE.z));
  root.add(at(cyl(0.05, 0.05, 0.12, M.aluDark, 20), STAGE.x, 1.3, STAGE.z));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 8, 40), new THREE.MeshBasicMaterial({ color: 0xdff4ff }));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(STAGE.x, 1.24, STAGE.z);
  root.add(ring);
  const coneGeo = new THREE.ConeGeometry(0.035, 1, 4, 1, true);
  coneGeo.translate(0, -0.5, 0);
  coneGeo.rotateY(Math.PI / 4);
  const beam = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  beam.position.set(STAGE.x, 1.24, STAGE.z);
  beam.scale.set(1, 1.24 - CHUCK_TOP, 1);
  beam.userData.noShadow = true;
  beam.visible = false;
  root.add(beam);

  // ---------- cassettes on their load ports (openings face the robot) ----------
  const cassYaw = CASS.map(c => Math.atan2(ROBOT.x - c.x, ROBOT.z - c.z)); // local +z of the cassette points at the robot
  /** Fork direction to enter a cassette: from the robot into the opening (opposite of the cassette front). */
  const forkYaw = cassYaw.map(y => Math.atan2(-Math.sin(y), -Math.cos(y)));
  const cassMat = std(0xd9dde2, 0.2, 0.4), railMat = std(0x8a929b, 0.5, 0.4);
  const wallMat = std(0xc9d6e3, 0.1, 0.2, { transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }); // translucent cassette walls: the frames show
  CASS.forEach((c, i) => {
    root.add(at(box(0.62, 0.82, 0.62, M.cabinet), c.x, 0.41, c.z));
    root.add(at(box(0.62, 0.01, 0.62, M.aluDark), c.x, 0.825, c.z));
    const g = new THREE.Group();
    g.position.set(c.x, CASS_BASE, c.z);
    g.rotation.y = cassYaw[i];
    root.add(g);
    const H = 0.36;
    g.add(at(box(0.46, 0.012, 0.44, cassMat), 0, 0.006, 0));
    g.add(at(box(0.46, 0.012, 0.44, cassMat), 0, H, 0));
    for (const sx of [-1, 1]) {
      g.add(at(box(0.012, H, 0.44, wallMat), sx * 0.23, H / 2, 0));
      for (let k = 0; k < SLOTS; k++) g.add(at(box(0.02, 0.003, 0.4, railMat), sx * 0.215, SLOT0 + k * PITCH - 0.003, 0));
    }
    g.add(at(box(0.46, H, 0.012, wallMat), 0, H / 2, -0.22));
    g.add(at(box(0.3, 0.02, 0.02, M.aluDark), 0, H + 0.02, 0)); // handle
  });
  const slotPos = (ci: number, k: number): V3 => ({ x: CASS[ci].x, y: CASS_BASE + SLOT0 + k * PITCH, z: CASS[ci].z });

  // ---------- frames and wafers ----------
  const ringGeo = makeFrameGeometry();
  const ringMat = std(0xb8bfc7, 0.85, 0.25), tapeMat = std(0x8fc6e8, 0.0, 0.3, { transparent: true, opacity: 0.55, depthWrite: false });
  const plain = mk(256, 256);
  drawWafer(plain[1], 256, null);
  const plainTex = canvasTex(plain[0]);
  const plainMat = std(0xffffff, 0.35, 0.25, { map: plainTex });
  const live = mk(512, 512);
  const liveTex = canvasTex(live[0]);
  const liveMat = std(0xffffff, 0.35, 0.25, { map: liveTex, emissive: new THREE.Color(0xffffff), emissiveMap: liveTex, emissiveIntensity: 0.25 });
  const tapeGeo = new THREE.CircleGeometry(0.18, 48), waferGeo = new THREE.CircleGeometry(0.15, 64);
  const frames: Frame[] = Array.from({ length: SLOTS }, () => {
    const obj = new THREE.Group();
    obj.add(new THREE.Mesh(ringGeo, ringMat));
    const tp = new THREE.Mesh(tapeGeo, tapeMat);
    tp.rotation.x = -Math.PI / 2; tp.position.y = 0.0006; tp.userData.noShadow = true;
    obj.add(tp);
    const wafer = new THREE.Mesh(waferGeo, plainMat);
    wafer.rotation.x = -Math.PI / 2; wafer.position.y = 0.0018;
    obj.add(wafer);
    shadowify(obj);
    tp.castShadow = false;
    return { obj, wafer };
  });
  const inCass: (Frame | null)[] = Array(SLOTS).fill(null), outCass: (Frame | null)[] = Array(SLOTS).fill(null);
  const seat = (f: Frame, ci: number, k: number) => {
    scene.attach(f.obj);
    const p = slotPos(ci, k);
    f.obj.position.copy(L(p.x, p.y, p.z));
    f.obj.rotation.set(0, cassYaw[ci], 0);
    (ci === 0 ? inCass : outCass)[k] = f;
  };
  frames.forEach((f, k) => seat(f, 0, k));

  // ---------- robot: UR10e with the fork end effector ----------
  const arm: Cobot = makeCobot(scene, M, { x: origin.x + ROBOT.x, z: origin.z + ROBOT.z, L1: 0.61, L2: 0.57, ped: ROBOT.ped, pedW: 0.36 });
  arm.tool.rotation.order = 'YXZ';
  const fork = new THREE.Group();
  arm.mount.add(fork);
  fork.add(at(cyl(0.045, 0.045, 0.04, M.aluDark, 20), 0, -0.02, 0));
  fork.add(at(box(0.05, 0.12, 0.04, M.alu), 0, -0.08, 0));
  fork.add(at(box(0.14, 0.03, 0.1, M.aluDark), 0, -0.12, 0.04));
  fork.add(at(box(0.06, 0.006, 0.36, std(0x2b2f36, 0.3, 0.35)), -0.07, -FORK_DOWN + 0.003, FORK_F));
  fork.add(at(box(0.06, 0.006, 0.36, std(0x2b2f36, 0.3, 0.35)), 0.07, -FORK_DOWN + 0.003, FORK_F));
  fork.add(at(box(0.2, 0.006, 0.06, std(0x2b2f36, 0.3, 0.35)), 0, -FORK_DOWN + 0.003, FORK_F - 0.15));
  fork.add(at(box(0.06, 0.008, FORK_F - 0.21, M.aluDark), 0, -FORK_DOWN + 0.004, (0.06 + FORK_F - 0.15) / 2)); // stem from the bracket to the blades
  for (const [x, z] of [[-0.07, FORK_F - 0.12], [0.07, FORK_F - 0.12], [-0.07, FORK_F + 0.14], [0.07, FORK_F + 0.14]]) fork.add(at(cyl(0.012, 0.012, 0.004, M.rubber, 12), x, -FORK_DOWN + 0.007, z));
  fork.add(at(box(0.05, 0.04, 0.05, M.blue), 0, -0.06, -0.04)); // vacuum generator
  shadowify(fork);
  const forkPoint = new THREE.Object3D();
  forkPoint.position.set(0, -FORK_DOWN + 0.006, FORK_F);
  fork.add(forkPoint);

  /** Pose that puts the frame centre (on the fork) at local point c, fork pointing along yaw. */
  const P = (c: V3, yaw: number): Pose => {
    const fx = c.x - Math.sin(yaw) * FORK_F, fz = c.z - Math.cos(yaw) * FORK_F;
    const w = L(fx, c.y + FORK_DOWN, fz);
    return [...poseAt(arm, w.x, w.z, w.y), 0, yaw];
  };
  const back = (c: V3, yaw: number, dy = 0): V3 => ({ x: c.x - Math.sin(yaw) * OUT, y: c.y + dy, z: c.z - Math.cos(yaw) * OUT });
  const up = (c: V3, dy: number): V3 => ({ x: c.x, y: c.y + dy, z: c.z });
  const stageC: V3 = { x: STAGE.x, y: CHUCK_TOP, z: STAGE.z };
  const idle = P({ x: STAGE.x, y: 1.2, z: STAGE.z - 0.55 }, 0);
  upgradeArm(scene, arm, idle, UR10E);

  // ---------- AMR that swaps the cassettes ----------
  const amr = makeAmr();
  amr.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  const amrCass = new THREE.Group();
  amrCass.add(at(box(0.46, 0.36, 0.44, cassMat), 0, 0.18, 0));
  amrCass.position.y = 0.37;
  amr.add(amrCass);
  scene.add(amr);
  const AMR_FAR = L(0, 0, 9), AMR_DOCK = L(0, 0, z1 + 0.75);

  // ---------- HMI, andon ----------
  const [hc, hg] = mk(640, 400);
  const hTex = canvasTex(hc);
  const cab = new THREE.Group();
  cab.position.set(x1 + 0.45, 0, z1 - 0.2);
  root.add(cab);
  cab.add(at(box(0.6, 1.5, 0.45, M.cabinet), 0, 0.75, 0));
  cab.add(at(box(0.66, 0.44, 0.05, M.black), 0, 1.5, 0.2));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.39), new THREE.MeshBasicMaterial({ map: hTex, toneMapped: false }));
  scr.position.set(0, 1.5, 0.23);
  cab.add(scr);
  cab.rotation.y = -0.35;
  shadowify(cab);
  const andons = createAndons(M);
  const andon = andons.make(root, x1 - 0.1, h, z1 - 0.1);

  // ---------- state ----------
  type StageState = 'empty' | 'loading' | 'scan' | 'done';
  const st = {
    stage: 'empty' as StageState, frame: null as Frame | null, slot: -1, prog: 0, map: null as WaferMap | null, last: null as WaferMap | null,
    pin: 0, pinTarget: 0, lot: 1, next: SLOTS - 1, placed: 0, amr: 'away' as 'away' | 'coming' | 'docked' | 'leaving', amrT: 0, swapT: 0,
    alarmT: 0, held: null as Frame | null,
  };
  const actor = { seq: [] as Step[], pose: idle.slice() };
  let stats = newStats();
  let iters = 4;

  const take = (f: Frame) => { forkPoint.attach(f.obj); f.obj.position.set(0, 0, 0); f.obj.rotation.set(0, 0, 0); st.held = f; };
  const dropOnChuck = (f: Frame) => { chuck.attach(f.obj); f.obj.position.set(0, PIN, 0); f.obj.rotation.set(0, 0, 0); st.held = null; };

  const MOVE = 1.4, SLIDE = 0.7, LIFT = 0.35;
  /** Unload the scanned wafer and put it in the same slot of the output cassette. */
  function unloadSeq(): Step[] {
    const k = st.slot, dst = slotPos(1, k), yaw = forkYaw[1];
    const lo = up(stageC, PIN - 0.004), hi = up(stageC, PIN + 0.004);
    return [
      { fn: () => { st.pinTarget = 1; } }, { until: () => st.pin >= 1 },
      { to: P(back(lo, 0), 0), dur: MOVE }, { to: P(lo, 0), dur: SLIDE },
      { fn: () => { take(st.frame!); st.frame = null; st.stage = 'empty'; st.pin = st.pinTarget = 0; } },
      { to: P(hi, 0), dur: LIFT }, { to: P(back(hi, 0), 0), dur: SLIDE },
      { to: P(back(up(dst, 0.004), yaw), yaw), dur: MOVE }, { to: P(up(dst, 0.004), yaw), dur: SLIDE }, { to: P(up(dst, -0.004), yaw), dur: LIFT },
      { fn: () => { seat(st.held!, 1, k); st.held = null; st.placed++; if (st.placed === SLOTS) callAmr(); } },
      { to: P(back(up(dst, -0.004), yaw), yaw), dur: SLIDE },
    ];
  }
  /** Take the next wafer from the input cassette and load it on the stage; the scan starts when the fork is out. */
  function loadSeq(): Step[] {
    const k = st.next, src = slotPos(0, k), yaw = forkYaw[0];
    const lo = up(stageC, PIN - 0.004), hi = up(stageC, PIN + 0.004);
    st.next--;
    if (st.next < 0) callAmr();
    st.stage = 'loading';
    return [
      { to: P(back(up(src, -0.004), yaw), yaw), dur: MOVE }, { to: P(up(src, -0.004), yaw), dur: SLIDE },
      { fn: () => { take(inCass[k]!); inCass[k] = null; } },
      { to: P(up(src, 0.004), yaw), dur: LIFT }, { to: P(back(up(src, 0.004), yaw), yaw), dur: SLIDE },
      { fn: () => { st.pin = st.pinTarget = 1; } },
      { to: P(back(hi, 0), 0), dur: MOVE }, { to: P(hi, 0), dur: SLIDE }, { to: P(lo, 0), dur: LIFT },
      { fn: () => { st.frame = st.held; dropOnChuck(st.held!); st.slot = k; } },
      { to: P(back(lo, 0), 0), dur: SLIDE },
      { fn: () => { st.pinTarget = 0; } }, { until: () => st.pin <= 0 },
      { fn: startScan },
      { to: idle, dur: 0.8, ready: true },
    ];
  }

  function startScan() {
    st.stage = 'scan';
    st.prog = 0;
    st.map = makeWaferMap(st.lot * 1000 + st.slot, { worn: params.worn, rejectPct: params.rejectPct });
    st.frame!.wafer.material = liveMat;
    beam.visible = true;
  }
  function finishScan() {
    const m = st.map!;
    st.stage = 'done';
    beam.visible = false;
    xCarriage.position.set(STAGE.x, 0.88, STAGE.z);
    drawWafer(live[1], 512, m, 1);
    liveTex.needsUpdate = true;
    // keep the result on this wafer: a small static copy of the map
    const [c, g] = mk(256, 256);
    drawWafer(g, 256, m, 1);
    st.frame!.wafer.material = std(0xffffff, 0.35, 0.25, { map: canvasTex(c) });
    stats.wafers++;
    if (m.ng) { stats.ng++; st.alarmT = 2; } else stats.ok++;
    stats.dies += m.dies.length;
    m.counts.forEach((n, i) => (stats.counts[i] += n));
    stats.review += m.review;
    st.last = m;
    drawHmi();
  }

  function callAmr() { if (st.amr === 'away') { st.amr = 'coming'; st.amrT = 0; } }

  // ---------- HMI drawing ----------
  function drawHmi() {
    const g = hg;
    g.fillStyle = '#0a1520'; g.fillRect(0, 0, 640, 400);
    g.fillStyle = '#0b3a6b'; g.fillRect(0, 0, 640, 52);
    g.fillStyle = '#fff'; g.font = `600 28px ${font}`; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillText('INSPEÇÃO PÓS-CORTE · IA', 18, 27);
    const m = st.stage === 'scan' || st.stage === 'done' ? st.map : st.last;
    g.save(); g.translate(20, 66);
    drawWafer(g, 310, m, st.stage === 'scan' ? st.prog : 1, { background: '#0a1520' });
    g.restore();
    g.textAlign = 'left'; g.font = `600 24px ${font}`; g.fillStyle = '#a9bdd3';
    const wf = st.stage === 'empty' && st.next < 0 && st.placed === SLOTS ? 'Troca de lote' : st.slot >= 0 ? `Wafer ${SLOTS - st.slot}/${SLOTS}` : '—';
    g.fillText(`Lote ${st.lot} · ${wf}`, 350, 82);
    if (m) {
      for (let i = 1; i < 5; i++) {
        g.fillStyle = CLASSES[i].color; g.fillRect(350, 106 + (i - 1) * 34, 18, 18);
        g.fillStyle = '#fff'; g.font = `500 22px ${font}`; g.fillText(`${CLASSES[i].name}: ${m.counts[i]}`, 378, 116 + (i - 1) * 34);
      }
      g.fillStyle = '#a9bdd3'; g.fillText(`Revisão humana: ${m.review}`, 350, 254);
      g.fillText(`Rendimento: ${(m.yield * 100).toFixed(1)}%`, 350, 286);
    }
    const scanning = st.stage === 'scan';
    g.font = `700 30px ${font}`;
    g.fillStyle = scanning ? '#7dd3fc' : !m ? '#a9bdd3' : m.ng ? '#ef4444' : '#22c55e';
    g.fillText(scanning ? 'Analisando…' : !m ? 'Aguardando wafer' : m.ng ? 'REPROVADO' : 'APROVADO', 350, 340);
    g.font = `600 22px ${font}`; g.fillStyle = '#fff';
    g.fillText(`OK ${stats.ok}   NG ${stats.ng}`, 20, 384);
    hTex.needsUpdate = true;
  }

  // ---------- step ----------
  const tmpErr = { v: 0 };
  let clearT = 0;
  // equipment around the arm, as boxes in world coordinates (links only: the fork enters the cassettes by design)
  const ob = (name: string, x: number, y: number, z: number, w: number, hh: number, d: number) => obstacleBox(name, origin.x + x, y, origin.z + z, w, hh, d);
  const obstacles: Obstacle[] = [
    ob('proteção (fundo)', 0, h / 2, z0, x1 - x0, h, 0.06), ob('proteção (lado)', x0, h / 2, (z0 + z1) / 2, 0.06, h, z1 - z0), ob('proteção (lado)', x1, h / 2, (z0 + z1) / 2, 0.06, h, z1 - z0),
    ob('proteção (frente)', 0, (1.15 + h) / 2, z1, x1 - x0, h - 1.15, 0.06), ob('teto da célula', 0, h, (z0 + z1) / 2, x1 - x0, 0.06, z1 - z0),
    ob('gabinete da mesa', STAGE.x, 0.44, STAGE.z, 1.0, 0.88, 0.8),
    ob('ponte da câmera', STAGE.x - 0.52, 1.23, STAGE.z + 0.36, 0.08, 0.7, 0.08), ob('ponte da câmera', STAGE.x + 0.52, 1.23, STAGE.z + 0.36, 0.08, 0.7, 0.08),
    ob('ponte da câmera', STAGE.x, 1.58, STAGE.z + 0.36, 1.12, 0.1, 0.1), ob('ponte da câmera', STAGE.x, 1.58, STAGE.z + 0.18, 0.1, 0.06, 0.4),
    ob('câmera', STAGE.x, 1.4, STAGE.z, 0.12, 0.34, 0.12),
    ...CASS.flatMap((c, i) => [ob('porta do cassete', c.x, 0.41, c.z, 0.62, 0.82, 0.62), orientedObstacle('cassete', origin.x + c.x, CASS_BASE + 0.19, origin.z + c.z, 0.46, 0.38, 0.44, cassYaw[i])]),
  ];
  function step(dt: number) {
    stats.t += dt;
    // robot: next job when free
    if (actor.seq.every(s => s.ready)) {
      if (st.stage === 'done') { actor.seq.length = 0; actor.seq.push(...unloadSeq()); }
      else if (st.stage === 'empty' && st.next >= 0 && st.amr !== 'docked') { actor.seq.length = 0; actor.seq.push(...loadSeq()); }
    }
    const busy = actor.seq.some(s => !s.ready);
    if (busy) stats.robotT += dt;
    runSeq(actor, dt);
    solve(arm, actor.pose);
    tmpErr.v = urTrack(arm, actor.pose, iters);
    if (stats.t > 3 && busy) stats.maxIkErr = Math.max(stats.maxIkErr, tmpErr.v);
    if (busy && (clearT += dt) >= 1 / 15) { clearT = 0; const c = armClearance(arm, obstacles); if (c.min < stats.minClear) { stats.minClear = c.min; stats.minClearAt = `${c.name} (${c.part})`; } }

    // lift pins
    st.pin = st.pinTarget > st.pin ? Math.min(st.pinTarget, st.pin + dt / 0.4) : Math.max(st.pinTarget, st.pin - dt / 0.4);
    if (st.frame && st.frame.obj.parent === chuck) st.frame.obj.position.y = PIN * st.pin;
    pins.forEach(p => (p.position.y = -0.005 + PIN * st.pin));

    // scan: the chuck carries the wafer under the camera in stripes (serpentine)
    if (st.stage === 'scan') {
      stats.scanT += dt;
      st.prog = Math.min(1, st.prog + dt / Math.max(5, params.scanS));
      const u = st.prog * STRIPES, i = Math.min(STRIPES - 1, Math.floor(u)), f = u - i;
      const sx = ((i % 2 ? 1 - f : f) - 0.5) * 0.32, sz = (-0.5 + (i + 0.5) / STRIPES) * 0.3;
      xCarriage.position.set(STAGE.x - sx, 0.88, STAGE.z - sz);
      if (Math.floor(stats.t * 8) !== Math.floor((stats.t - dt) * 8)) {
        drawWafer(live[1], 512, st.map, st.prog);
        liveTex.needsUpdate = true;
        drawHmi();
      }
      if (st.prog >= 1) finishScan();
    }

    // AMR: comes when the last wafer leaves the input cassette, swaps both cassettes when the output one is full
    const travel = 12;
    if (st.amr === 'coming') {
      st.amrT += dt;
      amr.position.lerpVectors(AMR_FAR, AMR_DOCK, Math.min(1, st.amrT / travel));
      amr.rotation.y = Math.PI;
      amrCass.visible = true;
      if (st.amrT >= travel && st.placed === SLOTS && st.stage === 'empty' && !st.held) { st.amr = 'docked'; st.amrT = 0; }
    } else if (st.amr === 'docked') {
      st.amrT += dt;
      stats.swapT += dt;
      if (st.amrT >= 25) {
        // new lot: the output frames come back as the next lot's wafers
        outCass.forEach((f, k) => { if (f) { f.wafer.material = plainMat; seat(f, 0, k); outCass[k] = null; } });
        st.lot++; st.next = SLOTS - 1; st.placed = 0; st.slot = -1; stats.lots++;
        st.amr = 'leaving'; st.amrT = 0;
        drawHmi();
      }
    } else if (st.amr === 'leaving') {
      st.amrT += dt;
      amr.position.lerpVectors(AMR_DOCK, AMR_FAR, Math.min(1, st.amrT / travel));
      amr.rotation.y = 0;
      if (st.amrT >= travel) { st.amr = 'away'; amrCass.visible = false; }
    }
    if (st.amr === 'away') amr.position.copy(AMR_FAR);

    st.alarmT = Math.max(0, st.alarmT - dt);
    andon.state = st.alarmT > 0 ? 'alarm' : st.stage === 'scan' || busy ? 'run' : 'wait';
    arm.ledMat.emissive.setHex(busy ? LED.run : LED.wait);
  }

  function resetStats() { stats = newStats(); }

  drawHmi();
  step(0);

  return {
    params, arm, andons, step, resetStats, drawHmi, state: st, actor,
    get stats() { return stats; },
    set ikIters(n: number) { iters = n; },
    root,
  };
}

export type Cell = ReturnType<typeof createCell>;

/** Cell output from a stats record: wafers/h, mean cycle, minutes per lot of 25. */
export function cellRates(s: CellStats) {
  const wph = s.t > 240 && s.wafers >= 3 ? (s.wafers / s.t) * 3600 : null; // the first wafers alone give a noisy rate
  return { wph, cycleS: wph ? 3600 / wph : null, lotMin: wph ? (SLOTS / wph) * 60 : null };
}
