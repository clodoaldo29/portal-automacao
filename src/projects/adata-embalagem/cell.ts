// Project 05 · Adata Technology: automated final packing (dry pack) with traceability. REAL SCALE (metres).
//
// Strapped stacks of JEDEC trays (10 full + 1 cover) come on the infeed belt and are read by the scanner arch
// (lot checked against the MES). A UR10e with a vacuum plate puts each stack into an open moisture barrier bag;
// the dispenser adds the desiccant and the humidity indicator card, the flap closes, and an indexing line takes
// the bag through the vacuum sealer, the label printer-applicator with barcode verification, to the outfeed
// station. A bag whose label does not match the lot is pushed into the reject bin; a good bag is put by the robot
// into the shipping carton. Cartons come from the case erector, and when full ride through the case sealer (the
// guides fold the flaps, the head applies the tape) to the pallet.
//
// Layout rule: every machine head sits on the far side of the bag line, so the robot only works from the near side,
// and the collision check (sim/robots/collision.ts) confirms the arm never touches anything.
//
// PROVISIONAL: times, tray and carton sizes and quantities are typical values, to be confirmed with the client.
import * as THREE from 'three';
import { createAndons } from '../../sim/andon';
import { buildConveyor } from '../../sim/conveyor';
import { createRng } from '../../sim/des';
import { at, box, canvasTex, cyl, cylA, mk, shadowify, std } from '../../sim/kit';
import type { Materials } from '../../sim/materials';
import { armClearance, obstacleBox, type Obstacle } from '../../sim/robots/collision';
import { vacuumPlate } from '../../sim/robots/grippers';
import { LED, makeCobot, poseAt, solve, upgradeArm, urTrack } from '../../sim/robots/ur-arm';
import { UR10E } from '../../sim/robots/ur-kinematics';
import { runSeq, type Pose, type Step } from '../../sim/sequencer';
import { Track, line } from '../../sim/track';

// ---------- layout ----------
const ROBOT = { x: 0, z: 0.1, ped: 0.75 };
const IN = { x0: -3.3, x1: -0.8, z: 0.1, top: 0.85, pick: -0.88, scan: -2.1, speed: 0.25 };
/** Bag line stations: 0 load, 1 seal, 2 label + verify, 3 outfeed (robot picks the good bags). */
const BAG = { z: 0.7, top: 0.85, x: [-0.66, -0.18, 0.3, 0.78] as const };
const REJECT = { x: 0.78, z: 1.23 };
const OUT = { x0: -0.75, x1: 2.6, z: -0.65, top: 0.55, start: -0.45, fill: 0.35, speed: 0.4 };
/** Case erector (cartons come out of it) and case sealer (flaps folded by guides, then taped). */
const ERECTOR = { x: -0.78, w: 0.6, d: 0.72, h: 1.3 };
const SEALER = { fold0: 1.3, fold1: 1.62, x0: 1.62, x1: 2.12 };
const PALLET = { x: 3.25, z: -0.65 };
/** JEDEC tray and stack (10 full + 1 cover tray). */
const TRAY = { l: 0.3226, w: 0.1359, h: 0.00762 }, TRAYS = 11, STACK_H = TRAYS * TRAY.h;
/** Moisture barrier bag (open size) and how much the vacuum flattens it. */
const BAGD = { l: 0.4, w: 0.2, h: 0.105 }, VACUUM = 0.88, BAG_H = BAGD.h * VACUUM;
const CARTON = { l: 0.46, w: 0.26, h: 0.48 };
/** Open carton flaps lie outward and down, clear of the robot. */
const FLAP_OPEN = Math.PI * 1.2;
/** Vacuum plate on an extension tube: the wrist stays above the carton rim while the bag goes down to the bottom. */
const DROP = 0.44;
/** IK iterations per step (warm-started); enough to follow the fastest move of the cycle. */
let IK_ITERS = 10;
export const setIkIters = (n: number) => { IK_ITERS = n; };

export interface PackParams {
  /** Seconds in the vacuum sealer and at the label printer-applicator (print + apply). */
  sealS: number;
  labelS: number;
  /** Bags per shipping carton, full trays per stack and chips per tray. */
  perCarton: number;
  traysFull: number;
  chipsPerTray: number;
  /** Target bags per hour (OEE performance). */
  target: number;
  /** 'continuo': stacks always available (capacity); 'demanda': stacks at the plant's rate. */
  mode: 'continuo' | 'demanda';
  /** Plant demand in chips per month (default: the historical capacity of the plant). */
  demandChipsMonth: number;
  /** Simulate a print queue mix-up: a share of the labels does not match the lot. */
  wrongLabel: boolean;
}
export const DEFAULT_PACK: PackParams = { sealS: 10, labelS: 6, perCarton: 4, traysFull: 10, chipsPerTray: 160, target: 200, mode: 'continuo', demandChipsMonth: 5e6, wrongLabel: false };
/** Share of wrong labels when the mix-up is simulated. */
export const WRONG_RATE = 0.08;

export interface PackStats {
  t: number; bags: number; ng: number; verified: number; cartons: number; pallets: number; scans: number;
  robotT: number; sealT: number; labelT: number; changeT: number; maxIkErr: number;
  /** Smallest clearance between the robot (links, gripper, load) and any equipment, and to which one. */
  minClear: number; minClearAt: string;
}
const newStats = (): PackStats => ({ t: 0, bags: 0, ng: 0, verified: 0, cartons: 0, pallets: 0, scans: 0, robotT: 0, sealT: 0, labelT: 0, changeT: 0, maxIkErr: 0, minClear: Infinity, minClearAt: '' });

export const bagsPerHour = (s: PackStats) => (s.t > 120 && s.bags >= 3 ? (s.bags / s.t) * 3600 : null);
export const chipsPerBag = (p: PackParams) => p.traysFull * p.chipsPerTray;
export const demandBagsPerHour = (p: PackParams) => p.demandChipsMonth / 30 / 24 / chipsPerBag(p);

