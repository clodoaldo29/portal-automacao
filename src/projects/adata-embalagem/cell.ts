// Project 05 · Adata Technology: automated final packing (dry pack) with traceability. REAL SCALE (metres).
//
// Strapped stacks of JEDEC trays (10 full + 1 cover) come on the infeed belt and are read by the scanner arch
// (lot checked against the MES). A UR10e with a vacuum plate puts each stack into an open moisture barrier bag;
// the dispenser adds the desiccant and the humidity indicator card, the flap closes, and an indexing line takes
// the bag through the vacuum sealer, the label printer-applicator and the barcode verification. A bag whose label
// does not match the lot goes to the reject bin; a good bag is put by the robot into the shipping carton, and full
// cartons are closed and stacked on the pallet.
//
// PROVISIONAL: times, tray and carton sizes and quantities are typical values, to be confirmed with the client.
import * as THREE from 'three';
import { createAndons } from '../../sim/andon';
import { buildConveyor } from '../../sim/conveyor';
import { createRng } from '../../sim/des';
import { at, box, canvasTex, cyl, mk, shadowify, std } from '../../sim/kit';
import type { Materials } from '../../sim/materials';
import { vacuumPlate } from '../../sim/robots/grippers';
import { LED, makeCobot, poseAt, solve, upgradeArm, urTrack } from '../../sim/robots/ur-arm';
import { UR10E } from '../../sim/robots/ur-kinematics';
import { runSeq, type Pose, type Step } from '../../sim/sequencer';
import { Track, line } from '../../sim/track';

