// AI visual inspection cell: a UR10e with a camera scans each jig on the assembly belt before the transfers.
import * as THREE from 'three';
import { at, box, canvasTex, cylA, mk, shadowify, std } from '../../sim/kit';
import { station } from '../../sim/line';
import { cameraHead } from '../../sim/robots/grippers';
import { LED, makeCobot, poseAt, solve, urTrack } from '../../sim/robots/ur-arm';
import { runSeq } from '../../sim/sequencer';
import { CELL, FONT, PICK_Y, SIZES, SLOT, Z_ASM } from './config';
import { commitJig, hasTV, tvCount } from './transfers';
import type { Hmi, Inspector, Jig, World } from './types';

/** Cell frame, glass walls, light bar, HMI cabinet and andon. Returns the HMI canvas and the andon. */
export function buildInspectionCell(w: World, floorLine: (x1: number, z1: number, x2: number, z2: number, wd?: number) => void) {
  const { scene, M } = w;
  const { w: cw, d, h, x: x0, z: z0 } = CELL;
  const fx1 = x0 - cw / 2 - 0.3, fx2 = x0 + cw / 2 + 0.3, fz1 = z0 - d / 2, fz2 = z0 + d / 2 + 0.3;
  floorLine(fx1, fz1, fx1, fz2, 0.12); floorLine(fx1, fz2, fx2, fz2, 0.12); floorLine(fx2, fz2, fx2, fz1, 0.12);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    scene.add(at(box(0.12, h, 0.12, M.alu), x0 + sx * cw / 2, h / 2, z0 + sz * d / 2));
    scene.add(at(box(0.24, 0.06, 0.24, M.dark), x0 + sx * cw / 2, 0.03, z0 + sz * d / 2));
  }
  scene.add(at(box(cw, 0.1, 0.1, M.alu), x0, h, z0 + d / 2));
  for (const sx of [-1, 1]) scene.add(at(box(0.1, 0.1, d, M.alu), x0 + sx * cw / 2, h, z0));
  for (const sx of [-1, 1]) scene.add(at(box(0.08, 0.08, d, M.alu), x0 + sx * cw / 2, 1.0, z0));
  scene.add(at(box(cw, 0.08, 0.08, M.alu), x0, 1.0, z0 + d / 2));
  const glass = new THREE.MeshStandardMaterial({ color: 0xbcd6ea, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(d, h - 0.2), glass);
    p.rotation.y = Math.PI / 2;
    at(p, x0 + sx * cw / 2, h / 2, z0);
    p.userData.noShadow = true;
    scene.add(p);
  }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(cw, h - 0.2), glass);
  at(back, x0, h / 2, z0 + d / 2);
  back.userData.noShadow = true;
  scene.add(back);
  scene.add(at(box(cw - 0.3, 0.06, 0.14, new THREE.MeshBasicMaterial({ color: 0xffffff })), x0, h - 0.08, z0 - d / 2 + 0.2)); // light bar
  // HMI cabinet
  const [c, g] = mk(512, 320);
  const tex = canvasTex(c);
  const hmi: Hmi = { c, g, tex, mat: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) };
  const cab = new THREE.Group();
  cab.position.set(x0 + 0.62, 0, z0 + 0.5);
  scene.add(cab);
  cab.add(at(box(1.05, 1.75, 0.6, M.cabinet), 0, 0.875, 0));
  cab.add(at(box(0.86, 0.58, 0.05, M.black), 0, 1.38, -0.31));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), hmi.mat);
  scr.rotation.y = Math.PI;
  at(scr, 0, 1.38, -0.34);
  cab.add(scr);
  cab.add(at(cylA(0.07, 0.06, M.red, 'z', 16), 0.3, 0.85, -0.33)); // e-stop
  cab.add(at(cylA(0.05, 0.04, std(0x22c55e, 0.1, 0.4, { emissive: 0x22c55e, emissiveIntensity: 0.6 }), 'z', 16), -0.3, 0.85, -0.32));
  shadowify(cab);
  return { hmi, cellTop: { x: x0 + cw / 2, y: h + 0.05, z: z0 - d / 2 } };
}

