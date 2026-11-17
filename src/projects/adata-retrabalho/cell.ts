// Project 03 · Adata Technology: 3D inspection and rework validation of BGA memory packages. REAL SCALE (metres).
//
// JEDEC trays of reworked packages (ball side up) leave the input stacker on a shuttle. A laser line profiler on
// an XY gantry scans every package: height, diameter and position of each ball, giving coplanarity, missing balls,
// bridges, deformed balls and misalignment. Packages out of tolerance are picked by the suction nozzle on the same
// gantry and placed in the reject tray; the tray then goes to the output stacker.
import * as THREE from 'three';
import { createAndons } from '../../sim/andon';
import { at, box, canvasTex, cyl, mk, shadowify, std } from '../../sim/kit';
import type { Materials } from '../../sim/materials';
import { ease } from '../../sim/math';
import { DEFAULT_TOL, DEFECTS, PKG, drawIc, measureIc, type IcDefect, type IcResult, type Tolerances } from './ics';

const TABLE = 0.94;
const TRAY = { l: 0.3226, w: 0.1359, h: 0.00762, cols: 20, rows: 8 };
export const PER_TRAY = TRAY.cols * TRAY.rows;
const X_IN = -0.85, X_SCAN = 0, X_OUT = 0.85;
const REJ = { x: 0.42, z: 0.36 };
const HEAD_Y = 1.12;
const pocket = (i: number) => ({ x: (i % TRAY.cols - (TRAY.cols - 1) / 2) * 0.0158, z: (Math.floor(i / TRAY.cols) - (TRAY.rows - 1) / 2) * 0.0165 });
/** Serpentine scan order over the tray. */
const ORDER = Array.from({ length: PER_TRAY }, (_, k) => { const r = Math.floor(k / TRAY.cols), c = k % TRAY.cols; return r * TRAY.cols + (r % 2 ? TRAY.cols - 1 - c : c); });

export interface ReworkParams {
  /** Seconds to scan one package with the laser profiler. */
  scanS: number;
  tol: Tolerances;
  /** Target packages per hour (OEE performance). */
  target: number;
  /** Poor reballing batch: many more defects. */
  bad: boolean;
}
export const DEFAULT_REWORK: ReworkParams = { scanS: 0.8, tol: { ...DEFAULT_TOL }, target: 3000, bad: false };

export interface ReworkStats {
  t: number; ics: number; ok: number; rejected: number; trays: number;
  byClass: Record<IcDefect, number>; exchangeT: number; sortT: number; scanT: number;
}
const newStats = (): ReworkStats => ({ t: 0, ics: 0, ok: 0, rejected: 0, trays: 0, byClass: { ausente: 0, ponte: 0, deformada: 0, desalinhamento: 0, coplanaridade: 0 }, exchangeT: 0, sortT: 0, scanT: 0 });
export const icsPerHour = (s: ReworkStats) => (s.t > 120 && s.ics >= 20 ? (s.ics / s.t) * 3600 : null);

/** BGA package seen from the ball side (texture shared by every package). */
function bgaTexture() {
  const [c, g] = mk(96, 128);
  g.fillStyle = '#9aa3ad'; g.fillRect(0, 0, 96, 128);
  g.fillStyle = '#f3f5f7';
  const s = 96 / PKG.w;
  for (let r = 0; r < PKG.rows; r++) for (const x of PKG.cols) { g.beginPath(); g.arc(48 + x * s, 64 + (r - 6) * PKG.pitch * s, 0.25 * s, 0, Math.PI * 2); g.fill(); }
  return canvasTex(c);
}
function trayTexture() {
  const [c, g] = mk(512, 216);
  g.fillStyle = '#16181c'; g.fillRect(0, 0, 512, 216);
  g.fillStyle = '#0c0d10';
  for (let i = 0; i < PER_TRAY; i++) { const p = pocket(i); g.fillRect(256 + (p.x - 0.006) * 1587, 108 + (p.z - 0.008) * 1589, 0.012 * 1587, 0.016 * 1589); }
  return canvasTex(c);
}