interface Stack { obj: THREE.Group; x: number; scanned: boolean; lot: number }
interface Bag {
  obj: THREE.Group; body: THREE.Group; flap: THREE.Group; seal: THREE.Mesh; label: THREE.Mesh;
  packets: THREE.Group; stack: Stack | null; lot: number; wrong: boolean;
}
type Phase = 'none' | 'feeding' | 'open' | 'loading' | 'loaded' | 'dispense' | 'closing' | 'ready' | 'seal' | 'label' | 'verify' | 'ok' | 'picking' | 'ng' | 'eject';
interface Slot { bag: Bag | null; phase: Phase; t: number }
interface Carton { obj: THREE.Group; flaps: THREE.Group[]; tape: THREE.Mesh; walls: THREE.Mesh[]; count: number; state: 'arriving' | 'filling' | 'leaving'; x: number }

/** Barcode label texture (lot, part number, quantity). */
export function drawLabel(g: CanvasRenderingContext2D, W: number, H: number, lot: string, font: string, wrong = false) {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#111'; g.font = `700 ${H * 0.13}px ${font}`; g.textBaseline = 'top';
  g.fillText('MEMORY · DRY PACK', W * 0.05, H * 0.05);
  g.font = `600 ${H * 0.11}px ${font}`;
  g.fillText(`LOT ${lot}`, W * 0.05, H * 0.22);
  g.fillText('QTY 1600 · MSL 3', W * 0.05, H * 0.36);
  for (let i = 0, x = W * 0.05; x < W * 0.95; i++) { const w = ((i * 7919) % 3) + 1; if (i % 2 === 0) g.fillRect(x, H * 0.55, w * W * 0.006, H * 0.3); x += w * W * 0.006; }
  if (wrong) { g.strokeStyle = '#dc2626'; g.lineWidth = H * 0.04; g.strokeRect(2, 2, W - 4, H - 4); }
}

