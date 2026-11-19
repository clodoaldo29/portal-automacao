// Smart Solder AI · the line shared by both architectures. REAL SCALE (metres), the line runs along +x at z = 0.
//
// Pallets ride the main line and come back on the return belt under it (lifts at both ends). On the main line:
// 1 the operator puts a blank on the pallet and inserts the IR LEDs, 2 the second operator inserts the springs,
// 3 the camera reads the model, loads the soldering recipe and checks the components, [soldering zone: architecture A
// or B], 5 the post-solder inspection classifies every PCB OK / NOK / inconclusive. Right after it, a transfer sends
// NOK and inconclusive pallets onto a short branch with a buffer of up to 4 pallets; at its end lift the operator takes
// the blank off by hand and stores it in the NOK magazine, and the empty pallet goes down and back under the branch to
// the return belt. OK pallets go on to the end lift, where the same operator takes the blank off onto the blank
// conveyor (it starts right at the lift); the UnLoader fills the magazine and an AMR swaps the full magazine for an
// empty one and takes it to assembly and test. Every stop has a presence sensor (green light: pallet there).
import * as THREE from 'three';
import { createAndons } from '../../sim/andon';
import { buildConveyor, flowArrow } from '../../sim/conveyor';
import type { Rng } from '../../sim/des';
import { at, box, canvasTex, cyl, cylA, glow, mk, shadowify, std } from '../../sim/kit';
import { makeLine, station, updateLine, type Line, type LineItem, type Station } from '../../sim/line';
import type { Materials } from '../../sim/materials';
import { buildRoom } from '../../sim/room';
import { Track, line } from '../../sim/track';
import {
  LINE, MAGAZINE, OUT, PALLET, PCB, SPUR, ST, blankJoints, blankSize, boardCenters, ledStationS, springStationS, type SolderParams,
} from './model';

export type Verdict = 'ok' | 'nok' | 'inc';

export interface Blank {
  obj: THREE.Group;
  id: number;
  boards: number;
  /** Joints in soldering order (blank local), and how many are done. */
  pts: { x: number; z: number; board: number }[];
  done: number;
  joints: THREE.InstancedMesh;
  leds: THREE.InstancedMesh;
  springs: THREE.InstancedMesh;
  marks: THREE.Group;
  pre: boolean;
  /** Failed the pre-solder check (a LED or a spring missing or misplaced): goes to the pre-solder NOK branch. */
  preNok: boolean;
  /** Result of each PCB, and of the blank (worst of its PCBs). */
  boardResult: Verdict[];
  result: Verdict | null;
  /** Which robot soldered it (statistics). */
  by: number;
}

export interface Pallet extends LineItem {
  blank: Blank | null;
  /** Soldering zone: where this pallet must stop (-1: nowhere). */
  target: number;
  stage: number;
}

export interface LineStats {
  t: number;
  blanksIn: number;
  inspectedBoards: number; okBoards: number; nokBoards: number; incBoards: number;
  okBlanks: number; nokBlanks: number; incBlanks: number;
  magazines: number; deliveries: number;
  /** NOK / inconclusive blanks stored by hand in the NOK magazine, and the most pallets seen in the NOK buffer. */
  nokStored: number; spurMax: number;
  /** Blanks that failed the pre-solder check, those stored in the pre-solder NOK magazine, and that buffer's peak. */
  preNok: number; preStored: number; preSpurMax: number;
  ledT: number; springT: number; removalT: number; blockedT: number;
}
const newStats = (): LineStats => ({
  t: 0, blanksIn: 0, inspectedBoards: 0, okBoards: 0, nokBoards: 0, incBoards: 0, okBlanks: 0, nokBlanks: 0, incBlanks: 0,
  magazines: 0, deliveries: 0, nokStored: 0, spurMax: 0, preNok: 0, preStored: 0, preSpurMax: 0, ledT: 0, springT: 0, removalT: 0, blockedT: 0,
});

/** Line output in PCBs per hour (after 2 minutes and two blanks). */
export const lineUph = (s: LineStats, boards: number) => (s.t > 120 && s.inspectedBoards >= 2 * boards ? (s.inspectedBoards / s.t) * 3600 : null);

const COPPER = new THREE.Color(0xc77b3a), SILVER = new THREE.Color(0xe8edf2);
const PALLET_N = 17;

/** Standing operator in the blue Multi uniform with a hair cap; arms swing from the shoulders. */
function makeOperator(M: Materials) {
  const g = new THREE.Group();
  const coat = std(0x2457a6, 0.05, 0.7), skin = std(0xc99a7a, 0, 0.7), cap = std(0x8ec5f0, 0, 0.8), pants = std(0x1d2a44, 0, 0.8);
  for (const s of [-1, 1]) g.add(at(cyl(0.065, 0.06, 0.82, pants, 10), s * 0.09, 0.41, 0));
  g.add(at(cyl(0.19, 0.17, 0.66, coat, 14), 0, 1.15, 0));
  g.add(at(cyl(0.055, 0.06, 0.08, skin, 10), 0, 1.52, 0));
  g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skin), 0, 1.64, 0));
  g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), cap), 0, 1.67, 0));
  for (const s of [-1, 1]) g.add(at(box(0.11, 0.05, 0.22, M.black), s * 0.09, 0.025, 0.04));
  const arms = [-1, 1].map(s => {
    const sh = new THREE.Group();
    sh.position.set(s * 0.22, 1.42, 0);
    g.add(sh);
    sh.add(at(cyl(0.05, 0.045, 0.5, coat, 10), 0, -0.25, 0));
    sh.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin), 0, -0.53, 0));
    sh.rotation.x = -0.5;
    return sh;
  });
  shadowify(g);
  return { g, arms };
}
export type Operator = ReturnType<typeof makeOperator>;

/** Monitor on an arm: a canvas the stations draw on. */
function monitor(scene: THREE.Scene, M: Materials, x: number, y: number, z: number, ry: number) {
  const [c, g] = mk(512, 320);
  const tex = canvasTex(c);
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  grp.rotation.y = ry;
  scene.add(grp);
  grp.add(at(box(0.5, 0.33, 0.04, M.black), 0, 0, 0));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.29), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  scr.position.z = 0.021;
  grp.add(scr);
  grp.add(at(box(0.04, 0.04, 0.2, M.aluDark), 0, 0, -0.12));
  return { g, tex, grp };
}