export function createReworkCell(scene: THREE.Scene, M: Materials, font: string) {
  const params: ReworkParams = { ...DEFAULT_REWORK, tol: { ...DEFAULT_TOL } };
  const trayMat = std(0xffffff, 0.1, 0.6, { map: trayTexture() }), trayPlain = std(0x16181c, 0.1, 0.6);

  // ---------- machine: base, granite, enclosure, stackers, shuttle rails ----------
  scene.add(at(box(2.3, 0.86, 1.1, M.cabinet), 0, 0.43, 0));
  scene.add(at(box(2.3, 0.04, 1.1, std(0x2b2f36, 0.1, 0.35)), 0, 0.88, 0));
  scene.add(at(box(1.0, 0.04, 0.9, std(0x3a3f47, 0.1, 0.3)), 0, 0.92, 0));
  for (const z of [-0.06, 0.06]) scene.add(at(box(2.0, 0.012, 0.02, M.alu), 0, TABLE - 0.006, z));
  const glass = new THREE.MeshStandardMaterial({ color: 0xbcd6ea, transparent: true, opacity: 0.13, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
  for (const x of [-0.55, 0.55]) for (const z of [-0.5, 0.5]) scene.add(at(box(0.04, 0.85, 0.04, M.alu), x, 0.9 + 0.425, z));
  for (const z of [-0.5, 0.5]) scene.add(at(box(1.14, 0.04, 0.04, M.alu), 0, 1.75, z));
  for (const x of [-0.55, 0.55]) scene.add(at(box(0.04, 0.04, 1.04, M.alu), x, 1.75, 0));
  const pane = (w: number, h: number, x: number, y: number, z: number, ry: number) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glass); p.position.set(x, y, z); p.rotation.y = ry; p.userData.noShadow = true; scene.add(p); };
  pane(1.1, 0.8, 0, 1.33, -0.5, 0); pane(1.1, 0.45, 0, 1.5, 0.5, 0);
  // input and output stackers
  const stackerFrame = (x: number) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) scene.add(at(box(0.02, 0.5, 0.02, M.alu), x + sx * 0.18, TABLE + 0.25, sz * 0.09));
    scene.add(at(box(0.4, 0.02, 0.22, M.aluDark), x, TABLE + 0.5, 0));
  };
  stackerFrame(X_IN); stackerFrame(X_OUT);
  const inStack = new THREE.Mesh(new THREE.BoxGeometry(TRAY.l, 1, TRAY.w), trayPlain);
  const outStack = new THREE.Mesh(new THREE.BoxGeometry(TRAY.l, 1, TRAY.w), trayPlain);
  scene.add(inStack, outStack);
  const setStack = (m: THREE.Mesh, x: number, n: number) => { m.visible = n > 0; m.scale.y = Math.max(1e-3, n * TRAY.h); m.position.set(x, TABLE + 0.08 + (n * TRAY.h) / 2, 0); };
  // reject tray drawer (front right)
  scene.add(at(box(0.36, 0.02, 0.18, M.aluDark), REJ.x, TABLE + 0.01, REJ.z));
  scene.add(at(new THREE.Mesh(new THREE.BoxGeometry(TRAY.l, TRAY.h, TRAY.w), [trayPlain, trayPlain, trayMat, trayPlain, trayPlain, trayPlain]), REJ.x, TABLE + 0.02 + TRAY.h / 2, REJ.z));
  scene.add(at(box(0.36, 0.03, 0.01, std(0xd23b3b, 0.1, 0.5)), REJ.x, TABLE + 0.02, REJ.z + 0.095));

  // ---------- gantry: X bridge on two rails, Z carriage with the laser profiler and the pick nozzle ----------
  for (const z of [-0.36, 0.36]) {
    for (const x of [-0.5, 0.5]) scene.add(at(box(0.05, 0.36, 0.05, M.aluDark), x, TABLE + 0.18, z));
    scene.add(at(box(1.05, 0.05, 0.06, M.alu), 0, TABLE + 0.38, z));
  }
  const bridge = new THREE.Group();
  scene.add(bridge);
  bridge.add(at(box(0.07, 0.06, 0.8, M.aluDark), 0, TABLE + 0.43, 0));
  const carriage = new THREE.Group();
  bridge.add(carriage);
  carriage.add(at(box(0.12, 0.1, 0.1, M.alu), 0, TABLE + 0.43, 0));
  carriage.add(at(box(0.07, 0.12, 0.09, std(0x1b1d22, 0.3, 0.4)), 0, HEAD_Y + 0.03, 0));
  carriage.add(at(box(0.02, 0.02, 0.02, std(0xd23b3b, 0.2, 0.3, { emissive: new THREE.Color(0xff2020), emissiveIntensity: 1.2 })), 0, HEAD_Y - 0.035, 0));
  const nozzle = new THREE.Group();
  carriage.add(nozzle);
  nozzle.add(at(cyl(0.006, 0.006, 0.14, M.alu, 10), 0, HEAD_Y - 0.02, 0.05));
  nozzle.add(at(cyl(0.004, 0.006, 0.01, M.rubber, 10), 0, HEAD_Y - 0.095, 0.05));
  const laserMat = new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
  const fan = new THREE.Mesh(new THREE.PlaneGeometry(0.014, HEAD_Y - TABLE - 0.06), laserMat);
  fan.userData.noShadow = true;
  carriage.add(fan);
  const lineOnIc = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.0008), new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false }));
  lineOnIc.rotation.x = -Math.PI / 2;
  lineOnIc.userData.noShadow = true;
  scene.add(lineOnIc);
  shadowify(bridge);

  // ---------- HMI and andon ----------
  const [hc, hg] = mk(640, 400);
  const hTex = canvasTex(hc);
  const hmi = new THREE.Group();
  hmi.position.set(-0.95, 0, 0.75);
  hmi.rotation.y = 0.45;
  scene.add(hmi);
  hmi.add(at(box(0.06, 1.3, 0.06, M.alu), 0, 0.65, 0));
  hmi.add(at(box(0.62, 0.42, 0.05, M.black), 0, 1.45, 0.04));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.37), new THREE.MeshBasicMaterial({ map: hTex, toneMapped: false }));
  scr.position.set(0, 1.45, 0.07);
  hmi.add(scr);
  shadowify(hmi);
  const andons = createAndons(M);
  const andon = andons.make(scene, 0.5, 1.77, -0.45);

  // ---------- trays and packages ----------
  const bga = bgaTexture();
  const icGeo = new THREE.BoxGeometry(0.009, 0.0012, 0.013);
  const icMat = std(0xffffff, 0.2, 0.5, { map: bga });
  const tray = new THREE.Group();
  scene.add(tray);
  tray.add(at(new THREE.Mesh(new THREE.BoxGeometry(TRAY.l, TRAY.h, TRAY.w), [trayPlain, trayPlain, trayMat, trayPlain, trayPlain, trayPlain]), 0, TRAY.h / 2, 0));
  const ics = new THREE.InstancedMesh(icGeo, icMat, PER_TRAY);
  ics.castShadow = true;
  tray.add(ics);
  const rejIcs = new THREE.InstancedMesh(icGeo, icMat, PER_TRAY);
  rejIcs.count = 0;
  scene.add(rejIcs);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  const PENDING = 0x8a929c, OK = 0x22e07a, NG = 0xff3b3b;
  for (let i = 0; i < PER_TRAY; i++) { ics.setColorAt(i, col.set(PENDING)); rejIcs.setColorAt(i, col.set(NG)); }
  const placeIc = (i: number, show: boolean) => { const p = pocket(i); m4.makeTranslation(p.x, TRAY.h + 0.0006, p.z); if (!show) m4.makeScale(0, 0, 0); ics.setMatrixAt(i, m4); ics.instanceMatrix.needsUpdate = true; };
  const carried = new THREE.Mesh(icGeo, std(NG, 0.2, 0.5, { map: bga }));
  carried.visible = false;
  scene.add(carried);

  // ---------- state ----------
  type Phase = 'load' | 'scan' | 'sort' | 'unload';
  const st = {
    phase: 'load' as Phase, t: 0, trayNo: 1, k: 0, results: [] as (IcResult | null)[], current: null as IcResult | null, currentIdx: -1, prog: 0,
    rejects: [] as number[], rejCount: 0, inN: 10, outN: 0, head: { x: 0, z: 0 }, from: { x: 0, z: 0 }, to: { x: 0, z: 0 }, moveT: 0, sortStep: 0, last: null as IcResult | null,
  };
  let stats = newStats();
  const headWorld = (i: number) => { const p = pocket(i); return { x: tray.position.x + p.x, z: tray.position.z + p.z }; };

  function startTray() {
    st.phase = 'load'; st.t = 0; st.k = 0; st.results = Array(PER_TRAY).fill(null); st.rejects = [];
    for (let i = 0; i < PER_TRAY; i++) { placeIc(i, true); ics.setColorAt(i, col.set(PENDING)); }
    ics.instanceColor!.needsUpdate = true;
    st.inN = Math.max(0, st.inN - 1);
    if (st.inN === 0) st.inN = 10; // operator refills the input stacker
  }

  function drawHmi() {
    const g = hg;
    g.fillStyle = '#0a1520'; g.fillRect(0, 0, 640, 400);
    g.fillStyle = '#0b3a6b'; g.fillRect(0, 0, 640, 52);
    g.fillStyle = '#fff'; g.font = `600 27px ${font}`; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillText('INSPEÇÃO 3D · ICs RETRABALHADOS', 18, 27);
    const ic = st.phase === 'scan' ? st.current : st.last;
    g.save(); g.translate(20, 64);
    const [c2, g2] = mk(240, 320);
    drawIc(g2, 240, 320, ic, st.phase === 'scan' ? st.prog : 1);
    g.drawImage(c2, 0, 0);
    g.restore();
    g.font = `500 22px ${font}`; g.fillStyle = '#a9bdd3';
    g.fillText(`Bandeja ${st.trayNo} · IC ${Math.min(PER_TRAY, st.k + (st.phase === 'scan' ? 1 : 0))}/${PER_TRAY}`, 285, 82);
    if (ic) {
      g.fillStyle = '#fff';
      g.fillText(`Coplanaridade: ${(ic.coplanarity * 1000).toFixed(0)} µm`, 285, 122);
      g.fillText(`Diâmetro: ${(ic.dMin * 1000).toFixed(0)}–${(ic.dMax * 1000).toFixed(0)} µm`, 285, 156);
      g.fillText(`Posição máx.: ${(ic.offMax * 1000).toFixed(0)} µm`, 285, 190);
      g.fillText(`Ausentes: ${ic.missing} · Pontes: ${ic.bridges}`, 285, 224);
      const scanning = st.phase === 'scan' && st.prog < 1;
      g.font = `700 30px ${font}`;
      g.fillStyle = scanning ? '#7dd3fc' : ic.ok ? '#22c55e' : '#ef4444';
      g.fillText(scanning ? 'Medindo…' : ic.ok ? 'APROVADO' : 'REPROVADO', 285, 276);
      if (!scanning && !ic.ok) { g.font = `500 20px ${font}`; g.fillStyle = '#fca5a5'; g.fillText(ic.defects.map(d => DEFECTS.find(x => x.id === d)!.name).join(' · '), 285, 312); }
    }
    g.font = `600 22px ${font}`; g.fillStyle = '#fff';
    g.fillText(`OK ${stats.ok}   Reprovados ${stats.rejected}`, 20, 384);
    hTex.needsUpdate = true;
  }

  function moveHead(to: { x: number; z: number }, dur: number, dt: number) {
    if (st.moveT === 0) { st.from = { ...st.head }; st.to = to; }
    st.moveT += dt;
    const u = Math.min(1, st.moveT / dur), e = ease(u);
    st.head = { x: st.from.x + (st.to.x - st.from.x) * e, z: st.from.z + (st.to.z - st.from.z) * e };
    if (u >= 1) { st.moveT = 0; return true; }
    return false;
  }

  function step(dt: number) {
    stats.t += dt;
    st.t += dt;
    let laser = false;
    if (st.phase === 'load') {
      stats.exchangeT += dt;
      const u = Math.min(1, st.t / 2.5);
      tray.position.set(X_IN + (X_SCAN - X_IN) * ease(u), TABLE, 0);
      if (u >= 1) { st.phase = 'scan'; st.t = 0; st.k = 0; st.moveT = 0; st.current = null; }
    } else if (st.phase === 'scan') {
      stats.scanT += dt;
      const i = ORDER[st.k];
      if (!st.current) {
        if (moveHead(headWorld(i), 0.15, dt)) {
          st.current = measureIc(st.trayNo * 1000 + i, { bad: params.bad, tol: params.tol });
          st.currentIdx = i; st.prog = 0;
        }
      } else {
        st.prog = Math.min(1, st.prog + dt / params.scanS);
        laser = true;
        if (st.prog >= 1) {
          const r = st.current;
          st.results[i] = r;
          stats.ics++;
          if (r.ok) stats.ok++; else { stats.rejected++; st.rejects.push(i); r.defects.forEach(d => stats.byClass[d]++); andon.state = 'alarm'; alarmT = 0.8; }
          ics.setColorAt(i, col.set(r.ok ? OK : NG));
          ics.instanceColor!.needsUpdate = true;
          st.last = r; st.current = null; st.k++;
          drawHmi();
          if (st.k >= PER_TRAY) { st.phase = st.rejects.length ? 'sort' : 'unload'; st.t = 0; st.sortStep = 0; st.moveT = 0; }
        } else if (Math.floor(st.prog * 6) !== Math.floor((st.prog - dt / params.scanS) * 6)) drawHmi();
      }
    } else if (st.phase === 'sort') {
      // pick each rejected package with the nozzle and place it in the reject tray
      stats.sortT += dt;
      const i = st.rejects[0];
      const slot = st.rejCount % PER_TRAY, rp = pocket(slot);
      // the nozzle sits 5 cm ahead of the laser head on the carriage
      const over = st.sortStep < 3 ? headWorld(i) : { x: REJ.x + rp.x, z: REJ.z + rp.z }, target = { x: over.x, z: over.z - 0.05 };
      const stepDur = [0.3, 0.25, 0.25, 0.45, 0.25, 0.25][st.sortStep];
      const moving = st.sortStep === 0 || st.sortStep === 3;
      const done = moving ? moveHead(target, stepDur, dt) : (st.moveT += dt) >= stepDur && ((st.moveT = 0), true);
      const down = st.sortStep === 1 || st.sortStep === 4;
      nozzle.position.y = down ? -0.05 * Math.sin(Math.min(1, st.moveT / stepDur) * Math.PI) : 0;
      if (done) {
        if (st.sortStep === 1) { placeIc(i, false); carried.visible = true; }
        if (st.sortStep === 4) {
          carried.visible = false;
          m4.makeTranslation(REJ.x + rp.x, TABLE + 0.02 + TRAY.h + 0.0006, REJ.z + rp.z);
          rejIcs.setMatrixAt(slot, m4); rejIcs.count = Math.min(PER_TRAY, Math.max(rejIcs.count, slot + 1)); rejIcs.instanceMatrix.needsUpdate = true;
          st.rejCount++;
        }
        st.sortStep++;
        if (st.sortStep >= 6) { st.rejects.shift(); st.sortStep = 0; if (!st.rejects.length) { st.phase = 'unload'; st.t = 0; } }
      }
    } else if (st.phase === 'unload') {
      stats.exchangeT += dt;
      const u = Math.min(1, st.t / 2.5);
      tray.position.set(X_SCAN + (X_OUT - X_SCAN) * ease(u), TABLE, 0);
      if (u >= 1) {
        stats.trays++; st.outN++;
        if (st.outN > 10) st.outN = 1; // operator empties the output stacker
        st.trayNo++;
        startTray();
      }
    }
    // gantry follows the head; laser fan and the line on the package while measuring
    bridge.position.x = st.head.x;
    carriage.position.z = st.head.z;
    fan.visible = laser;
    lineOnIc.visible = laser;
    if (laser) {
      const p = pocket(st.currentIdx);
      fan.position.set(0, (HEAD_Y - 0.035 + TABLE + 0.01) / 2, 0.0065 * (2 * st.prog - 1));
      lineOnIc.position.set(tray.position.x + p.x, TABLE + TRAY.h + 0.0013, tray.position.z + p.z - 0.0065 + 0.013 * st.prog);
    }
    if (carried.visible) carried.position.set(st.head.x, HEAD_Y - 0.1 + nozzle.position.y, st.head.z + 0.05);
    setStack(inStack, X_IN, st.inN);
    setStack(outStack, X_OUT, st.outN);
    alarmT = Math.max(0, alarmT - dt);
    andon.state = alarmT > 0 ? 'alarm' : st.phase === 'scan' || st.phase === 'sort' ? 'run' : 'wait';
  }
  let alarmT = 0;

  startTray();
  st.inN = 10;
  tray.position.set(X_IN, TABLE, 0);
  drawHmi();
  return {
    params, andons, step, state: st, results: () => st.results,
    get stats() { return stats; },
    resetStats() { stats = newStats(); },
    drawHmi,
  };
}

export type ReworkCell = ReturnType<typeof createReworkCell>;