// ---------- layout ----------
const ROBOT = { x: 0, z: 0.1, ped: 0.75 };
const IN = { x0: -3.4, x1: -0.9, z: 0.1, top: 0.85, pick: -0.98, scan: -2.2, speed: 0.25 };
const BAG = { z: 0.85, top: 0.85, x: [-0.15, 0.33, 0.81] as const, reject: 1.32 };
const OUT = { x0: 0.15, x1: 2.55, z: -0.65, top: 0.55, fill: 0.85, speed: 0.4 };
const PALLET = { x: 3.25, z: -0.65 };
/** JEDEC tray and stack (10 full + 1 cover tray). */
const TRAY = { l: 0.3226, w: 0.1359, h: 0.00762 }, TRAYS = 11, STACK_H = TRAYS * TRAY.h;
/** Moisture barrier bag (open size) and how much the vacuum flattens it. */
const BAGD = { l: 0.4, w: 0.2, h: 0.105 }, VACUUM = 0.88, BAG_H = BAGD.h * VACUUM;
const CARTON = { l: 0.46, w: 0.26, h: 0.48 };
const DROP = 0.12;

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
  t: number; bags: number; ng: number; cartons: number; pallets: number; scans: number;
  robotT: number; sealT: number; labelT: number; changeT: number; maxIkErr: number;
}
const newStats = (): PackStats => ({ t: 0, bags: 0, ng: 0, cartons: 0, pallets: 0, scans: 0, robotT: 0, sealT: 0, labelT: 0, changeT: 0, maxIkErr: 0 });

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
interface Carton { obj: THREE.Group; flaps: THREE.Group[]; count: number; state: 'arriving' | 'filling' | 'closing' | 'leaving'; t: number; x: number }

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
  const cartonMat = std(0xb58a5a, 0.0, 0.85), cartonDark = std(0x9c7448, 0.0, 0.85);

  // ---------- infeed belt, scanner arch ----------
  const inTex = buildConveyor(scene, M, new Track([line(IN.x0, IN.z, IN.x1, IN.z)], false), 0.42, IN.top);
  for (const s of [-1, 1]) scene.add(at(box(0.06, 0.75, 0.06, M.alu), IN.scan, IN.top + 0.35, IN.z + s * 0.3));
  scene.add(at(box(0.08, 0.06, 0.66, M.alu), IN.scan, IN.top + 0.72, IN.z));
  scene.add(at(box(0.12, 0.08, 0.12, M.dark), IN.scan, IN.top + 0.65, IN.z));
  const scanBeam = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.42), new THREE.MeshBasicMaterial({ color: 0xff2d2d, toneMapped: false }));
  scanBeam.rotation.x = -Math.PI / 2;
  scanBeam.position.set(IN.scan, IN.top + STACK_H + 0.003, IN.z);
  scanBeam.visible = false;
  scene.add(scanBeam);

  // ---------- bag line: base, carrier plates, bag feeder, dispenser, sealer, labeler, verifier, reject bin ----------
  scene.add(at(box(1.95, 0.8, 0.5, M.cabinet), 0.4, 0.4, BAG.z));
  scene.add(at(box(1.95, 0.04, 0.42, M.aluDark), 0.4, BAG.top - 0.02, BAG.z));
  for (const x of BAG.x) scene.add(at(box(0.44, 0.006, 0.24, M.alu), x, BAG.top + 0.002, BAG.z));
  // desiccant + humidity card dispenser (front of the load station)
  const disp = new THREE.Group();
  disp.position.set(BAG.x[0], 0, BAG.z + 0.42);
  scene.add(disp);
  disp.add(at(box(0.3, 1.5, 0.24, M.cabinet), 0, 0.75, 0));
  disp.add(at(box(0.08, 0.04, 0.3, M.alu), -0.06, 1.18, -0.2));
  disp.add(at(box(0.08, 0.04, 0.3, M.alu), 0.06, 1.18, -0.2));
  disp.add(at(box(0.22, 0.16, 0.03, std(0x0d2a4a, 0.2, 0.3, { emissive: new THREE.Color(0x1d6fd6), emissiveIntensity: 0.5 })), 0, 1.32, 0.125));
  // vacuum sealer portal
  for (const s of [-1, 1]) scene.add(at(box(0.06, 0.55, 0.06, M.alu), BAG.x[1] + s * 0.26, BAG.top + 0.27, BAG.z + 0.18));
  scene.add(at(box(0.6, 0.2, 0.3, std(0xd5dae0, 0.3, 0.4)), BAG.x[1], BAG.top + 0.62, BAG.z + 0.08));
  const sealBar = new THREE.Group();
  sealBar.position.set(BAG.x[1], BAG.top + 0.45, BAG.z);
  scene.add(sealBar);
  sealBar.add(at(box(0.46, 0.04, 0.05, std(0x3a3f47, 0.4, 0.4)), 0, 0, 0.05));
  sealBar.add(at(box(0.46, 0.02, 0.03, std(0xd23b3b, 0.2, 0.4, { emissive: new THREE.Color(0xd23b3b), emissiveIntensity: 0 })), 0, -0.03, 0.05));
  const sealHeat = (sealBar.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial;
  // label printer + applicator
  scene.add(at(box(0.36, 0.42, 0.3, std(0xe9ecef, 0.15, 0.45)), BAG.x[2], 1.06, BAG.z + 0.42));
  scene.add(at(box(0.04, 0.3, 0.04, M.alu), BAG.x[2], 1.4, BAG.z + 0.28));
  const applicator = new THREE.Group();
  applicator.position.set(BAG.x[2], BAG.top + 0.4, BAG.z);
  scene.add(applicator);
  applicator.add(at(box(0.03, 0.4, 0.03, M.alu), 0, 0.2, 0.06));
  applicator.add(at(box(0.12, 0.03, 0.09, M.aluDark), 0, 0, 0));
  scene.add(at(box(0.04, 0.6, 0.04, M.alu), BAG.x[2] + 0.28, BAG.top + 0.3, BAG.z - 0.22));
  scene.add(at(box(0.08, 0.06, 0.08, M.dark), BAG.x[2] + 0.28, BAG.top + 0.6, BAG.z - 0.22));
  const verifyBeam = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.2), new THREE.MeshBasicMaterial({ color: 0xff2d2d, toneMapped: false }));
  verifyBeam.rotation.x = -Math.PI / 2;
  verifyBeam.position.set(BAG.x[2], BAG.top + BAG_H + 0.01, BAG.z);
  verifyBeam.visible = false;
  scene.add(verifyBeam);
  const verdictMat = new THREE.MeshStandardMaterial({ color: 0x334155, emissive: 0x000000, emissiveIntensity: 1.6 });
  scene.add(at(cyl(0.05, 0.05, 0.06, verdictMat, 16), BAG.x[2] + 0.28, BAG.top + 0.66, BAG.z - 0.22));
  // reject chute and bin
  const chute = at(box(0.3, 0.02, 0.3, M.aluDark), BAG.reject + 0.08, BAG.top - 0.12, BAG.z);
  chute.rotation.z = -0.5;
  scene.add(chute);
  scene.add(at(box(0.4, 0.5, 0.4, std(0xd23b3b, 0.1, 0.5)), BAG.reject + 0.35, 0.25, BAG.z));
  scene.add(at(box(0.36, 0.02, 0.36, std(0x2a2d33, 0.2, 0.6)), BAG.reject + 0.35, 0.49, BAG.z));
  const rejectPile: THREE.Object3D[] = [];

  // ---------- outfeed belt and pallet ----------
  const outTex = buildConveyor(scene, M, new Track([line(OUT.x0, OUT.z, OUT.x1, OUT.z)], false), 0.36, OUT.top);
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
  for (const [x, z] of [[-1.5, -1.25], [1.7, -1.25], [-1.5, -0.25]]) scene.add(at(box(0.05, 1.9, 0.05, M.yellow), x, 0.95, z));
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
  const andons = createAndons(M);
  const andon = andons.make(hmi, 0.22, 1.5, -0.1);

  // ---------- robot ----------
  const arm = makeCobot(scene, M, { x: ROBOT.x, z: ROBOT.z, L1: 0.61, L2: 0.57, ped: ROBOT.ped, pedW: 0.36 });
  arm.tool.rotation.order = 'YXZ';
  const grip = vacuumPlate(arm.mount, M, { w: 0.34, d: 0.15, drop: DROP });
  const P = (x: number, top: number, z: number): Pose => [...poseAt(arm, x, z, top + DROP), 0, 0];
  const idle = P(0.3, 1.25, 0.45);
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
    const flap = new THREE.Group();
    flap.position.set(0, BAGD.h, -BAGD.w / 2);
    flap.rotation.x = -Math.PI / 2 * 0.95;
    body.add(flap);
    flap.add(at(box(BAGD.l, t, BAGD.w + 0.04, bagMat), 0, 0, BAGD.w / 2 + 0.02));
    const seal = at(box(0.012, 0.004, BAGD.w + 0.02, sealMat), BAGD.l / 2 - 0.025, BAGD.h + 0.003, 0);
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
    obj.add(at(box(l, t, w, cartonMat), 0, t / 2, 0));
    for (const s of [-1, 1]) { obj.add(at(box(l, h, t, cartonMat), 0, h / 2, s * w / 2)); obj.add(at(box(t, h, w, cartonMat), s * l / 2, h / 2, 0)); }
    const flaps = [-1, 1].map(s => {
      const pivot = new THREE.Group();
      pivot.position.set(0, h, s * w / 2);
      pivot.rotation.x = s * Math.PI * 0.45;
      pivot.add(at(box(l, t, w / 2, cartonDark), 0, 0, -s * w / 4));
      obj.add(pivot);
      return pivot;
    });
    obj.add(at(box(0.12, 0.08, 0.002, labelMat), 0, h * 0.6, w / 2 + 0.004));
    shadowify(obj);
    scene.add(obj);
    return { obj, flaps, count: 0, state: 'arriving', t: 0, x: OUT.x0 + 0.25 };
  }

  // ---------- state ----------
  const stacks: Stack[] = [];
  const slots: Slot[] = [0, 1, 2].map(() => ({ bag: null, phase: 'none', t: 0 }));
  let carton = makeCarton();
  let leaving: Carton | null = null;
  let indexing = 0; // seconds left of the line index
  let held: { kind: 'stack'; s: Stack } | { kind: 'bag'; b: Bag } | null = null;
  const actor = { seq: [] as Step[], pose: idle.slice() };
  let stats = newStats();
  let demandT = 0, scanFlash = 0, verdictT = 0, lastLabel = '—', lastVerdict: 'ok' | 'ng' | null = null;
  const lotName = (n: number) => `A26-11-${String(1000 + n).slice(-4)}`;

  const MOVE = 1.5, DOWN = 0.5; // collaborative speeds: the cell works next to people
  function stackToBag(st: Stack): Step[] {
    const bagBottom = BAG.top + 0.006, x = BAG.x[0], z = BAG.z;
    return [
      { to: P(IN.pick, IN.top + STACK_H + 0.15, IN.z), dur: MOVE },
      { to: P(IN.pick, IN.top + STACK_H, IN.z), dur: DOWN },
      { fn: () => { grip.attach(st.obj); stacks.splice(stacks.indexOf(st), 1); held = { kind: 'stack', s: st }; } },
      { to: P(IN.pick, IN.top + STACK_H + 0.2, IN.z), dur: DOWN },
      { to: P(x, bagBottom + STACK_H + 0.2, z), dur: MOVE },
      { to: P(x, bagBottom + STACK_H, z), dur: 0.55 },
      { fn: () => {
        const b = slots[0].bag!;
        b.obj.attach(st.obj);
        st.obj.position.set(0, 0.004, 0); st.obj.rotation.set(0, 0, 0);
        b.stack = st; held = null;
        slots[0].phase = 'loaded'; slots[0].t = 0;
      } },
      { to: P(x, bagBottom + STACK_H + 0.2, z), dur: DOWN },
      { to: idle, dur: 0.9, ready: true },
    ];
  }
  function bagToCarton(b: Bag): Step[] {
    const x = BAG.x[2], z = BAG.z, top = BAG.top + 0.006 + BAG_H;
    const k = carton.count, placeTop = OUT.top + 0.012 + k * 0.1 + BAG_H;
    return [
      { to: P(x, top + 0.15, z), dur: MOVE },
      { to: P(x, top, z), dur: DOWN },
      { fn: () => { grip.attach(b.obj); slots[2] = { bag: null, phase: 'none', t: 0 }; held = { kind: 'bag', b }; } },
      { to: P(x, OUT.top + CARTON.h + BAG_H + 0.12, z), dur: 0.6 },
      { to: P(OUT.fill, OUT.top + CARTON.h + BAG_H + 0.12, OUT.z), dur: MOVE },
      { to: P(OUT.fill, placeTop, OUT.z), dur: 0.7 },
      { fn: () => {
        carton.obj.attach(b.obj);
        b.obj.position.set(0, 0.012 + k * 0.1, 0); b.obj.rotation.set(0, 0, 0);
        carton.count++; held = null; stats.bags++;
      } },
      { to: P(OUT.fill, OUT.top + CARTON.h + BAG_H + 0.12, OUT.z), dur: 0.6 },
      { to: idle, dur: 0.9, ready: true },
    ];
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
    const s0 = slots[0], s1 = slots[1], s2 = slots[2];
    s0.t += dt; s1.t += dt; s2.t += dt;
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
      if (s0.phase === 'closing') { b.flap.rotation.x = -Math.PI / 2 * 0.95 * Math.max(0, 1 - s0.t / 1.0); if (s0.t >= 1.0) s0.phase = 'ready'; }
    }
    if (s1.phase === 'seal' && s1.bag) {
      stats.sealT += dt;
      const u = s1.t / params.sealS, down = u > 0.1 && u < 0.9 ? 1 : 0;
      sealBar.position.y += ((BAG.top + 0.006 + BAG_H + 0.04 + (1 - down) * 0.2) - sealBar.position.y) * Math.min(1, dt * 8);
      sealHeat.emissiveIntensity = down ? 1.6 : 0;
      s1.bag.body.scale.y = 1 - (1 - VACUUM) * Math.min(1, Math.max(0, (u - 0.1) / 0.5));
      if (u > 0.6) s1.bag.seal.visible = true;
      if (u >= 1) { s1.phase = 'ready'; sealHeat.emissiveIntensity = 0; }
    } else sealBar.position.y += (BAG.top + 0.45 - sealBar.position.y) * Math.min(1, dt * 6);
    if (s2.bag && (s2.phase === 'label' || s2.phase === 'verify')) {
      stats.labelT += dt;
      if (s2.phase === 'label') {
        const u = s2.t / params.labelS, press = u > 0.5 && u < 0.85;
        applicator.position.y += ((BAG.top + 0.006 + BAG_H + (press ? 0.02 : 0.32)) - applicator.position.y) * Math.min(1, dt * 10);
        if (u > 0.7) {
          if (!s2.bag.label.visible) {
            s2.bag.wrong = params.wrongLabel && rng() < WRONG_RATE;
            (s2.bag.label.material as THREE.MeshBasicMaterial).map = s2.bag.wrong ? wrongTex : labelTex;
            s2.bag.label.visible = true;
          }
        }
        if (u >= 1) { s2.phase = 'verify'; s2.t = 0; }
      } else {
        verifyBeam.visible = s2.t < 1.0;
        if (s2.t >= 1.2) {
          const ng = s2.bag.wrong;
          s2.phase = ng ? 'ng' : 'ok';
          lastVerdict = ng ? 'ng' : 'ok';
          lastLabel = ng ? 'B26-10-9999' : lotName(s2.bag.lot);
          verdictT = 1.8;
          verdictMat.emissive.setHex(ng ? 0xef4444 : 0x22c55e);
          if (ng) stats.ng++;
          drawHmi();
        }
      }
    } else applicator.position.y += (BAG.top + 0.4 - applicator.position.y) * Math.min(1, dt * 6);
    if (s2.phase === 'ng' && s2.bag) { s2.phase = 'eject'; s2.t = 0; }
    if (s2.phase === 'eject' && s2.bag) {
      const u = Math.min(1, s2.t / 0.8);
      s2.bag.obj.position.set(BAG.x[2] + u * (BAG.reject + 0.35 - BAG.x[2]), BAG.top + 0.006 - u * (BAG.top - 0.5 + 0.006) + 0.03 * rejectPile.length, BAG.z);
      if (u >= 1) { rejectPile.push(s2.bag.obj); if (rejectPile.length > 6) scene.remove(rejectPile.shift()!); slots[2] = { bag: null, phase: 'none', t: 0 }; }
    }
    verdictT = Math.max(0, verdictT - dt);
    if (verdictT <= 0) verdictMat.emissive.setHex(0x000000);

    // index the line: every bag moves one station forward
    const free = (s: Slot) => s.phase === 'none';
    const done = (s: Slot) => s.phase === 'ready';
    if (indexing <= 0 && free(s2) && (free(s1) || done(s1)) && (free(s0) || done(s0)) && (done(s0) || done(s1))) indexing = 1.0;
    if (indexing > 0) {
      const before = indexing;
      indexing -= dt;
      const u = 1 - Math.max(0, indexing) / 1.0, du = u - (1 - before / 1.0);
      for (let i = 0; i < 2; i++) if (slots[i].bag && done(slots[i])) slots[i].bag!.obj.position.x += du * (BAG.x[i + 1] - BAG.x[i]);
      if (indexing <= 0) {
        if (done(s1)) { slots[2] = { bag: s1.bag, phase: 'label', t: 0 }; slots[1] = { bag: null, phase: 'none', t: 0 }; }
        if (done(s0)) { slots[1] = { bag: s0.bag, phase: 'seal', t: 0 }; slots[0] = { bag: null, phase: 'none', t: 0 }; }
        slots.forEach((s, i) => s.bag?.obj.position.set(BAG.x[i], BAG.top + 0.006, BAG.z));
        indexing = 0;
      }
    }

    // carton: arrives, is filled by the robot, closes, rides to the pallet
    outTex.offset.x = (outTex.offset.x - (carton.state === 'arriving' || leaving ? OUT.speed : 0) * dt / 0.25) % 1;
    carton.t += dt;
    if (carton.state === 'arriving') {
      carton.x = Math.min(OUT.fill, carton.x + OUT.speed * dt);
      stats.changeT += dt;
      if (carton.x >= OUT.fill) carton.state = 'filling';
    } else if (carton.state === 'filling' && carton.count >= params.perCarton && !(held && held.kind === 'bag')) { carton.state = 'closing'; carton.t = 0; }
    else if (carton.state === 'closing') {
      stats.changeT += dt;
      carton.flaps.forEach((f, i) => (f.rotation.x = (i ? 1 : -1) * Math.PI * 0.45 * Math.max(0, 1 - carton.t / 1.2)));
      if (carton.t >= 1.3) { carton.state = 'leaving'; leaving = carton; stats.cartons++; carton = makeCarton(); }
    }
    carton.obj.position.set(carton.x, OUT.top, OUT.z);
    if (leaving) {
      leaving.x += OUT.speed * dt;
      leaving.obj.position.set(leaving.x, OUT.top, OUT.z);
      if (leaving.x >= OUT.x1 - 0.2) {
        const n = onPallet.length, layer = Math.floor(n / 6), k = n % 6;
        palletG.attach(leaving.obj);
        leaving.obj.position.set(-0.3 + (k % 2) * 0.6, 0.15 + layer * (CARTON.h + 0.01), -0.27 + Math.floor(k / 2) * 0.27);
        leaving.obj.rotation.set(0, 0, 0);
        onPallet.push(leaving.obj);
        if (onPallet.length >= 18) { onPallet.forEach(o => palletG.remove(o)); onPallet.length = 0; stats.pallets++; }
        leaving = null;
      }
    }

    // robot: next job when free
    if (actor.seq.every(s => s.ready)) {
      const pick = stacks.find(s => s.x >= IN.pick - 1e-6);
      if (s2.phase === 'ok' && s2.bag && carton.state === 'filling' && carton.count < params.perCarton) { actor.seq.length = 0; actor.seq.push(...bagToCarton(s2.bag)); s2.phase = 'picking'; }
      else if (s0.phase === 'open' && pick) { actor.seq.length = 0; actor.seq.push(...stackToBag(pick)); s0.phase = 'loading'; }
    }
    const busy = actor.seq.some(s => !s.ready);
    if (busy) stats.robotT += dt;
    runSeq(actor, dt);
    solve(arm, actor.pose);
    const err = urTrack(arm, actor.pose, 4);
    if (stats.t > 3 && busy) stats.maxIkErr = Math.max(stats.maxIkErr, err);
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
  };
}

export type PackCell = ReturnType<typeof createPackCell>;