export function createLine(scene: THREE.Scene, M: Materials, font: string, params: SolderParams, rng: Rng) {
  let stats = newStats();
  buildRoom(scene, { w: 17.5, d: 8, x: 1.9, z: 0.4, band: 0x1f5fd6, name: 'Linha PTH · controles remotos', font });

  // ---------- conveyors ----------
  const mainTrack = new Track([line(LINE.x0, 0, LINE.x1, 0)], false);
  const retTrack = new Track([line(LINE.x1, 0, LINE.x0, 0)], false);
  const mainTex = buildConveyor(scene, M, mainTrack, LINE.beltW, LINE.top);
  const retTex = buildConveyor(scene, M, retTrack, LINE.beltW - 0.1, LINE.retTop);
  for (const x of [-4.45, -2.6, 2.3]) flowArrow(scene, x, 0, LINE.top + 0.002);
  const L: Line<Pallet> = makeLine<Pallet>({ track: mainTrack, speed: LINE.speed, gap: LINE.gap, tex: mainTex, y: LINE.top, onExit: () => {} });
  const R: Line<Pallet> = makeLine<Pallet>({ track: retTrack, speed: LINE.speed * 1.4, gap: LINE.gap, tex: retTex, y: LINE.retTop, onExit: () => {} });
  const sAt = (x: number) => x - LINE.x0;

  // ---------- pallets and blanks ----------
  const palletMat = std(0x353a41, 0.15, 0.6), clipMat = std(0x9aa3ad, 0.8, 0.3);
  function makePallet(): THREE.Group {
    const g = new THREE.Group();
    g.add(at(box(PALLET.l, PALLET.h, PALLET.d, palletMat), 0, PALLET.h / 2, 0));
    g.add(at(box(PALLET.l - 0.04, 0.002, PALLET.d - 0.06, std(0x2a2e34, 0.1, 0.7)), 0, PALLET.h + 0.001, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(box(0.03, 0.012, 0.02, clipMat), sx * 0.19, PALLET.h + 0.006, sz * 0.165));
    g.add(at(box(0.05, 0.003, 0.03, std(0xf2f3f5, 0, 0.6)), -0.19, PALLET.h + 0.002, 0)); // RFID / ID tag
    shadowify(g);
    scene.add(g);
    return g;
  }
  const pallets: Pallet[] = [];
  for (let i = 0; i < PALLET_N; i++) {
    const it: Pallet = { obj: makePallet(), s: 0.3 + i * 0.57, hold: null, passed: new Set(), blank: null, target: -1, stage: 0 };
    pallets.push(it);
    R.items.push(it);
  }

  // blank: board texture per PCB count, joints / LEDs / springs as instanced meshes
  const texCache = new Map<number, THREE.Texture>();
  function blankTex(n: number) {
    if (texCache.has(n)) return texCache.get(n)!;
    const { l, w } = blankSize(n), S = 1400, W = Math.round(S * w / l);
    const [c, g] = mk(S, W);
    const px = (x: number) => (x / l + 0.5) * S, pz = (z: number) => (z / w + 0.5) * W;
    g.fillStyle = '#1b5e34'; g.fillRect(0, 0, S, W);
    for (const b of boardCenters(n)) {
      const x0 = px(b.x - PCB.l / 2), z0 = pz(b.z - PCB.w / 2), bw = (PCB.l / l) * S, bh = (PCB.w / w) * W;
      g.fillStyle = '#23794a'; g.fillRect(x0, z0, bw, bh);
      g.strokeStyle = 'rgba(10,30,18,0.8)'; g.lineWidth = 3; g.strokeRect(x0, z0, bw, bh);
      g.strokeStyle = 'rgba(240,250,240,0.55)'; g.lineWidth = 2;
      for (let k = 0; k < 7; k++) { const r = bh * 0.11; g.beginPath(); g.arc(x0 + bw * (0.25 + (k % 4) * 0.13), z0 + bh * (k < 4 ? 0.35 : 0.68), r, 0, Math.PI * 2); g.stroke(); } // button pads
      g.fillStyle = 'rgba(240,250,240,0.7)'; g.font = `600 ${Math.round(bh * 0.2)}px sans-serif`;
      g.fillText('CR-MX', x0 + bw * (b.flip ? 0.72 : 0.08), z0 + bh * 0.25);
    }
    g.fillStyle = '#d9c27a';
    for (const j of blankJoints(n, 10)) { g.beginPath(); g.arc(px(j.x), pz(j.z), 7, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#e5e7eb'; for (const [x, z] of [[0.04, 0.5], [0.96, 0.5]]) { g.beginPath(); g.arc(x * S, z * W, 9, 0, Math.PI * 2); g.fill(); } // fiducials
    const t = canvasTex(c);
    texCache.set(n, t);
    return t;
  }
  const jointGeo = new THREE.CylinderGeometry(0.0016, 0.0019, 0.0014, 8);
  const ledGeo = new THREE.CylinderGeometry(0.0026, 0.0026, 0.009, 10), springGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.012, 10);
  const jointMat = std(0xffffff, 0.85, 0.25), ledMat = std(0x5b6fa8, 0.1, 0.15, { transparent: true, opacity: 0.85 }), springMat = std(0xc9d0d8, 0.9, 0.25);
  const markMat = { nok: new THREE.MeshBasicMaterial({ color: 0xef4444 }), inc: new THREE.MeshBasicMaterial({ color: 0xf59e0b }) };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  let blankSeq = 0;
  function makeBlank(): Blank {
    const n = params.boards, { l, w } = blankSize(n), pts = blankJoints(n, params.points);
    const obj = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(l, PCB.t, w), [M.dark, M.dark, std(0xffffff, 0.05, 0.55, { map: blankTex(n) }), M.dark, M.dark, M.dark]);
    base.position.y = PCB.t / 2;
    base.castShadow = base.receiveShadow = true;
    obj.add(base);
    const joints = new THREE.InstancedMesh(jointGeo, jointMat, pts.length);
    pts.forEach((p, i) => { joints.setMatrixAt(i, _m.makeTranslation(p.x, PCB.t + 0.0007, p.z)); joints.setColorAt(i, COPPER); });
    obj.add(joints);
    const centers = boardCenters(n);
    const leds = new THREE.InstancedMesh(ledGeo, ledMat, n * 2), springs = new THREE.InstancedMesh(springGeo, springMat, n * 2);
    centers.forEach((c, i) => {
      const s = c.flip ? -1 : 1;
      for (const k of [0, 1]) {
        leds.setMatrixAt(i * 2 + k, _m.makeTranslation(c.x + s * (0.074 + k * 0.0), PCB.t + 0.0045 + k * 0.0, c.z + (k ? 0.009 : -0.009)));
        _q.copy(_qz);
        springs.setMatrixAt(i * 2 + k, _m.compose(new THREE.Vector3(c.x - s * 0.068, PCB.t + 0.0055, c.z + (k ? 0.013 : -0.013)), _q, new THREE.Vector3(1, 1, 1)));
      }
    });
    leds.count = 0; springs.count = 0;
    obj.add(leds, springs);
    const marks = new THREE.Group();
    obj.add(marks);
    obj.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    stats.blanksIn++;
    return { obj, id: blankSeq++, boards: n, pts, done: 0, joints, leds, springs, marks, pre: false, preNok: false, boardResult: [], result: null, by: -1 };
  }
  /** Free the per-blank GPU resources (its texture and the shared geometries stay). */
  function disposeBlank(b: Blank) {
    b.obj.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) { (m as unknown as THREE.InstancedMesh).dispose(); return; }
      if (m.geometry !== jointGeo && m.geometry !== ledGeo && m.geometry !== springGeo) m.geometry.dispose();
      if (Array.isArray(m.material)) m.material[2].dispose();
    });
  }
  /** A joint turns from bare copper to a shiny solder fillet. */
  function solderJoint(b: Blank, i: number) {
    b.joints.setColorAt(i, SILVER);
    b.joints.instanceColor!.needsUpdate = true;
    b.done = Math.max(b.done, i + 1);
  }
  /** World position of joint i of a blank (its object must be placed). */
  const _v = new THREE.Vector3();
  function jointWorld(b: Blank, i: number) {
    b.obj.updateWorldMatrix(true, false);
    const p = b.pts[i];
    return _v.set(p.x, PCB.t + 0.0014, p.z).applyMatrix4(b.obj.matrixWorld).clone();
  }

  // ---------- lifts at both ends ----------
  const liftMat = std(0xdfe3e7, 0.25, 0.45);
  /** Lift tower: four posts and a top frame, open on every side (the operator unloads blanks on the end lifts). */
  function liftTower(x: number, z = 0) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    scene.add(g);
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) g.add(at(box(0.05, 1.25, 0.05, M.alu), sx * 0.27, 0.625, sz * 0.3));
    g.add(at(box(0.6, 0.05, 0.66, M.alu), 0, 1.25, 0));
    g.add(at(box(0.5, 0.3, 0.5, liftMat), 0, 0.15, 0)); // drive
    const plat = new THREE.Group();
    g.add(plat);
    plat.add(at(box(0.5, 0.03, 0.44, M.aluDark), 0, -0.015, 0));
    for (const sz of [-1, 1]) plat.add(at(box(0.5, 0.05, 0.02, M.alu), 0, 0.01, sz * 0.22));
    shadowify(g);
    return plat;
  }
  const liftEnd = { plat: liftTower(LINE.x1 - 0.25), item: null as Pallet | null, t: 0, phase: 'idle' as 'idle' | 'move' | 'wait' };
  const liftStart = { plat: liftTower(LINE.x0 + 0.25), item: null as Pallet | null, t: 0, phase: 'idle' as 'idle' | 'move' | 'wait' };
  liftEnd.plat.position.y = LINE.top; liftStart.plat.position.y = LINE.retTop;
  /** The end lift of the main line: an OK pallet waits there while the operator takes its blank off. */
  const endStop = station(L, mainTrack.length - 0.25, () => true, it => { if (it.blank) jRem = { it, t: 0, dur: 0 }; });
  const retStop = station(R, retTrack.length - 0.25, () => true, () => {});
  /** A lift takes the pallet held at `stop` (once `ready`), moves it from y0 to y1 and puts it on `to` at `toS`. */
  function stepLift(lf: typeof liftEnd, from: Line<Pallet>, stop: Station<Pallet>, to: Line<Pallet>, y0: number, y1: number, dt: number, ready: (it: Pallet) => boolean = () => true, toS = 0.25) {
    if (lf.phase === 'idle') {
      const it = from.items.find(i => i.hold === stop);
      if (it && ready(it)) { from.items.splice(from.items.indexOf(it), 1); lf.item = it; lf.phase = 'move'; lf.t = 0; }
    }
    if (lf.phase === 'move' && lf.item) {
      lf.t += dt;
      const u = Math.min(1, lf.t / 2.2), y = y0 + (y1 - y0) * (u * u * (3 - 2 * u));
      lf.plat.position.y = y;
      lf.item.obj.position.y = y;
      if (u >= 1) lf.phase = 'wait';
    }
    if (lf.phase === 'wait' && lf.item) {
      if (!to.items.some(i => Math.abs(i.s - toS) < to.gap)) {
        const it = lf.item;
        it.s = toS; it.hold = null; it.passed = new Set(); it.target = -1;
        to.items.push(it);
        lf.item = null; lf.phase = 'idle'; lf.t = 0;
      }
    } else if (lf.phase === 'idle') lf.plat.position.y += (y0 - lf.plat.position.y) * Math.min(1, dt * 2);
  }

  // ---------- manual stations, inspections ----------
  const andons = createAndons(M);
  const benchTop = std(0x7a8794, 0.2, 0.6);
  /** Parts shelf over the front of the line and a stopper on the belt. */
  function partsShelf(x: number, colors: number[]) {
    scene.add(at(box(0.7, 0.03, 0.22, benchTop), x, 1.05, -0.42));
    for (const s of [-1, 1]) scene.add(at(box(0.03, 0.2, 0.03, M.alu), x + s * 0.33, 0.95, -0.42));
    colors.forEach((c, i) => {
      scene.add(at(box(0.16, 0.07, 0.14, std(c, 0.05, 0.6)), x - 0.2 + i * 0.2, 1.1, -0.42));
    });
  }
  function stopper(x: number) { scene.add(at(box(0.04, 0.03, 0.08, M.yellow), x + PALLET.l / 2 + 0.03, LINE.top + 0.015, -0.18)); }

  // 1 · blank + IR LEDs
  const op1 = makeOperator(M); op1.g.position.set(ST.load, 0, -0.82); scene.add(op1.g);
  const op2 = makeOperator(M); op2.g.position.set(ST.spring, 0, -0.82); scene.add(op2.g);
  partsShelf(ST.load, [0x1f5fd6, 0x334155, 0x1f5fd6]);
  partsShelf(ST.spring, [0x94a3b8, 0x64748b, 0x94a3b8]);
  stopper(ST.load); stopper(ST.spring); stopper(ST.pre); stopper(ST.post); stopper(ST.divert);
  // presence sensors: a photo-eye at every stop, its light turns green while a pallet (or blank) is there
  const sensorOn = new THREE.MeshBasicMaterial({ color: 0x22c55e, toneMapped: false }), sensorOff = new THREE.MeshBasicMaterial({ color: 0x334155 });
  const sensors: { led: THREE.Mesh; on: () => boolean }[] = [];
  /** Photo-eye at (x, y, z) facing local −z (turned by ry), with its reflector `across` metres away on the far rail. */
  function sensor(x: number, y: number, z: number, on: () => boolean, ry = 0, across = 0.56) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    scene.add(g);
    g.add(at(box(0.03, 0.045, 0.035, M.dark), 0, 0.02, 0));
    const led = at(box(0.014, 0.014, 0.006, sensorOff), 0, 0.034, 0.019);
    g.add(led);
    g.add(at(box(0.026, 0.03, 0.006, std(0xd23b3b, 0.2, 0.3)), 0, 0.02, -across));
    sensors.push({ led, on });
  }
  /** Sensor on the front rail of a line along +x, at the stop of station `st`. */
  const lineSensor = (ln: Line<Pallet>, st: Station<Pallet>, x: number) => sensor(x + PALLET.l / 2 - 0.03, LINE.top + 0.04, 0.3, () => ln.items.some(i => i.hold === st));
  // blank supply magazine beside operator 1
  const supply = new THREE.Group();
  supply.position.set(ST.load - 0.62, 0, -0.66);
  scene.add(supply);
  supply.add(at(box(0.45, 0.85, 0.4, M.cabinet), 0, 0.425, 0));
  for (let i = 0; i < 12; i++) supply.add(at(box(0.38, 0.004, 0.3, std(0x1b5e34, 0.05, 0.6)), 0, 0.9 + i * 0.022, 0));
  for (const sx of [-1, 1]) supply.add(at(box(0.02, 0.3, 0.36, M.alu), sx * 0.21, 1.03, 0));
  shadowify(supply);

  // 3 · model identification + pre-solder inspection; 5 · post-solder inspection: hood with camera and ring light
  function hood(x: number, title: string) {
    const g = new THREE.Group();
    g.position.set(x, 0, 0);
    scene.add(g);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(box(0.04, 0.75, 0.04, M.alu), sx * 0.3, LINE.top + 0.375, sz * 0.32));
    const skin = std(0x1e293b, 0.2, 0.5);
    g.add(at(box(0.64, 0.06, 0.68, skin), 0, LINE.top + 0.78, 0));
    for (const sz of [-1, 1]) g.add(at(box(0.62, 0.42, 0.01, std(0x0f172a, 0.1, 0.4, { transparent: true, opacity: 0.55 })), 0, LINE.top + 0.54, sz * 0.33));
    g.add(at(box(0.1, 0.12, 0.1, M.black), 0, LINE.top + 0.69, 0));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 8, 28), new THREE.MeshBasicMaterial({ color: 0xdbeafe }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, LINE.top + 0.62, 0);
    g.add(ring);
    const light = glow(0xbfdbfe, 0.7);
    light.position.set(0, LINE.top + 0.25, 0);
    light.visible = false;
    g.add(light);
    shadowify(g);
    const mon = monitor(scene, M, x + 0.05, LINE.top + 0.62, 0.62, 0);
    const andon = andons.make(g, 0.3, LINE.top + 0.8, -0.32);
    return { light, mon, andon, title };
  }
  const pre = hood(ST.pre, 'IDENTIFICAÇÃO + PRÉ-SOLDA');
  const post = hood(ST.post, 'INSPEÇÃO PÓS-SOLDA');
  function drawScreen(h: typeof pre, b: Blank | null, phase: string) {
    const g = h.mon.g;
    g.fillStyle = '#0a1520'; g.fillRect(0, 0, 512, 320);
    g.fillStyle = '#0b3a6b'; g.fillRect(0, 0, 512, 46);
    g.fillStyle = '#fff'; g.font = `600 24px ${font}`; g.textBaseline = 'middle'; g.fillText(h.title, 14, 24);
    if (!b) { g.fillStyle = '#a9bdd3'; g.font = `500 22px ${font}`; g.fillText('Aguardando pallet', 14, 90); h.mon.tex.needsUpdate = true; return; }
    const n = b.boards, rows = Math.ceil(n / 2), cw = 150, ch = Math.min(46, 200 / rows);
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / 2), col = i % 2;
      const v = h === post ? b.boardResult[i] : undefined;
      g.fillStyle = v === 'nok' ? '#ef4444' : v === 'inc' ? '#f59e0b' : v === 'ok' ? '#22c55e' : '#23794a';
      g.fillRect(16 + col * (cw + 8), 62 + r * (ch + 6), cw, ch);
      g.fillStyle = '#04110a'; g.font = `600 ${Math.round(ch * 0.42)}px ${font}`;
      g.fillText(`PCB ${i + 1}`, 24 + col * (cw + 8), 62 + r * (ch + 6) + ch / 2);
    }
    g.fillStyle = '#fff'; g.font = `600 22px ${font}`;
    g.fillText(`Blank #${String(b.id + 1).padStart(4, '0')}`, 340, 80);
    g.font = `500 19px ${font}`; g.fillStyle = '#a9bdd3';
    if (h === pre) {
      g.fillText(`Modelo CR-MX · ${n} PCBs`, 340, 120);
      g.fillText(`Receita: ${params.points} pontos/PCB`, 340, 150);
      g.fillStyle = phase === 'ok' ? '#22c55e' : phase === 'nok' ? '#ef4444' : '#a9bdd3';
      g.fillText(phase === 'ok' ? 'LEDs e molas OK' : phase === 'nok' ? 'NOK: LED ou mola fora' : 'Verificando…', 340, 190);
      if (phase === 'nok') { g.font = `500 18px ${font}`; g.fillText('Desvio para o buffer NOK', 340, 222); }
    } else {
      const c = (v: Verdict) => b.boardResult.filter(x => x === v).length;
      g.fillText(`OK ${c('ok')} · NOK ${c('nok')} · ? ${c('inc')}`, 340, 120);
      g.font = `700 28px ${font}`;
      g.fillStyle = b.result === 'ok' ? '#22c55e' : b.result === 'nok' ? '#ef4444' : b.result === 'inc' ? '#f59e0b' : '#a9bdd3';
      g.fillText(b.result === 'ok' ? 'BLANK OK' : b.result === 'nok' ? 'BLANK NOK' : b.result === 'inc' ? 'REVISÃO QA' : 'Inspecionando…', 340, 170);
    }
    h.mon.tex.needsUpdate = true;
  }
  drawScreen(pre, null, ''); drawScreen(post, null, '');

  // 6 · end-of-line operator: takes OK blanks off at the end lift onto the blank conveyor, and NOK blanks off at the
  // lift of the post-solder NOK branch into its NOK magazine (walks between the two)
  const op3 = makeOperator(M);
  scene.add(op3.g);
  const OP_OK: [number, number] = [LINE.x1 - 0.02, -0.72];
  op3.g.position.set(OP_OK[0], 0, OP_OK[1]);
  const signTex = (text: string, bg: string, w = 512) => { const [c, g] = mk(w, 96); g.fillStyle = bg; g.fillRect(0, 0, w, 96); g.fillStyle = '#fff'; g.font = `700 54px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, 50); return canvasTex(c); };

  // ---------- blank conveyor (from the end lift) and UnLoader ----------
  const outTex = buildConveyor(scene, M, new Track([line(OUT.x0, 0, OUT.x1, 0)], false), 0.36, OUT.top);

  // UnLoader: elevator tower around the magazine at the end of the blank conveyor
  const UNL = { x: OUT.x1 + 0.22, slotPitch: 0.024, base0: 0.03, xferY: 0.76 };
  const tower = new THREE.Group();
  tower.position.set(UNL.x, 0, 0);
  scene.add(tower);
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) tower.add(at(box(0.05, 1.7, 0.05, M.alu), sx * 0.26, 0.85, sz * 0.27));
  tower.add(at(box(0.56, 0.05, 0.6, M.alu), 0, 1.7, 0));
  tower.add(at(box(0.56, 0.3, 0.6, liftMat), 0, 0.15, 0));
  shadowify(tower);
  const uAndon = andons.make(tower, 0.26, 1.72, 0.27);
  const magWall = std(0x6b7280, 0.6, 0.35), plateMat = std(0x1b5e34, 0.05, 0.6);
  interface Magazine { g: THREE.Group; plates: THREE.InstancedMesh; fill: number }
  function makeMagazine(): Magazine {
    const g = new THREE.Group(), H = MAGAZINE.slots * UNL.slotPitch + 0.06;
    for (const sz of [-1, 1]) g.add(at(box(0.4, H, 0.012, magWall), 0, H / 2, sz * 0.165));
    g.add(at(box(0.4, 0.012, 0.34, magWall), 0, 0.006, 0));
    g.add(at(box(0.4, 0.012, 0.34, magWall), 0, H, 0));
    g.add(at(box(0.04, 0.02, 0.1, M.dark), 0.15, H + 0.02, 0)); // handle
    const plates = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 0.003, 0.29), plateMat, MAGAZINE.slots);
    for (let k = 0; k < MAGAZINE.slots; k++) plates.setMatrixAt(k, _m.makeTranslation(0, UNL.base0 + k * UNL.slotPitch, 0));
    plates.count = 0;
    g.add(plates);
    shadowify(g);
    scene.add(g);
    return { g, plates, fill: 0 };
  }
  /** Magazine base height so slot k is level with the conveyor. */
  const slotY = (k: number) => OUT.top - UNL.base0 - k * UNL.slotPitch - 0.002;
  let mag: Magazine | null = makeMagazine();
  mag.g.position.set(UNL.x, slotY(0), 0);
  let magMove: { y: number } | null = null;

  // AMR (highlighted): Multi blue body, roller top with two magazine places, amber beacon, route painted on the floor
  const amr = new THREE.Group();
  const amrBlue = std(0x1546c4, 0.25, 0.5), amrDark = std(0x1b1d22, 0.3, 0.5);
  amr.add(at(box(0.62, 0.28, 0.92, amrBlue), 0, 0.2, 0));
  amr.add(at(box(0.64, 0.07, 0.94, amrDark), 0, 0.055, 0));
  amr.add(at(box(0.645, 0.022, 0.945, new THREE.MeshBasicMaterial({ color: 0x38bdf8, toneMapped: false })), 0, 0.12, 0));
  amr.add(at(cyl(0.06, 0.07, 0.07, amrDark, 12), -0.2, 0.37, 0.38)); // lidar
  for (const s of [-1, 1]) amr.add(at(box(0.36, 0.05, 0.012, M.yellow), 0, 0.24, s * 0.462));
  amr.add(at(box(0.56, 0.32, 0.86, std(0xf2f3f5, 0.2, 0.45)), 0, 0.53, 0));
  amr.add(at(box(0.565, 0.05, 0.865, amrBlue), 0, 0.395, 0));
  for (let k = 0; k < 8; k++) amr.add(at(cylA(0.015, 0.5, M.alu, 'x', 10), 0, 0.745, -0.4 + k * 0.115));
  const amrLogo = signTex('Multi · AMR', '#1f5fd6', 384);
  for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.125), new THREE.MeshBasicMaterial({ map: amrLogo })); m.position.set(s * 0.282, 0.55, 0); m.rotation.y = s * Math.PI / 2; amr.add(m); }
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.3, transparent: true, opacity: 0.9 });
  amr.add(at(cyl(0.012, 0.012, 0.3, M.alu, 8), 0.255, 0.85, -0.4));
  const beacon = at(cyl(0.04, 0.04, 0.07, beaconMat, 16), 0.255, 1.03, -0.4);
  amr.add(beacon);
  const beaconGlow = glow(0xf59e0b, 0.7);
  beaconGlow.position.copy(beacon.position);
  beaconGlow.visible = false;
  amr.add(beaconGlow);
  shadowify(amr);
  scene.add(amr);
  const AMR = { x: UNL.x + 0.52, dockZ: -0.22, deck: 0.76, dest: [OUT.x1 + 3.6, 2.4] as [number, number], speed: 0.8 };
  amr.position.set(AMR.x, 0, AMR.dockZ);
  // floor: dashed yellow route from the dock to assembly and test, and the docking box
  const lane = new THREE.MeshBasicMaterial({ color: 0xf2c230 });
  const dash = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(len / 0.4), h = Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n, m = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.07), lane);
      m.rotation.x = -Math.PI / 2; m.rotation.z = -h;
      m.position.set(x0 + (x1 - x0) * u, 0.016, z0 + (z1 - z0) * u);
      m.userData.noShadow = true;
      scene.add(m);
    }
  };
  for (const s of [-1, 1]) { dash(AMR.x + s * 0.42, AMR.dockZ + 0.6, AMR.x + s * 0.42, 2.4 - s * 0.42); dash(AMR.x - s * 0.42 * -1, 2.4 - s * 0.42, AMR.dest[0] - 0.2, 2.4 - s * 0.42); }
  const dockBox = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.56, 4, 1), lane);
  dockBox.rotation.x = -Math.PI / 2; dockBox.rotation.z = Math.PI / 4;
  dockBox.scale.set(1.05, 1.5, 1);
  dockBox.position.set(AMR.x, 0.015, AMR.dockZ);
  scene.add(dockBox);
  const floorText = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshBasicMaterial({ map: (() => { const [c, g] = mk(512, 128); g.fillStyle = '#f2c230'; g.font = `700 92px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ROTA AMR', 256, 66); return canvasTex(c); })(), transparent: true }));
  floorText.rotation.x = -Math.PI / 2;
  floorText.position.set((AMR.x + AMR.dest[0]) / 2, 0.016, 2.4);
  floorText.userData.noShadow = true;
  scene.add(floorText);
  let amrBack: Magazine | null = makeMagazine(); // the empty magazine it brings
  amr.attach(amrBack.g);
  amrBack.g.position.set(0, AMR.deck, -0.22);
  let amrFront: Magazine | null = null;
  type AmrPhase = 'docked' | 'lower' | 'out' | 'shift' | 'in' | 'raise' | 'go' | 'away' | 'back';
  let amrPhase: AmrPhase = 'docked', amrT = 0, amrPath: [number, number][] = [];
  // assembly and test area (destination)
  const dest = new THREE.Group();
  dest.position.set(AMR.dest[0] + 0.9, 0, AMR.dest[1]);
  scene.add(dest);
  dest.add(at(box(0.9, 0.85, 1.4, M.cabinet), 0, 0.425, 0));
  dest.add(at(box(0.95, 0.04, 1.45, benchTop), 0, 0.87, 0));
  shadowify(dest);
  const destSign = (() => { const [c, g] = mk(512, 96); g.fillStyle = '#0b3a6b'; g.fillRect(0, 0, 512, 96); g.fillStyle = '#fff'; g.font = `700 46px ${font}`; g.textBaseline = 'middle'; g.fillText('Montagem e teste', 22, 50); return canvasTex(c); })();
  const dsg = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.2), new THREE.MeshBasicMaterial({ map: destSign, side: THREE.DoubleSide }));
  dsg.position.set(0, 1.6, 0);
  dsg.rotation.y = -Math.PI / 2;
  dest.add(dsg);
  dest.add(at(box(0.04, 0.7, 0.04, M.alu), 0, 1.2, 0));

  // ---------- station logic ----------
  type Job = { it: Pallet; t: number; dur: number } | null;
  let j1: Job = null, j2: Job = null, jPre: Job = null, jPost: Job = null, jRem: Job = null;
  lineSensor(L, station(L, sAt(ST.load), it => !it.blank, it => { j1 = { it, t: 0, dur: ledStationS(params) }; }), ST.load);
  lineSensor(L, station(L, sAt(ST.spring), it => !!it.blank && it.blank.springs.count === 0, it => { j2 = { it, t: 0, dur: springStationS(params) }; }), ST.spring);
  lineSensor(L, station(L, sAt(ST.pre), it => !!it.blank && !it.blank.pre, it => { jPre = { it, t: 0, dur: 3 }; drawScreen(pre, it.blank, ''); }), ST.pre);
  lineSensor(L, station(L, sAt(ST.post), it => !!it.blank && it.blank.result === null && it.blank.done >= it.blank.pts.length, it => { jPost = { it, t: 0, dur: 4 }; drawScreen(post, it.blank, ''); }), ST.post);
  lineSensor(L, endStop, LINE.x1 - 0.25);

  /**
   * NOK branch at x: a transfer in the main line sends the pallets that match `rule` toward the back onto a buffer
   * conveyor (up to SPUR.cap pallets) that ends on a lift; the operator works on the `side` of it (−1: toward −x) and
   * stores the blank in the NOK magazine on the red cart; the empty pallet goes down and back under it to the return belt.
   */
  function makeBranch(x: number, title: string, side: -1 | 1, rule: (it: Pallet) => boolean, ownSensor = true) {
    const up = new Track([line(x, SPUR.z0, x, SPUR.end)], false), dn = new Track([line(x, SPUR.end, x, -0.2)], false);
    const SU: Line<Pallet> = makeLine<Pallet>({ track: up, speed: LINE.speed, gap: LINE.gap, tex: buildConveyor(scene, M, up, LINE.beltW, LINE.top), y: LINE.top, onExit: () => {} });
    const SD: Line<Pallet> = makeLine<Pallet>({ track: dn, speed: LINE.speed * 1.4, gap: LINE.gap, tex: buildConveyor(scene, M, dn, LINE.beltW - 0.1, LINE.retTop), y: LINE.retTop, onExit: () => {} });
    // transfer unit in the main line: belts that rise between the rollers and move the pallet sideways
    const xfer = new THREE.Group();
    xfer.position.set(x, LINE.top - 0.012, 0);
    scene.add(xfer);
    for (const sx of [-1, 1]) xfer.add(at(box(0.04, 0.02, 0.5, std(0x2f6b47, 0.05, 0.6)), sx * 0.15, 0, 0));
    scene.add(at(box(0.42, 0.18, 0.3, std(0x5f6b7a, 0.2, 0.5)), x, LINE.top - 0.22, 0));
    const lift = { plat: liftTower(x, SPUR.lift), item: null as Pallet | null, t: 0, phase: 'idle' as 'idle' | 'move' | 'wait' };
    lift.plat.position.y = LINE.top;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.12), new THREE.MeshBasicMaterial({ map: signTex(title, '#d23b3b', 768) }));
    sign.position.set(x, 1.3, SPUR.lift + 0.33);
    scene.add(sign);
    const spot: [number, number] = [x + side * 0.62, SPUR.lift];
    // NOK magazine (filled by hand) on a red cart beside the lift
    const cart = new THREE.Group();
    cart.position.set(spot[0], 0, SPUR.lift - 0.66);
    scene.add(cart);
    cart.add(at(box(0.5, 0.66, 0.42, std(0xd23b3b, 0.1, 0.5)), 0, 0.33, 0));
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.08), new THREE.MeshBasicMaterial({ map: signTex('MAGAZINE NOK', '#7f1d1d') }));
    label.position.set(0, 0.45, 0.212);
    cart.add(label);
    shadowify(cart);
    const mag = makeMagazine();
    mag.g.position.set(spot[0], 0.66, SPUR.lift - 0.66);
    const br = {
      x, SU, SD, xfer, lift, spot, mag, max: 0, stored: 0,
      div: null as Job, nok: null as Job, merge: null as { it: Pallet; t: number } | null,
      upStop: station(SU, SPUR.z0 - SPUR.lift, () => true, () => {}),
      dnStop: station(SD, dn.length - 0.25, () => true, () => {}),
    };
    br.upStop.arrive = it => { if (it.blank) br.nok = { it, t: 0, dur: 0 }; };
    const st = station(L, sAt(x), rule, it => { br.div = { it, t: -1, dur: 0.9 }; });
    if (ownSensor) lineSensor(L, st, x);
    sensor(x + 0.3, LINE.top + 0.04, SPUR.lift + 0.12, () => SU.items.some(i => i.hold === br.upStop), Math.PI / 2);
    sensor(x + 0.3, LINE.top + 0.04, -0.8, () => SU.items.some(i => Math.abs(SPUR.z0 - i.s + 0.8) < 0.2), Math.PI / 2);
    return br;
  }
  type Branch = ReturnType<typeof makeBranch>;
  // 3 · pre-solder NOK (component missing or misplaced): the transfer is right under the camera, so a pallet that fails
  // leaves from the inspection stop itself (no extra line length); 5 · post-solder NOK / inconclusive, right after it
  const brPre = makeBranch(ST.pre, 'BUFFER NOK PRÉ-SOLDA · 4', -1, it => !!it.blank && it.blank.pre && it.blank.preNok, false);
  const brPost = makeBranch(ST.divert, 'BUFFER NOK PÓS-SOLDA · 4', 1, it => !!it.blank && it.blank.result !== null && it.blank.result !== 'ok');

  /** Transfer onto the branch, buffer, lift and return of one NOK branch. */
  function stepBranch(br: Branch, dt: number) {
    const { SU, SD, x } = br;
    updateLine(SU, dt);
    updateLine(SD, dt);
    for (const it of SU.items) it.obj.rotation.y = 0; // transfer conveyors keep the pallet's orientation
    for (const it of SD.items) it.obj.rotation.y = 0;
    stepLift(br.lift, SU, br.upStop, SD, LINE.top, LINE.retTop, dt, it => !it.blank);
    if (br.div) {
      const it = br.div.it;
      if (br.div.t < 0) {
        if (SU.items.length < SPUR.cap && !SU.items.some(i => i.s < SU.gap)) { L.items.splice(L.items.indexOf(it), 1); br.div.t = 0; }
      } else {
        br.div.t += dt;
        const u = Math.min(1, br.div.t / br.div.dur);
        it.obj.position.set(x, LINE.top, SPUR.z0 * u);
        br.xfer.position.y = LINE.top - 0.012 + 0.012 * Math.sin(Math.PI * u);
        if (u >= 1) { it.s = 0; it.hold = null; it.passed = new Set(); SU.items.push(it); br.div = null; }
      }
    }
    br.max = Math.max(br.max, SU.items.length);
    // the empty pallet from under the branch back onto the return belt
    const sR = LINE.x1 - x, rFree = () => !R.items.some(i => Math.abs(i.s - sR) < R.gap);
    if (!br.merge) {
      const it = SD.items.find(i => i.hold === br.dnStop);
      if (it && rFree()) { SD.items.splice(SD.items.indexOf(it), 1); br.merge = { it, t: 0 }; }
    }
    if (br.merge) {
      br.merge.t += dt;
      const u = Math.min(1, br.merge.t / 1.0), it = br.merge.it;
      it.obj.position.set(x, LINE.retTop, -0.45 * (1 - u));
      if (u >= 1 && rFree()) { it.s = sR; it.hold = null; it.passed = new Set(); it.target = -1; R.items.push(it); br.merge = null; }
    }
  }

  const release = (it: Pallet) => { it.hold = null; };
  function swing(op: Operator, on: boolean, t: number, phase = 0) {
    op.arms.forEach((a, i) => { a.rotation.x = on ? -0.75 - 0.25 * Math.sin(t * 6 + i * 2 + phase) : -0.2; a.rotation.z = on ? (i ? -0.18 : 0.18) : 0; });
  }

  /** An operator who walks to a pallet, takes the blank off it by hand and puts it at `to` (2.4 s), then `done`. */
  function makeWorker(op: Operator) {
    let task: { it: Pallet; b: Blank | null; spot: [number, number]; to: THREE.Vector3; phase: 'walk' | 'move'; t: number; from: THREE.Vector3; done: (b: Blank) => void } | null = null;
    /** Walk toward `spot` at 1 m/s; true once there (then faces the line). */
    function walkTo(spot: [number, number], dt: number) {
      const p = op.g.position, dx = spot[0] - p.x, dz = spot[1] - p.z, d = Math.hypot(dx, dz), v = 1.0 * dt;
      if (d <= v) { p.set(spot[0], 0, spot[1]); return true; }
      op.g.rotation.y = Math.atan2(dx, dz);
      p.x += (dx / d) * v; p.z += (dz / d) * v;
      return false;
    }
    return {
      get busy() { return !!task; },
      get moving() { return !!task && task.phase === 'move'; },
      walkTo,
      /** Back at `home`, facing the line. */
      home(spot: [number, number], dt: number) { if (walkTo(spot, dt)) { op.g.rotation.y = 0; return true; } return false; },
      start(it: Pallet, spot: [number, number], to: THREE.Vector3, done: (b: Blank) => void) { task = { it, b: null, spot, to, phase: 'walk', t: 0, from: new THREE.Vector3(), done }; },
      step(dt: number) {
        if (!task) return;
        if (task.phase === 'walk') {
          if (!walkTo(task.spot, dt)) return;
          const b = task.it.blank!;
          b.obj.updateWorldMatrix(true, false);
          task.from.setFromMatrixPosition(b.obj.matrixWorld);
          scene.attach(b.obj);
          task.it.blank = null; // the lift takes the empty pallet down
          task.b = b; task.phase = 'move'; task.t = 0;
          return;
        }
        const b = task.b!, p = op.g.position;
        task.t += dt;
        const u = Math.min(1, task.t / 2.4), e = u * u * (3 - 2 * u), f = task.from, to = task.to;
        b.obj.position.set(f.x + (to.x - f.x) * e, f.y + (to.y - f.y) * e + Math.sin(Math.PI * e) * 0.3, f.z + (to.z - f.z) * e);
        op.g.rotation.y = Math.atan2((f.x + to.x) / 2 - p.x, (f.z + to.z) / 2 - p.z);
        if (u >= 1) { const done = task.done; task = null; done(b); }
      },
    };
  }
  /** The worker takes the NOK blank waiting at the branch lift into the branch's NOK magazine. */
  function startNok(w: ReturnType<typeof makeWorker>, br: Branch, count: () => void) {
    const k = br.mag.fill, to = new THREE.Vector3(br.spot[0], 0.66 + UNL.base0 + k * UNL.slotPitch + 0.002, SPUR.lift - 0.66);
    w.start(br.nok!.it, br.spot, to, b => {
      scene.remove(b.obj); disposeBlank(b);
      br.mag.fill = (br.mag.fill + 1) % MAGAZINE.slots; // QA takes the full NOK magazine away
      br.mag.plates.count = br.mag.fill;
      br.stored++;
      count();
    });
    br.nok = null;
  }
  const w2 = makeWorker(op2), w3 = makeWorker(op3);
  const OP2_HOME: [number, number] = [ST.spring, -0.82];

  interface OutBlank { b: Blank; x: number; state: 'ride' | 'push' }
  const outs: OutBlank[] = [];
  const OUT_IN = OUT.x0 + 0.24;

  function verdict(b: Blank) {
    b.boardResult = Array.from({ length: b.boards }, () => { const r = rng(); return r < params.nok ? 'nok' : r < params.nok + params.inconclusive ? 'inc' : 'ok'; });
    b.result = b.boardResult.includes('nok') ? 'nok' : b.boardResult.includes('inc') ? 'inc' : 'ok';
    boardCenters(b.boards).forEach((c, i) => {
      const v = b.boardResult[i];
      if (v === 'ok') return;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.002, 0.012), markMat[v]);
      m.position.set(c.x, PCB.t + 0.004, c.z);
      b.marks.add(m);
    });
    stats.inspectedBoards += b.boards;
    stats.okBoards += b.boardResult.filter(v => v === 'ok').length;
    stats.nokBoards += b.boardResult.filter(v => v === 'nok').length;
    stats.incBoards += b.boardResult.filter(v => v === 'inc').length;
    if (b.result === 'ok') stats.okBlanks++; else if (b.result === 'nok') stats.nokBlanks++; else stats.incBlanks++;
  }

  let postAlarm = 0, preAlarm = 0;
  function step(dt: number) {
    stats.t += dt;
    updateLine(L, dt);
    updateLine(R, dt);
    stepLift(liftEnd, L, endStop, R, LINE.top, LINE.retTop, dt, it => !it.blank);
    stepLift(liftStart, R, retStop, L, LINE.retTop, LINE.top, dt);
    stepBranch(brPre, dt);
    stepBranch(brPost, dt);
    stats.preSpurMax = brPre.max; stats.spurMax = brPost.max;
    for (const s of sensors) s.led.material = s.on() ? sensorOn : sensorOff;
    const T = stats.t;

    // 1 · blank on the pallet, then one pair of LEDs per PCB
    if (j1) {
      const j = j1, it = j.it;
      j.t += dt; stats.ledT += dt;
      if (!it.blank && j.t >= 1.5) {
        const b = makeBlank();
        it.blank = b;
        it.obj.add(b.obj);
        b.obj.position.set(0, PALLET.h + 0.003, 0);
      }
      if (it.blank) it.blank.leds.count = Math.min(it.blank.boards * 2, 2 * Math.floor(Math.max(0, j.t - 3) / params.ledS + 0.999));
      if (j.t >= j.dur) { if (it.blank) it.blank.leds.count = it.blank.boards * 2; release(it); j1 = null; }
    }
    swing(op1, !!j1, T);
    // 2 · springs (operator 2 must be at the station); between pallets, operator 2 empties the pre-solder NOK branch
    let springing = false;
    if (j2 && !w2.busy && w2.home(OP2_HOME, dt)) {
      const j = j2, b = j.it.blank!;
      springing = true;
      j.t += dt; stats.springT += dt;
      b.springs.count = Math.min(b.boards * 2, 2 * Math.floor(j.t / params.springS + 0.999));
      if (j.t >= j.dur) { b.springs.count = b.boards * 2; release(j.it); j2 = null; }
    } else if (!j2 && !w2.busy && brPre.nok) startNok(w2, brPre, () => stats.preStored++);
    else if (!w2.busy && !j2) w2.home(OP2_HOME, dt);
    w2.step(dt);
    swing(op2, springing || w2.moving, T, 1);
    // 3 · camera reads the model and checks LEDs and springs; a blank that fails leaves on the pre-solder NOK branch
    if (jPre) {
      jPre.t += dt;
      pre.light.visible = jPre.t > 0.5 && jPre.t < 2.2;
      pre.andon.state = 'run';
      if (jPre.t >= jPre.dur) {
        const b = jPre.it.blank!;
        b.pre = true;
        if (rng() < params.preNok) {
          b.preNok = true;
          stats.preNok++;
          const c = boardCenters(b.boards)[Math.floor(rng() * b.boards)];
          const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.002, 0.012), markMat.nok);
          m.position.set(c.x, PCB.t + 0.004, c.z);
          b.marks.add(m);
          preAlarm = 3;
        }
        drawScreen(pre, b, b.preNok ? 'nok' : 'ok');
        release(jPre.it); jPre = null;
      }
    } else { pre.light.visible = false; pre.andon.state = 'wait'; }
    preAlarm = Math.max(0, preAlarm - dt);
    if (preAlarm > 0) pre.andon.state = 'alarm';
    // 5 · post-solder inspection
    if (jPost) {
      jPost.t += dt;
      post.light.visible = jPost.t > 0.4 && jPost.t < 3;
      post.andon.state = 'run';
      if (jPost.t >= jPost.dur) {
        const b = jPost.it.blank!;
        verdict(b);
        drawScreen(post, b, '');
        if (b.result !== 'ok') postAlarm = 3;
        release(jPost.it); jPost = null;
      }
    } else { post.light.visible = false; post.andon.state = 'wait'; }
    postAlarm = Math.max(0, postAlarm - dt);
    if (postAlarm > 0) post.andon.state = 'alarm';
    // 6 · end-of-line operator: OK blank onto the blank conveyor (when its entry is free), NOK blank into the NOK magazine
    if (!w3.busy) {
      if (jRem && !outs.some(o => o.x < OUT_IN + 0.45)) { w3.start(jRem.it, OP_OK, new THREE.Vector3(OUT_IN, OUT.top + 0.003, 0), b => outs.push({ b, x: OUT_IN, state: 'ride' })); jRem = null; }
      else if (brPost.nok) startNok(w3, brPost, () => stats.nokStored++);
      else { if (jRem) stats.blockedT += dt; w3.home(OP_OK, dt); }
    }
    if (w3.busy) stats.removalT += dt;
    w3.step(dt);
    swing(op3, w3.moving, T, 2);

    // blank conveyor to the UnLoader
    const moving = outs.some(o => o.state === 'ride' && o.x < OUT.x1 - 0.2 - 1e-6);
    outTex.offset.x = (outTex.offset.x - (moving ? OUT.speed : 0) * dt / 0.25) % 1;
    const sorted = outs.slice().sort((a, b) => b.x - a.x);
    const endX = OUT.x1 - 0.2;
    sorted.forEach((o, i) => {
      if (o.state !== 'ride') return;
      const ahead = sorted[i - 1];
      let nx = Math.min(endX, o.x + OUT.speed * dt);
      if (ahead) nx = Math.min(nx, ahead.x - 0.44);
      o.x = Math.max(o.x, nx);
      o.b.obj.position.set(o.x, OUT.top + 0.003, 0);
    });
    for (const o of outs.slice()) {
      const ot = o as OutBlank & { t?: number };
      if (o.state === 'ride' && o.x >= endX - 1e-6 && mag && !magMove && mag.fill < MAGAZINE.slots && amrPhase !== 'out' && amrPhase !== 'in') {
        o.state = 'push'; ot.t = 0;
      } else if (o.state === 'push') {
        ot.t = (ot.t ?? 0) + dt;
        const u = Math.min(1, ot.t / 1.0);
        o.b.obj.position.x = endX + (UNL.x - endX) * u;
        if (u >= 1 && mag) {
          scene.remove(o.b.obj);
          disposeBlank(o.b);
          mag.fill++;
          mag.plates.count = mag.fill;
          outs.splice(outs.indexOf(o), 1);
          magMove = { y: mag.fill < MAGAZINE.slots ? slotY(mag.fill) : UNL.xferY };
        }
      }
    }
    if (magMove && mag) {
      const y = mag.g.position.y, d = magMove.y - y, v = 0.25 * dt;
      mag.g.position.y = Math.abs(d) <= v ? magMove.y : y + Math.sign(d) * v;
      if (mag.g.position.y === magMove.y) magMove = null;
    }
    uAndon.state = mag && mag.fill >= MAGAZINE.slots ? 'alarm' : outs.some(o => o.state === 'push') ? 'run' : 'wait';
    // AMR beacon: flashes while it moves
    const amrMoving = amrPhase === 'go' || amrPhase === 'back' || amrPhase === 'shift', flash = amrMoving && Math.sin(T * 9) > 0;
    beaconMat.emissiveIntensity = flash ? 2.4 : 0.3;
    beaconGlow.visible = flash;

    // AMR: swaps the full magazine for the empty one it brings, takes the full one to assembly and test
    amrT += dt;
    const full = mag && mag.fill >= MAGAZINE.slots && !magMove;
    if (amrPhase === 'docked' && full && amrBack) { amrPhase = 'out'; amrT = 0; }
    if (amrPhase === 'out' && mag) {
      const u = Math.min(1, amrT / 1.6);
      mag.g.position.set(UNL.x + (AMR.x - UNL.x) * u, UNL.xferY + 0.001, 0);
      if (u >= 1) { amr.attach(mag.g); amrFront = mag; mag = null; amrPhase = 'shift'; amrT = 0; stats.magazines++; }
    }
    if (amrPhase === 'shift') {
      const u = Math.min(1, amrT / 1.5);
      amr.position.z = AMR.dockZ + 0.44 * (u * u * (3 - 2 * u));
      if (u >= 1) { amrPhase = 'in'; amrT = 0; scene.attach(amrBack!.g); }
    }
    if (amrPhase === 'in' && amrBack) {
      const u = Math.min(1, amrT / 1.6);
      amrBack.g.position.set(AMR.x + (UNL.x - AMR.x) * u, UNL.xferY + 0.001, 0);
      if (u >= 1) { mag = amrBack; amrBack = null; mag.fill = 0; mag.plates.count = 0; magMove = { y: slotY(0) }; amrPhase = 'go'; amrT = 0; amrPath = [[AMR.x, 2.4], [AMR.dest[0], AMR.dest[1]]]; }
    }
    if (amrPhase === 'go' || amrPhase === 'back') {
      const tgt = amrPath[0];
      if (tgt) {
        const dx = tgt[0] - amr.position.x, dz = tgt[1] - amr.position.z, d = Math.hypot(dx, dz);
        const want = Math.atan2(dx, dz);
        let da = want - amr.rotation.y;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        if (Math.abs(da) > 0.02) amr.rotation.y += Math.sign(da) * Math.min(Math.abs(da), 1.6 * dt);
        else if (d <= AMR.speed * dt) { amr.position.x = tgt[0]; amr.position.z = tgt[1]; amrPath.shift(); }
        else { amr.position.x += (dx / d) * AMR.speed * dt; amr.position.z += (dz / d) * AMR.speed * dt; }
      } else if (amrPhase === 'go') { amrPhase = 'away'; amrT = 0; }
      else {
        let da = -amr.rotation.y;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        amr.rotation.y += Math.sign(da) * Math.min(Math.abs(da), 1.6 * dt);
        if (Math.abs(da) < 0.01) { amr.rotation.y = 0; amrPhase = 'docked'; amrT = 0; }
      }
    }
    if (amrPhase === 'away') {
      if (amrT > 2 && amrFront) { amr.remove(amrFront.g); amrFront = null; stats.deliveries++; } // unloaded at assembly
      if (amrT > 6 && !amrBack) { amrBack = makeMagazine(); amr.attach(amrBack.g); amrBack.g.position.set(0, AMR.deck, -0.22); amrBack.g.rotation.set(0, 0, 0); }
      if (amrT > 8) { amrPhase = 'back'; amrPath = [[AMR.x, 2.4], [AMR.x, AMR.dockZ]]; }
    }
  }

  /** A stop on the main line for the soldering zone, with its presence sensor. */
  const zoneStop = (x: number, rule: (it: Pallet) => boolean, arrive: (it: Pallet) => void) => { const st = station(L, sAt(x), rule, arrive); lineSensor(L, st, x); return st; };

  return {
    L, R, pallets, step, solderJoint, jointWorld, zoneStop, andons, makeOperator: () => makeOperator(M),
    get stats() { return stats; },
    resetStats() { stats = newStats(); },
    get magazine() { return mag; },
    get amrPhase() { return amrPhase; },
    get outs() { return outs; },
    get jobs() { return { j1, j2, jPre, jPost, jRem }; },
    /** Pallets in the post-solder and the pre-solder NOK buffers. */
    get spur() { return brPost.SU.items.length; },
    get preSpur() { return brPre.SU.items.length; },
  };
}

export type SolderLine = ReturnType<typeof createLine>;