export function createPackCell(scene: THREE.Scene, M: Materials, font: string) {
  const params: PackParams = { ...DEFAULT_PACK };
  const rng = createRng(5);
  const trayMat = std(0x1b1d22, 0.1, 0.6), strap = std(0xf2f3f5, 0.0, 0.6), labelMat = std(0xffffff, 0, 0.6);
  const bagMat = std(0xbfc6cf, 0.8, 0.32, { side: THREE.DoubleSide }), sealMat = std(0x7d8590, 0.7, 0.4);
  const cartonMat = std(0xb58a5a, 0.0, 0.85), cartonDark = std(0x9c7448, 0.0, 0.85), tapeMat = std(0xc9a46a, 0.1, 0.35);
  const machine = std(0xe9ecef, 0.15, 0.45);
  /** Static equipment for the collision check (boxes that match what is drawn). */
  const obstacles: Obstacle[] = [];
  const solid = (name: string, x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material) => {
    scene.add(at(box(w, h, d, mat), x, y, z));
    obstacles.push(obstacleBox(name, x, y, z, w, h, d));
  };

  // ---------- infeed belt, scanner arch ----------
  const inTex = buildConveyor(scene, M, new Track([line(IN.x0, IN.z, IN.x1, IN.z)], false), 0.42, IN.top);
  // the belt surface sits 5 mm under the obstacle top: the stack rests on it when the robot picks it up
  obstacles.push(obstacleBox('esteira de entrada', (IN.x0 + IN.x1) / 2, (IN.top - 0.005) / 2, IN.z, IN.x1 - IN.x0, IN.top - 0.005, 0.5));
  for (const s of [-1, 1]) obstacles.push(obstacleBox('guia da esteira de entrada', (IN.x0 + IN.x1) / 2, IN.top + 0.02, IN.z + s * 0.24, IN.x1 - IN.x0, 0.05, 0.05));
  for (const s of [-1, 1]) solid('pórtico do leitor', IN.scan, IN.top + 0.35, IN.z + s * 0.3, 0.06, 0.75, 0.06, M.alu);
  solid('pórtico do leitor', IN.scan, IN.top + 0.72, IN.z, 0.08, 0.06, 0.66, M.alu);
  scene.add(at(box(0.12, 0.08, 0.12, M.dark), IN.scan, IN.top + 0.65, IN.z));
  const scanBeam = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.42), new THREE.MeshBasicMaterial({ color: 0xff2d2d, toneMapped: false }));
  scanBeam.rotation.x = -Math.PI / 2;
  scanBeam.position.set(IN.scan, IN.top + STACK_H + 0.003, IN.z);
  scanBeam.visible = false;
  scene.add(scanBeam);

  // ---------- bag line: base and carrier plates; machine heads on the far side (+z) ----------
  const lineX0 = BAG.x[0] - 0.3, lineX1 = BAG.x[3] + 0.3;
  solid('base da linha de sacos', (lineX0 + lineX1) / 2, 0.4, BAG.z, lineX1 - lineX0, 0.8, 0.5, M.cabinet);
  solid('base da linha de sacos', (lineX0 + lineX1) / 2, BAG.top - 0.02, BAG.z, lineX1 - lineX0, 0.04, 0.42, M.aluDark);
  for (const x of BAG.x) scene.add(at(box(0.44, 0.006, 0.24, M.alu), x, BAG.top + 0.002, BAG.z));
  // desiccant + humidity card dispenser, behind the load station; short chute over the far edge of the bag
  solid('dispensador de dessecante', BAG.x[0], 0.75, BAG.z + 0.44, 0.3, 1.5, 0.24, M.cabinet);
  solid('calha do dispensador', BAG.x[0], 1.2, BAG.z + 0.25, 0.14, 0.04, 0.16, M.alu);
  scene.add(at(box(0.22, 0.16, 0.03, std(0x0d2a4a, 0.2, 0.3, { emissive: new THREE.Color(0x1d6fd6), emissiveIntensity: 0.5 })), BAG.x[0], 1.32, BAG.z + 0.565));
  // vacuum sealer: housing behind the line, the bar comes forward and down over the bag
  for (const s of [-1, 1]) solid('seladora a vácuo', BAG.x[1] + s * 0.26, BAG.top + 0.3, BAG.z + 0.36, 0.06, 0.6, 0.06, M.alu);
  solid('seladora a vácuo', BAG.x[1], BAG.top + 0.66, BAG.z + 0.4, 0.6, 0.2, 0.3, machine);
  const sealBar = new THREE.Group();
  scene.add(sealBar);
  sealBar.add(at(box(0.46, 0.04, 0.05, std(0x3a3f47, 0.4, 0.4)), 0, 0, 0));
  sealBar.add(at(box(0.46, 0.02, 0.03, std(0xd23b3b, 0.2, 0.4, { emissive: new THREE.Color(0xd23b3b), emissiveIntensity: 0 })), 0, -0.03, 0));
  sealBar.add(at(box(0.04, 0.04, 0.3, M.alu), 0, 0.02, 0.17)); // arm into the housing
  const sealHeat = (sealBar.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial;
  const SEAL_REST = { y: BAG.top + 0.5, z: BAG.z + 0.3 }, SEAL_WORK_Z = BAG.z + 0.05;
  sealBar.position.set(BAG.x[1], SEAL_REST.y, SEAL_REST.z);
  // label printer-applicator behind the line; the pad reaches forward over the bag
  solid('impressora de etiquetas', BAG.x[2], 1.06, BAG.z + 0.45, 0.36, 0.42, 0.3, machine);
  const applicator = new THREE.Group();
  scene.add(applicator);
  applicator.add(at(box(0.03, 0.03, 0.34, M.alu), 0, 0.03, 0.17));
  applicator.add(at(box(0.12, 0.03, 0.09, M.aluDark), 0, 0, 0));
  const APP_REST = { y: BAG.top + 0.36, z: BAG.z + 0.3 }, APP_WORK_Z = BAG.z;
  applicator.position.set(BAG.x[2], APP_REST.y, APP_REST.z);
  // barcode verifier: post behind the line, reader over the bag
  solid('leitor de verificação', BAG.x[2] - 0.2, BAG.top + 0.35, BAG.z + 0.3, 0.04, 0.7, 0.04, M.alu);
  solid('leitor de verificação', BAG.x[2] - 0.2, BAG.top + 0.68, BAG.z + 0.18, 0.08, 0.06, 0.26, M.dark);
  const verifyBeam = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.2), new THREE.MeshBasicMaterial({ color: 0xff2d2d, toneMapped: false }));
  verifyBeam.rotation.x = -Math.PI / 2;
  verifyBeam.position.set(BAG.x[2], BAG.top + BAG_H + 0.01, BAG.z);
  verifyBeam.visible = false;
  scene.add(verifyBeam);
  const verdictMat = new THREE.MeshStandardMaterial({ color: 0x334155, emissive: 0x000000, emissiveIntensity: 1.6 });
  scene.add(at(cyl(0.05, 0.05, 0.06, verdictMat, 16), BAG.x[2] - 0.2, BAG.top + 0.74, BAG.z + 0.3));
  // reject: pusher behind the outfeed station is not needed — a slide on the far side takes the bag to the bin
  const chute = at(box(0.3, 0.02, 0.32, M.aluDark), REJECT.x, BAG.top - 0.1, BAG.z + 0.32);
  chute.rotation.x = 0.45;
  scene.add(chute);
  solid('coletor de reprovados', REJECT.x, 0.25, REJECT.z, 0.4, 0.5, 0.4, std(0xd23b3b, 0.1, 0.5));
  scene.add(at(box(0.36, 0.02, 0.36, std(0x2a2d33, 0.2, 0.6)), REJECT.x, 0.49, REJECT.z));
  const rejectPile: THREE.Object3D[] = [];

  // ---------- outfeed belt, case erector, case sealer, pallet ----------
  const outTex = buildConveyor(scene, M, new Track([line(OUT.x0, OUT.z, OUT.x1, OUT.z)], false), 0.36, OUT.top);
  obstacles.push(obstacleBox('esteira de caixas', (OUT.x0 + OUT.x1) / 2, OUT.top / 2, OUT.z, OUT.x1 - OUT.x0, OUT.top, 0.44));
  for (const s of [-1, 1]) obstacles.push(obstacleBox('guia da esteira de caixas', (OUT.x0 + OUT.x1) / 2, OUT.top + 0.02, OUT.z + s * 0.21, OUT.x1 - OUT.x0, 0.05, 0.05));
  // case erector: housing over the start of the belt, with the magazine of flat blanks on top
  const ex = ERECTOR.x;
  solid('formadora de caixas', ex - 0.05, ERECTOR.h / 2, OUT.z - ERECTOR.d / 2 + 0.08, ERECTOR.w, ERECTOR.h, 0.16, machine);
  solid('formadora de caixas', ex - 0.05, ERECTOR.h - 0.1, OUT.z, ERECTOR.w, 0.2, ERECTOR.d, machine);
  solid('formadora de caixas', ex - 0.05, ERECTOR.h / 2, OUT.z + ERECTOR.d / 2 - 0.08, ERECTOR.w, ERECTOR.h, 0.16, machine);
  for (let i = 0; i < 8; i++) scene.add(at(box(CARTON.l + 0.3, 0.008, CARTON.w + 0.3, cartonMat), ex - 0.05, ERECTOR.h + 0.01 + i * 0.01, OUT.z));
  scene.add(at(box(ERECTOR.w + 0.01, 0.06, ERECTOR.d + 0.01, std(0x5f6b7a, 0.2, 0.5)), ex - 0.05, ERECTOR.h - 0.25, OUT.z));
  // case sealer: two columns, top head with the tape roll; flap-folding guides before it
  const sx = (SEALER.x0 + SEALER.x1) / 2;
  for (const s of [-1, 1]) solid('fechadora de caixas', sx, 0.7, OUT.z + s * 0.3, SEALER.x1 - SEALER.x0, 1.4, 0.08, machine);
  solid('fechadora de caixas', sx, OUT.top + CARTON.h + 0.18, OUT.z, SEALER.x1 - SEALER.x0, 0.2, 0.68, machine);
  scene.add(at(cylA(0.09, 0.05, std(0xc9a46a, 0.1, 0.4), 'z', 20), SEALER.x0 + 0.08, OUT.top + CARTON.h + 0.04, OUT.z));
  scene.add(at(box(0.3, 0.03, 0.05, M.aluDark), SEALER.x0 + 0.15, OUT.top + CARTON.h + 0.015, OUT.z));
  for (const s of [-1, 1]) {
    const guide = at(box(SEALER.fold1 - SEALER.fold0 + 0.05, 0.02, 0.02, M.alu), (SEALER.fold0 + SEALER.fold1) / 2, OUT.top + CARTON.h + 0.05, OUT.z + s * 0.1);
    guide.rotation.z = -0.25;
    scene.add(guide);
  }
  const palletG = new THREE.Group();
  palletG.position.set(PALLET.x, 0, PALLET.z);
  scene.add(palletG);
  palletG.add(at(box(1.2, 0.03, 0.8, M.wood), 0, 0.135, 0));
  for (const z of [-0.35, 0, 0.35]) palletG.add(at(box(1.2, 0.1, 0.1, M.wood), 0, 0.07, z));
  palletG.add(at(box(1.2, 0.02, 0.8, M.wood), 0, 0.01, 0));
  const onPallet: THREE.Object3D[] = [];

  // ---------- guarding and HMI ----------
  const guard = new THREE.MeshStandardMaterial({ color: 0xbcd6ea, transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
  const panel = (w: number, x: number, z: number, ry: number) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.8), guard); p.position.set(x, 0.95, z); p.rotation.y = ry; p.userData.noShadow = true; scene.add(p); };
  panel(3.2, 0.1, -1.25, 0); panel(1.0, -1.5, -0.75, Math.PI / 2);
  obstacles.push(obstacleBox('proteção', 0.1, 0.95, -1.25, 3.2, 1.9, 0.04), obstacleBox('proteção', -1.5, 0.95, -0.75, 0.04, 1.9, 1.0));
  for (const [x, z] of [[-1.5, -1.25], [1.7, -1.25], [-1.5, -0.25]]) solid('poste da proteção', x, 0.95, z, 0.05, 1.9, 0.05, M.yellow);
  const [hc, hg] = mk(640, 400);
  const hTex = canvasTex(hc);
  const hmi = new THREE.Group();
  hmi.position.set(-1.7, 0, 1.25);
  hmi.rotation.y = 0.5;
  scene.add(hmi);
  hmi.add(at(box(0.6, 1.5, 0.45, M.cabinet), 0, 0.75, 0));
  hmi.add(at(box(0.66, 0.44, 0.05, M.black), 0, 1.5, 0.2));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.39), new THREE.MeshBasicMaterial({ map: hTex, toneMapped: false }));
  scr.position.set(0, 1.5, 0.23);
  hmi.add(scr);
  shadowify(hmi);
  obstacles.push(obstacleBox('IHM', -1.7, 0.85, 1.25, 0.8, 1.7, 0.8));
  const andons = createAndons(M);
  const andon = andons.make(hmi, 0.22, 1.5, -0.1);

  // ---------- robot ----------
  const arm = makeCobot(scene, M, { x: ROBOT.x, z: ROBOT.z, L1: 0.61, L2: 0.57, ped: ROBOT.ped, pedW: 0.36 });
  arm.tool.rotation.order = 'YXZ';
  const grip = vacuumPlate(arm.mount, M, { w: 0.34, d: 0.15, drop: DROP });
  const P = (x: number, top: number, z: number): Pose => [...poseAt(arm, x, z, top + DROP), 0, 0];
  const idle = P(-0.05, 1.25, -0.3); // tucked in, between the infeed and the carton
  upgradeArm(scene, arm, idle, UR10E);

  // ---------- items ----------
  const [lc, lg] = mk(256, 180), [wc, wg] = mk(256, 180);
  drawLabel(lg, 256, 180, 'A26-11-0000', font);
  drawLabel(wg, 256, 180, 'B26-10-9999', font, true);
  const labelTex = canvasTex(lc), wrongTex = canvasTex(wc);
  const trayGeo = new THREE.BoxGeometry(TRAY.l, STACK_H, TRAY.w);
  let lotSeq = 0;
  function makeStack(): Stack {
    const obj = new THREE.Group();
    obj.add(at(new THREE.Mesh(trayGeo, trayMat), 0, STACK_H / 2, 0));
    for (let i = 1; i < TRAYS; i++) obj.add(at(box(TRAY.l + 0.002, 0.0012, TRAY.w + 0.002, std(0x2c3038, 0.1, 0.5)), 0, i * TRAY.h, 0));
    for (const x of [-0.1, 0.1]) obj.add(at(box(0.012, STACK_H + 0.004, TRAY.w + 0.004, strap), x, STACK_H / 2, 0));
    obj.add(at(box(0.06, 0.04, 0.002, labelMat), -0.14, STACK_H / 2, TRAY.w / 2 + 0.002));
    shadowify(obj);
    scene.add(obj);
    return { obj, x: IN.x0 + 0.17, scanned: false, lot: lotSeq++ };
  }
  function makeBag(lot: number): Bag {
    const obj = new THREE.Group(), body = new THREE.Group();
    obj.add(body);
    const t = 0.002;
    body.add(at(box(BAGD.l, t, BAGD.w, bagMat), 0, t / 2, 0));
    body.add(at(box(BAGD.l, BAGD.h, t, bagMat), 0, BAGD.h / 2, BAGD.w / 2));
    body.add(at(box(BAGD.l, BAGD.h, t, bagMat), 0, BAGD.h / 2, -BAGD.w / 2));
    for (const s of [-1, 1]) body.add(at(box(t, BAGD.h, BAGD.w, bagMat), s * BAGD.l / 2, BAGD.h / 2, 0));
    // the flap hinges on the far side and lies open away from the robot
    const flap = new THREE.Group();
    flap.position.set(0, BAGD.h, BAGD.w / 2);
    flap.rotation.x = Math.PI / 2 * 0.95;
    body.add(flap);
    flap.add(at(box(BAGD.l, t, BAGD.w, bagMat), 0, 0, -BAGD.w / 2));
    const seal = at(box(BAGD.l - 0.02, 0.004, 0.012, sealMat), 0, BAGD.h + 0.003, BAGD.w / 2 - 0.02);
    seal.visible = false;
    body.add(seal);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.07), new THREE.MeshBasicMaterial({ map: labelTex }));
    label.rotation.x = -Math.PI / 2;
    label.position.set(-0.06, BAG_H + 0.004, 0);
    label.visible = false;
    obj.add(label);
    const packets = new THREE.Group();
    packets.add(at(box(0.1, 0.012, 0.06, std(0xf4f4f0, 0, 0.8)), 0.06, 0.006, 0));
    packets.add(at(box(0.07, 0.002, 0.05, std(0x3b82f6, 0, 0.6)), -0.08, 0.001, 0));
    packets.visible = false;
    obj.add(packets);
    shadowify(obj);
    scene.add(obj);
    return { obj, body, flap, seal, label, packets, stack: null, lot, wrong: false };
  }
  function makeCarton(): Carton {
    const obj = new THREE.Group(), t = 0.006, { l, w, h } = CARTON;
    const walls: THREE.Mesh[] = [at(box(l, t, w, cartonMat), 0, t / 2, 0)];
    for (const s of [-1, 1]) { walls.push(at(box(l, h, t, cartonMat), 0, h / 2, s * w / 2)); walls.push(at(box(t, h, w, cartonMat), s * l / 2, h / 2, 0)); }
    walls.forEach(m => obj.add(m));
    const flaps = [-1, 1].map(s => {
      const pivot = new THREE.Group();
      pivot.position.set(0, h, s * w / 2);
      pivot.rotation.x = s * FLAP_OPEN;
      const flap = at(box(l, t, w / 2, cartonDark), 0, 0, -s * w / 4);
      pivot.add(flap);
      obj.add(pivot);
      walls.push(flap);
      return pivot;
    });
    const tape = at(box(1, 0.002, 0.05, tapeMat), 0, h + 0.004, 0);
    tape.scale.x = 0.001;
    tape.visible = false;
    obj.add(tape);
    obj.add(at(box(0.12, 0.08, 0.002, labelMat), 0, h * 0.6, w / 2 + 0.004));
    shadowify(obj);
    scene.add(obj);
    return { obj, flaps, tape, walls, count: 0, state: 'arriving', x: OUT.start - 0.35 };
  }

  // ---------- state ----------
  const stacks: Stack[] = [];
  const slots: Slot[] = [0, 1, 2, 3].map(() => ({ bag: null, phase: 'none', t: 0 }));
  let carton = makeCarton();
  const leaving: Carton[] = [];
  let indexing = 0; // seconds left of the line index
  let held: { kind: 'stack'; s: Stack } | { kind: 'bag'; b: Bag } | null = null;
  const actor = { seq: [] as Step[], pose: idle.slice() };
  let stats = newStats();
  let demandT = 0, scanFlash = 0, verdictT = 0, lastLabel = '—', lastVerdict: 'ok' | 'ng' | null = null;
  const lotName = (n: number) => `A26-11-${String(1000 + n).slice(-4)}`;

  const DOWN = 0.5; // collaborative speeds: the cell works next to people
  const SAFE = 1.2; // travel height of the load bottom between stations
  /**
   * Safe corridor: the robot never swings with the arm stretched out. From a station it goes up, pulls the tool in
   * close to the base (radius TUCK), turns the shortest way, reaches out over the next station and goes down.
   */
  const TUCK = 0.4;
  const tucked = (x: number, z: number, top: number): Pose => {
    const dx = x - ROBOT.x, dz = z - ROBOT.z, d = Math.hypot(dx, dz) || 1;
    return P(ROBOT.x + (dx / d) * TUCK, top, ROBOT.z + (dz / d) * TUCK);
  };
  /** Pose with the yaw unwrapped next to the current one, so the turn takes the short way. */
  const near = (p: Pose): (() => Pose) => () => {
    const q = p.slice(), cur = actor.pose[0];
    while (q[0] - cur > Math.PI) q[0] -= 2 * Math.PI;
    while (q[0] - cur < -Math.PI) q[0] += 2 * Math.PI;
    return q;
  };
  /** Transfer from wherever the tool is (already up at `top`) to above (x, z), through the corridor. */
  const travel = (x: number, z: number, top: number): Step[] => [
    { toFn: () => { const [phi, , yRel] = actor.pose; return [phi, TUCK, yRel, 0, 0]; }, dur: 0.6 },
    { toFn: near(tucked(x, z, top)), dur: 1.0 },
    { toFn: near(P(x, top, z)), dur: 0.7 },
  ];
  const home = (): Step[] => [
    { toFn: () => { const [phi, , yRel] = actor.pose; return [phi, TUCK, yRel, 0, 0]; }, dur: 0.6 },
    { toFn: near(idle), dur: 0.9, ready: true },
  ];
  function stackToBag(st: Stack): Step[] {
    const bagBottom = BAG.top + 0.006, x = BAG.x[0], z = BAG.z, up = SAFE + STACK_H;
    const low = IN.top + STACK_H + 0.15; // only the belt is under the infeed pick: approach low, the arm stays in reach
    return [
      { toFn: near(tucked(IN.pick, IN.z, up)), dur: 0.8 },
      { toFn: near(P(IN.pick, low, IN.z)), dur: 0.7 },
      { toFn: near(P(IN.pick, IN.top + STACK_H, IN.z)), dur: DOWN },
      { fn: () => { grip.attach(st.obj); stacks.splice(stacks.indexOf(st), 1); held = { kind: 'stack', s: st }; } },
      { toFn: near(P(IN.pick, low, IN.z)), dur: DOWN },
      ...travel(x, z, up),
      { toFn: near(P(x, bagBottom + STACK_H, z)), dur: 0.55 },
      { fn: () => {
        const b = slots[0].bag!;
        b.obj.attach(st.obj);
        st.obj.position.set(0, 0.004, 0); st.obj.rotation.set(0, 0, 0);
        b.stack = st; held = null;
        slots[0].phase = 'loaded'; slots[0].t = 0;
      } },
      { toFn: near(P(x, up, z)), dur: DOWN },
      ...home(),
    ];
  }
  function bagToCarton(b: Bag): Step[] {
    const x = BAG.x[3], z = BAG.z, top = BAG.top + 0.006 + BAG_H;
    const k = carton.count, placeTop = OUT.top + 0.012 + k * 0.1 + BAG_H, up = Math.max(SAFE, OUT.top + CARTON.h + BAG_H + 0.12);
    const low = top + 0.15; // nothing above the outfeed station: approach low, rise once the arm is tucked in
    return [
      { toFn: near(tucked(x, z, up)), dur: 0.8 },
      { toFn: near(P(x, low, z)), dur: 0.7 },
      { toFn: near(P(x, top, z)), dur: DOWN },
      { fn: () => { grip.attach(b.obj); slots[3] = { bag: null, phase: 'none', t: 0 }; held = { kind: 'bag', b }; } },
      { toFn: near(P(x, low, z)), dur: 0.6 },
      ...travel(OUT.fill, OUT.z, up),
      { toFn: near(P(OUT.fill, placeTop, OUT.z)), dur: 0.8 },
      { fn: () => {
        carton.obj.attach(b.obj);
        b.obj.position.set(0, 0.012 + k * 0.1, 0); b.obj.rotation.set(0, 0, 0);
        carton.count++; held = null; stats.bags++;
      } },
      { toFn: near(P(OUT.fill, up, OUT.z)), dur: 0.7 },
      ...home(),
    ];
  }

  // ---------- collision check ----------
  const toolBox = new THREE.Box3(), wallBox = new THREE.Box3(), _b = new THREE.Box3();
  const gripGroup = grip.parent!;
  function liveObstacles(): Obstacle[] {
    const out = obstacles.slice();
    sealBar.updateMatrixWorld(true); applicator.updateMatrixWorld(true);
    out.push({ name: 'barra da seladora', box: _b.setFromObject(sealBar).clone() });
    out.push({ name: 'aplicador de etiqueta', box: _b.setFromObject(applicator).clone() });
    for (const c of [carton, ...leaving]) {
      c.obj.updateMatrixWorld(true);
      for (const w of c.walls) out.push({ name: 'caixa de expedição', box: wallBox.setFromObject(w).clone() });
    }
    return out;
  }
  function checkClearance() {
    gripGroup.updateWorldMatrix(true, true);
    toolBox.setFromObject(gripGroup);
    const c = armClearance(arm, liveObstacles(), [toolBox]);
    if (c.min < stats.minClear) { stats.minClear = c.min; stats.minClearAt = c.name; }
  }

  // ---------- HMI ----------
  function drawHmi() {
    const g = hg;
    g.fillStyle = '#0a1520'; g.fillRect(0, 0, 640, 400);
    g.fillStyle = '#0b3a6b'; g.fillRect(0, 0, 640, 52);
    g.fillStyle = '#fff'; g.font = `600 28px ${font}`; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillText('EMBALAGEM FINAL · RASTREABILIDADE', 18, 27);
    g.save(); g.translate(20, 72);
    const [c2, g2] = mk(300, 210);
    drawLabel(g2, 300, 210, lastLabel, font, lastVerdict === 'ng');
    g.drawImage(c2, 0, 0);
    g.restore();
    g.font = `700 32px ${font}`;
    g.fillStyle = lastVerdict === 'ok' ? '#22c55e' : lastVerdict === 'ng' ? '#ef4444' : '#a9bdd3';
    g.fillText(lastVerdict === 'ok' ? 'ETIQUETA OK' : lastVerdict === 'ng' ? 'ETIQUETA ≠ LOTE' : 'AGUARDANDO', 340, 110);
    g.font = `500 24px ${font}`; g.fillStyle = '#fff';
    g.fillText(`Sacos: ${stats.bags}`, 340, 170);
    g.fillText(`Reprovados: ${stats.ng}`, 340, 206);
    g.fillText(`Caixas: ${stats.cartons}`, 340, 242);
    g.fillText(`Caixa atual: ${carton.count}/${params.perCarton}`, 340, 278);
    g.fillStyle = '#a9bdd3'; g.font = `500 20px ${font}`;
    g.fillText('Lote lido na entrada · conferido no MES', 20, 320);
    g.fillText('Dessecante + cartão de umidade · selagem a vácuo', 20, 352);
    hTex.needsUpdate = true;
  }

  // ---------- step ----------
  let checkT = 0;
  function step(dt: number) {
    stats.t += dt;
    inTex.offset.x = (inTex.offset.x - IN.speed * dt / 0.25) % 1;
    // infeed: new stacks (continuous: keep it fed; demand: at the plant's rate)
    if (params.mode === 'continuo') { if (stacks.length < 5 && !stacks.some(s => s.x < IN.x0 + 0.6)) stacks.push(makeStack()); }
    else { demandT -= dt; if (demandT <= 0 && !stacks.some(s => s.x < IN.x0 + 0.6)) { stacks.push(makeStack()); demandT = 3600 / demandBagsPerHour(params); } }
    const sorted = stacks.slice().sort((a, b) => b.x - a.x);
    sorted.forEach((s, i) => {
      const limit = i === 0 ? IN.pick : sorted[i - 1].x - 0.4;
      const nx = Math.min(limit, s.x + IN.speed * dt);
      if (!s.scanned && s.x < IN.scan && nx >= IN.scan) { s.scanned = true; stats.scans++; scanFlash = 0.35; }
      s.x = Math.max(s.x, nx);
      s.obj.position.set(s.x, IN.top, IN.z);
    });
    scanFlash = Math.max(0, scanFlash - dt);
    scanBeam.visible = scanFlash > 0;

    // bag line stations
    const [s0, s1, s2, s3] = slots;
    slots.forEach(s => (s.t += dt));
    if (s0.phase === 'none' && indexing <= 0) { s0.bag = makeBag(0); s0.phase = 'feeding'; s0.t = 0; }
    if (s0.bag) {
      const b = s0.bag;
      if (s0.phase === 'feeding') { b.obj.position.set(BAG.x[0], BAG.top + 0.006 - 0.12 * Math.max(0, 1 - s0.t / 1.5), BAG.z); if (s0.t >= 1.5) s0.phase = 'open'; }
      if (s0.phase === 'loaded') { s0.phase = 'dispense'; s0.t = 0; b.lot = b.stack!.lot; }
      if (s0.phase === 'dispense') {
        b.packets.visible = s0.t > 0.4;
        b.packets.position.set(0, STACK_H + 0.006 + Math.max(0, 0.5 - s0.t) * 0.6, 0);
        if (s0.t >= 2.5) { s0.phase = 'closing'; s0.t = 0; }
      }
      if (s0.phase === 'closing') { b.flap.rotation.x = Math.PI / 2 * 0.95 * Math.max(0, 1 - s0.t / 1.0); if (s0.t >= 1.0) s0.phase = 'ready'; }
    }
    const ease = (cur: number, to: number, k: number) => cur + (to - cur) * Math.min(1, dt * k);
    if (s1.phase === 'seal' && s1.bag) {
      stats.sealT += dt;
      const u = s1.t / params.sealS, out = u > 0.05 && u < 0.95, down = u > 0.15 && u < 0.85;
      sealBar.position.z = ease(sealBar.position.z, out ? SEAL_WORK_Z : SEAL_REST.z, 8);
      sealBar.position.y = ease(sealBar.position.y, down ? BAG.top + 0.006 + BAG_H + 0.04 : SEAL_REST.y, 8);
      sealHeat.emissiveIntensity = down ? 1.6 : 0;
      s1.bag.body.scale.y = 1 - (1 - VACUUM) * Math.min(1, Math.max(0, (u - 0.15) / 0.5));
      if (u > 0.6) s1.bag.seal.visible = true;
      if (u >= 1) { s1.phase = 'ready'; sealHeat.emissiveIntensity = 0; }
    } else { sealBar.position.z = ease(sealBar.position.z, SEAL_REST.z, 6); sealBar.position.y = ease(sealBar.position.y, SEAL_REST.y, 6); }
    if (s2.bag && (s2.phase === 'label' || s2.phase === 'verify')) {
      stats.labelT += dt;
      if (s2.phase === 'label') {
        const u = s2.t / params.labelS, out = u > 0.3 && u < 0.95, press = u > 0.5 && u < 0.85;
        applicator.position.z = ease(applicator.position.z, out ? APP_WORK_Z : APP_REST.z, 10);
        applicator.position.y = ease(applicator.position.y, press ? BAG.top + 0.006 + BAG_H + 0.02 : APP_REST.y, 10);
        if (u > 0.7 && !s2.bag.label.visible) {
          s2.bag.wrong = params.wrongLabel && rng() < WRONG_RATE;
          (s2.bag.label.material as THREE.MeshBasicMaterial).map = s2.bag.wrong ? wrongTex : labelTex;
          s2.bag.label.visible = true;
        }
        if (u >= 1) { s2.phase = 'verify'; s2.t = 0; }
      } else {
        verifyBeam.visible = s2.t < 1.0;
        if (s2.t >= 1.2) {
          const ng = s2.bag.wrong;
          s2.phase = 'ready';
          stats.verified++;
          lastVerdict = ng ? 'ng' : 'ok';
          lastLabel = ng ? 'B26-10-9999' : lotName(s2.bag.lot);
          verdictT = 1.8;
          verdictMat.emissive.setHex(ng ? 0xef4444 : 0x22c55e);
          if (ng) stats.ng++;
          drawHmi();
        }
      }
    } else { applicator.position.z = ease(applicator.position.z, APP_REST.z, 6); applicator.position.y = ease(applicator.position.y, APP_REST.y, 6); }
    // outfeed station: a good bag waits for the robot; a wrong label slides off the far side into the reject bin
    if (s3.phase === 'ng' && s3.bag) { s3.phase = 'eject'; s3.t = 0; }
    if (s3.phase === 'eject' && s3.bag) {
      const u = Math.min(1, s3.t / 0.9);
      s3.bag.obj.position.set(REJECT.x, BAG.top + 0.006 - u * (BAG.top - 0.5) + 0.03 * rejectPile.length * u, BAG.z + u * (REJECT.z - BAG.z));
      if (u >= 1) { rejectPile.push(s3.bag.obj); if (rejectPile.length > 6) scene.remove(rejectPile.shift()!); slots[3] = { bag: null, phase: 'none', t: 0 }; }
    }
    verdictT = Math.max(0, verdictT - dt);
    if (verdictT <= 0) verdictMat.emissive.setHex(0x000000);

    // index the line: every finished bag moves one station forward
    const free = (s: Slot) => s.phase === 'none';
    const done = (s: Slot) => s.phase === 'ready';
    if (indexing <= 0 && free(s3) && [s0, s1, s2].every(s => free(s) || done(s)) && [s0, s1, s2].some(done)) indexing = 1.0;
    if (indexing > 0) {
      const before = indexing;
      indexing -= dt;
      const du = Math.min(before, before - Math.max(0, indexing)) / 1.0;
      for (let i = 0; i < 3; i++) if (slots[i].bag && done(slots[i])) slots[i].bag!.obj.position.x += du * (BAG.x[i + 1] - BAG.x[i]);
      if (indexing <= 0) {
        if (done(s2)) { slots[3] = { bag: s2.bag, phase: s2.bag!.wrong ? 'ng' : 'ok', t: 0 }; slots[2] = { bag: null, phase: 'none', t: 0 }; }
        if (done(s1)) { slots[2] = { bag: s1.bag, phase: 'label', t: 0 }; slots[1] = { bag: null, phase: 'none', t: 0 }; }
        if (done(s0)) { slots[1] = { bag: s0.bag, phase: 'seal', t: 0 }; slots[0] = { bag: null, phase: 'none', t: 0 }; }
        slots.forEach((s, i) => s.bag?.obj.position.set(BAG.x[i], BAG.top + 0.006, BAG.z));
        indexing = 0;
      }
    }

    // cartons: out of the erector, filled by the robot, then through the flap guides and the case sealer
    const moving = carton.state === 'arriving' || leaving.length > 0;
    outTex.offset.x = (outTex.offset.x - (moving ? OUT.speed : 0) * dt / 0.25) % 1;
    if (carton.state === 'arriving') {
      carton.x = Math.min(OUT.fill, carton.x + OUT.speed * dt);
      stats.changeT += dt;
      if (carton.x >= OUT.fill) carton.state = 'filling';
    } else if (carton.state === 'filling' && carton.count >= params.perCarton && !(held && held.kind === 'bag') && !actor.seq.some(s => !s.ready)) {
      carton.state = 'leaving'; leaving.push(carton); carton = makeCarton();
    }
    carton.obj.position.set(carton.x, OUT.top, OUT.z);
    for (const c of leaving.slice()) {
      const ahead = leaving[leaving.indexOf(c) - 1];
      c.x = Math.min(c.x + OUT.speed * dt, ahead ? ahead.x - CARTON.l - 0.05 : Infinity);
      c.obj.position.set(c.x, OUT.top, OUT.z);
      const fold = Math.min(1, Math.max(0, (c.x - SEALER.fold0) / (SEALER.fold1 - SEALER.fold0)));
      c.flaps.forEach((f, i) => (f.rotation.x = (i ? 1 : -1) * FLAP_OPEN * (1 - fold)));
      const front = c.x + CARTON.l / 2, taped = Math.min(CARTON.l + 0.1, Math.max(0, front - (SEALER.x0 + 0.15)));
      c.tape.visible = taped > 0;
      c.tape.scale.x = Math.max(0.001, taped);
      c.tape.position.x = CARTON.l / 2 + 0.05 - taped / 2;
      if (c.x >= OUT.x1 - 0.2) {
        stats.cartons++;
        const n = onPallet.length, layer = Math.floor(n / 6), k = n % 6;
        palletG.attach(c.obj);
        c.obj.position.set(-0.3 + (k % 2) * 0.6, 0.15 + layer * (CARTON.h + 0.01), -0.27 + Math.floor(k / 2) * 0.27);
        c.obj.rotation.set(0, 0, 0);
        onPallet.push(c.obj);
        if (onPallet.length >= 18) { onPallet.forEach(o => palletG.remove(o)); onPallet.length = 0; stats.pallets++; }
        leaving.splice(leaving.indexOf(c), 1);
      }
    }

    // robot: next job when free
    if (actor.seq.every(s => s.ready)) {
      const pick = stacks.find(s => s.x >= IN.pick - 1e-6);
      if (s3.phase === 'ok' && s3.bag && carton.state === 'filling' && carton.count < params.perCarton) { actor.seq.length = 0; actor.seq.push(...bagToCarton(s3.bag)); s3.phase = 'picking'; }
      else if (s0.phase === 'open' && pick) { actor.seq.length = 0; actor.seq.push(...stackToBag(pick)); s0.phase = 'loading'; }
    }
    const busy = actor.seq.some(s => !s.ready);
    if (busy) stats.robotT += dt;
    runSeq(actor, dt);
    solve(arm, actor.pose);
    const err = urTrack(arm, actor.pose, IK_ITERS);
    if (stats.t > 3 && busy) stats.maxIkErr = Math.max(stats.maxIkErr, err);
    if ((checkT += dt) >= 1 / 15) { checkT = 0; checkClearance(); }
    arm.ledMat.emissive.setHex(busy ? LED.run : LED.wait);
    andon.state = verdictT > 0 && lastVerdict === 'ng' ? 'alarm' : busy || indexing > 0 ? 'run' : 'wait';
  }

  drawHmi();
  return {
    params, arm, andons, step, drawHmi, slots, actor,
    get stats() { return stats; },
    get carton() { return carton; },
    get stacks() { return stacks; },
    resetStats() { stats = newStats(); },
    get lastVerdict() { return lastVerdict; },
    debugBoxes: () => { gripGroup.updateWorldMatrix(true, true); const t = new THREE.Box3().setFromObject(gripGroup); const f = (b: THREE.Box3) => [b.min.toArray().map(v => +v.toFixed(3)), b.max.toArray().map(v => +v.toFixed(3))]; return { tool: f(t), held: held ? held.kind : null, near: liveObstacles().filter(o => o.name === 'caixa de expedição').map(o => f(o.box)).slice(0, 8) }; },
    /** Current clearance (for tests and debugging). */
    clearance: () => { gripGroup.updateWorldMatrix(true, true); toolBox.setFromObject(gripGroup); return armClearance(arm, liveObstacles(), [toolBox]); },
  };
}

export type PackCell = ReturnType<typeof createPackCell>;