// ---------- HMI drawing ----------
function hmiFrame(g: CanvasRenderingContext2D, title: string) {
  g.fillStyle = '#0a1520'; g.fillRect(0, 0, 512, 320);
  g.fillStyle = '#0b3a6b'; g.fillRect(0, 0, 512, 48);
  g.fillStyle = '#ffffff'; g.font = `600 26px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(title, 18, 25);
}
function drawCheck(g: CanvasRenderingContext2D, cx: number, cy: number, ok: boolean) {
  g.fillStyle = ok ? '#16a34a' : '#dc2626'; g.beginPath(); g.arc(cx, cy, 52, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 12; g.lineCap = 'round'; g.beginPath();
  if (ok) { g.moveTo(cx - 24, cy + 2); g.lineTo(cx - 6, cy + 20); g.lineTo(cx + 26, cy - 18); }
  else { g.moveTo(cx - 20, cy - 20); g.lineTo(cx + 20, cy + 20); g.moveTo(cx + 20, cy - 20); g.lineTo(cx - 20, cy + 20); }
  g.stroke();
}
export function drawInsp(w: World, mode: 'idle' | 'scan' | 'ok' | 'ng', label: string | null, prog: number) {
  const g = w.hmi.g, stats = w.stats;
  hmiFrame(g, 'INSPEÇÃO VISUAL · IA');
  g.fillStyle = '#132232'; g.fillRect(20, 66, 290, 180); g.strokeStyle = '#3fb6ff'; g.lineWidth = 2; g.strokeRect(20, 66, 290, 180);
  if (label) { g.fillStyle = '#1e3346'; g.fillRect(48, 92, 234, 128); }
  if (mode === 'scan') { const x = 20 + 290 * prog; g.fillStyle = 'rgba(63,182,255,0.25)'; g.fillRect(20, 66, x - 20, 180); g.fillStyle = '#7dd3fc'; g.fillRect(x - 2, 66, 4, 180); }
  if (mode === 'ok' || mode === 'ng') {
    g.strokeStyle = mode === 'ok' ? '#22c55e' : '#ef4444'; g.lineWidth = 3;
    if (mode === 'ng') g.strokeRect(190, 120, 46, 36); else { g.strokeRect(62, 104, 50, 34); g.strokeRect(200, 160, 50, 40); }
    drawCheck(g, 410, 150, mode === 'ok');
  }
  g.fillStyle = '#a9bdd3'; g.font = `500 22px ${FONT}`; g.textAlign = 'center';
  g.fillText(mode === 'scan' ? 'Analisando…' : mode === 'idle' ? 'Aguardando peça' : mode === 'ok' ? 'Aprovada' : 'Reprovada', 410, mode === 'ok' || mode === 'ng' ? 228 : 150);
  g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.font = `600 24px ${FONT}`;
  g.fillText(label ? `TV ${label}` : '—', 20, 278);
  g.fillStyle = '#22c55e'; g.fillText(`OK ${stats.ok}`, 160, 278); g.fillStyle = '#ef4444'; g.fillText(`NG ${stats.ng}`, 260, 278);
  w.hmi.tex.needsUpdate = true;
}

const jigLabel = (it: Jig) => (it.tvs.length === 2 ? `${it.inch}” ×2` : `${it.inch}”`);

export function createInspector(w: World): Inspector {
  const arm = makeCobot(w.scene, w.M, { x: CELL.x - 0.2, z: Z_ASM + 0.92, L1: 0.6, L2: 0.57, ped: 1.1, pedW: 0.45 }); // shoulder ~1.28 m
  const lens = cameraHead(arm.mount, w.M);
  const coneGeo = new THREE.ConeGeometry(0.55, 1, 4, 1, true);
  coneGeo.translate(0, -0.5, 0);
  coneGeo.rotateY(Math.PI / 4);
  const beam = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  beam.userData.noShadow = true;
  beam.visible = false;
  w.scene.add(beam);
  const camH = 0.45, yW = PICK_Y + camH + 0.18; // camera 45 cm above the TV back · flange 18 cm above the lens
  const idle = poseAt(arm, CELL.x - 0.3, Z_ASM + 0.35, yW + 0.12);
  const a: Inspector = { arm, lens, beam, seq: [], pose: idle.slice(), idle, state: 'idle', job: null, yW, alarmT: 0, prog: 0, busyT: 0 };
  station(w.asm, w.asm.track.sAtX(0, CELL.x), it => hasTV(it) && !it.inspected, it => { a.job = it; });
  return a;
}

function startInspection(w: World, a: Inspector) {
  const it = a.job!, x = CELL.x, z = Z_ASM, P = (dx: number, dz: number) => poseAt(a.arm, x + dx, z + dz, a.yW);
  const wd = SIZES[it.inch][0], ex = it.tvs.length === 2 ? SLOT + wd / 2 - 0.35 : Math.max(0.1, wd / 2 - 0.25);
  a.state = 'scan';
  a.prog = 0;
  drawInsp(w, 'scan', jigLabel(it), 0);
  a.seq.length = 0;
  a.seq.push(
    { to: P(-ex, -0.12), dur: 0.35 }, { fn: () => { a.beam.visible = true; } },
    { to: P(ex, -0.12), dur: 0.45 }, { to: P(ex, 0.12), dur: 0.15 }, { to: P(-ex, 0.12), dur: 0.45 },
    { fn: () => {
      a.beam.visible = false;
      it.inspected = true;
      it.ng = w.params.simulateNG && Math.random() < 0.1;
      const nTV = tvCount(it);
      w.stats.inspTV += nTV;
      if (it.ng) { w.stats.ng++; w.stats.ngTV += nTV; a.alarmT = 1.6; it.ledMat.emissive.setHex(0xef4444); }
      else { w.stats.ok++; w.stats.okTV += nTV; it.ledMat.emissive.setHex(0x22c55e); commitJig(w, it); }
      drawInsp(w, it.ng ? 'ng' : 'ok', jigLabel(it), 1);
      it.hold = null; a.job = null; a.state = 'idle'; // free at once: the next jig is scanned straight from here
    } },
    { to: a.idle, dur: 0.6, ready: true },
  );
}

const tmpV = new THREE.Vector3();
export function updateInspector(w: World, dt: number) {
  const a = w.insp;
  if (a.state === 'idle' && a.job && a.seq.every(s => s.ready)) startInspection(w, a);
  runSeq(a, dt); solve(a.arm, a.pose); urTrack(a.arm, a.pose, 4);
  if (a.state === 'scan') a.busyT += dt;
  if (a.state === 'scan' && a.seq.length) { a.prog = Math.min(1, a.prog + dt / 1.85); if (Math.random() < 0.3) drawInsp(w, 'scan', jigLabel(a.job!), a.prog); }
  a.alarmT = Math.max(0, a.alarmT - dt);
  w.inspAndon.state = a.alarmT > 0 ? 'alarm' : a.state === 'scan' ? 'run' : 'wait';
  a.arm.ledMat.emissive.setHex(a.state === 'scan' ? LED.run : LED.wait);
  if (a.beam.visible) {
    a.arm.root.updateMatrixWorld(true);
    a.lens.getWorldPosition(tmpV);
    const hgt = Math.max(0.2, tmpV.y - PICK_Y);
    a.beam.position.copy(tmpV);
    a.beam.scale.set(1, hgt, 1);
  }
}

export function resetInspector(w: World) {
  const a = w.insp;
  Object.assign(a, { seq: [{ to: a.idle, dur: 0.6, ready: true }], state: 'idle', job: null, alarmT: 0 });
  a.beam.visible = false;
}
