// Project 01 · Adata Technology: microscope stations today and with the digital retrofit, side by side.
// REAL SCALE (metres). Both benches inspect the same lots (same samples and defects), so the comparison is fair.
//
// Today: stereo microscope with eyepieces; the inspector leans over the eyepieces, writes each defect on a paper
// form and later types the form into the system; no image is kept.
// Digital: the same microscope with a camera on the trinocular port and a monitor on an arm; the inspector sits
// upright, reads the lot barcode, captures the image with the foot pedal and picks the defect class on the
// screen; image, lot, sample, step and time go to the MES.
import * as THREE from 'three';
import { at, box, canvasTex, cyl, cylA, mk, shadowify, std } from '../../sim/kit';
import type { Materials } from '../../sim/materials';
import { DEFAULT_MICRO, DEFECT_CLASSES, drawMicroscope, lotDefects, type DefectId, type MicroParams, type Mode } from './model';

export interface Capture { seed: number; defect: DefectId; lot: number; sample: number; t: number }
export interface BenchStats {
  t: number; lots: number; samples: number; defects: number; images: number; recordT: number; inspectT: number;
  eyepieceT: number; traceable: number; traceableWithImage: number; byClass: Record<DefectId, number>;
}
const newStats = (): BenchStats => ({ t: 0, lots: 0, samples: 0, defects: 0, images: 0, recordT: 0, inspectT: 0, eyepieceT: 0, traceable: 0, traceableWithImage: 0, byClass: { trinca: 0, lasca: 0, particula: 0, risco: 0, mancha: 0 } });

type Phase = 'header' | 'scan' | 'inspect' | 'write' | 'capture' | 'close' | 'type' | 'autoclose';
export const PHASE_TEXT: Record<Phase, string> = {
  header: 'Preenchendo o cabeçalho da ficha', scan: 'Lendo o código do lote', inspect: 'Inspecionando a amostra',
  write: 'Anotando o defeito na ficha', capture: 'Capturando a imagem e marcando a classe', close: 'Assinando a ficha',
  type: 'Digitando a ficha no sistema', autoclose: 'Lote fechado no MES',
};

export function createStations(scene: THREE.Scene, M: Materials, font: string) {
  const params: MicroParams = { ...DEFAULT_MICRO };
  const shared = { problem: false };
  const suit = std(0xf4f6f8, 0.0, 0.7), visor = std(0x1d2733, 0.3, 0.2), glove = std(0x3b82f6, 0.1, 0.5);
  const mat = std(0x2457a6, 0.0, 0.7), black = std(0x1b1d22, 0.3, 0.4), metal = std(0xd5dae0, 0.5, 0.35);

  function bench(mode: Mode, x: number) {
    const g = new THREE.Group();
    g.position.set(x, 0, 0);
    scene.add(g);
    // table with ESD mat, legs, PC
    g.add(at(box(1.6, 0.04, 0.75, M.cabinet), 0, 0.88, 0));
    g.add(at(box(1.5, 0.006, 0.66, mat), 0, 0.903, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(box(0.05, 0.86, 0.05, M.alu), sx * 0.75, 0.43, sz * 0.33));
    if (mode === 'digital') g.add(at(box(0.2, 0.42, 0.42, black), 0.6, 0.21, -0.1));
    // microscope: base, pillar, head, objective, ring light, eyepieces toward the inspector (+z)
    const scope = new THREE.Group();
    scope.position.set(0, 0.906, -0.08);
    g.add(scope);
    scope.add(at(box(0.3, 0.03, 0.34, metal), 0, 0.015, 0));
    scope.add(at(cyl(0.025, 0.025, 0.45, metal, 14), 0, 0.25, -0.13));
    scope.add(at(box(0.12, 0.08, 0.18, std(0xeef0f2, 0.2, 0.4)), 0, 0.36, -0.04));
    scope.add(at(cyl(0.035, 0.03, 0.07, black, 18), 0, 0.29, 0.0));
    const ringLight = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 8, 28), new THREE.MeshBasicMaterial({ color: 0xeaf6ff, toneMapped: false }));
    ringLight.rotation.x = Math.PI / 2;
    ringLight.position.set(0, 0.25, 0);
    scope.add(ringLight);
    for (const sx of [-1, 1]) {
      const ep = cylA(0.014, 0.12, black, 'z', 12);
      ep.position.set(sx * 0.03, 0.43, 0.08);
      ep.rotation.x = Math.PI / 2 - 0.75;
      scope.add(ep);
    }
    scope.add(at(box(0.18, 0.012, 0.14, metal), 0, 0.05, 0.02)); // XY stage
    if (mode === 'digital') {
      scope.add(at(cyl(0.02, 0.02, 0.06, black, 14), 0, 0.43, -0.06));
      scope.add(at(box(0.07, 0.06, 0.07, std(0x2b3036, 0.3, 0.4)), 0, 0.49, -0.06));
      scope.add(at(box(0.012, 0.012, 0.3, black), 0.03, 0.47, -0.22));
    }
    // sample trays: to inspect (left), inspected (right)
    g.add(at(box(0.2, 0.012, 0.14, black), -0.42, 0.912, 0.02));
    g.add(at(box(0.2, 0.012, 0.14, black), 0.38, 0.912, 0.02));
    const samples = new THREE.InstancedMesh(new THREE.BoxGeometry(0.018, 0.004, 0.024), std(0xffffff, 0.2, 0.5), 40);
    g.add(samples);
    const col = new THREE.Color();
    for (let i = 0; i < 40; i++) samples.setColorAt(i, col.set(0x8a929c));
    // operator on a stool
    const op = new THREE.Group();
    op.position.set(0, 0, 0.62);
    g.add(op);
    op.add(at(cyl(0.2, 0.2, 0.05, black, 20), 0, 0.6, 0));
    op.add(at(cyl(0.03, 0.03, 0.58, metal, 10), 0, 0.3, 0));
    op.add(at(cyl(0.22, 0.24, 0.03, black, 20), 0, 0.02, 0));
    for (const sx of [-1, 1]) {
      op.add(at(box(0.1, 0.1, 0.42, suit), sx * 0.09, 0.66, -0.17)); // thighs
      op.add(at(box(0.09, 0.5, 0.1, suit), sx * 0.09, 0.4, -0.38)); // shins
    }
    const torso = new THREE.Group();
    torso.position.set(0, 0.66, 0.02);
    op.add(torso);
    torso.add(at(cyl(0.17, 0.15, 0.52, suit, 16), 0, 0.27, 0));
    const head = new THREE.Group();
    head.position.set(0, 0.62, 0);
    torso.add(head);
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), suit));
    head.add(at(box(0.15, 0.06, 0.04, visor), 0, 0.0, -0.1));
    for (const sx of [-1, 1]) {
      const arm = cylA(0.04, 0.42, suit, 'z', 10);
      arm.position.set(sx * 0.2, 0.42, -0.2);
      arm.rotation.x = Math.PI / 2 + 0.35;
      torso.add(arm);
      torso.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), glove), sx * 0.2, 0.3, -0.4));
    }
    shadowify(g);
    // paper form (today) or monitor (digital)
    let paper: { g: CanvasRenderingContext2D; tex: THREE.CanvasTexture } | null = null;
    let screen: { g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; c: HTMLCanvasElement } | null = null;
    let pedalMat: THREE.MeshStandardMaterial | null = null;
    if (mode === 'hoje') {
      const [c, pg] = mk(256, 340);
      const tex = canvasTex(c);
      g.add(at(box(0.24, 0.008, 0.32, std(0x8b6b45, 0.0, 0.8)), 0.42, 0.91, 0.22));
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.28), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
      sheet.rotation.x = -Math.PI / 2;
      sheet.position.set(0.42, 0.916, 0.23);
      sheet.userData.noShadow = true;
      g.add(sheet);
      g.add(at(cylA(0.004, 0.14, std(0x1f5fd6, 0.2, 0.4), 'x', 8), 0.47, 0.92, 0.3));
      paper = { g: pg, tex };
    } else {
      const [c, sg] = mk(640, 360);
      const tex = canvasTex(c);
      g.add(at(box(0.04, 0.4, 0.04, M.aluDark), -0.42, 1.1, -0.28));
      g.add(at(box(0.66, 0.4, 0.04, black), -0.42, 1.38, -0.24));
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.35), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      scr.position.set(-0.42, 1.38, -0.218);
      g.add(scr);
      g.add(at(box(0.05, 0.14, 0.04, black), 0.45, 0.98, 0.18)); // barcode scanner
      pedalMat = std(0x2b3036, 0.3, 0.5, { emissive: new THREE.Color(0x22c55e), emissiveIntensity: 0 });
      g.add(at(box(0.12, 0.04, 0.2, pedalMat), 0.12, 0.02, 0.36));
      screen = { g: sg, tex, c };
    }

    // ---------- simulation ----------
    const st = {
      phase: (mode === 'hoje' ? 'header' : 'scan') as Phase, t: 0, lot: 1, k: 0, defects: [] as (DefectId | null)[], written: [] as string[],
      gallery: [] as Capture[], flash: 0, pan: 0.5,
    };
    let stats = newStats();
    const startLot = () => {
      st.defects = lotDefects(st.lot, params, shared.problem ? 3 : 1);
      st.k = 0; st.written = []; st.phase = mode === 'hoje' ? 'header' : 'scan'; st.t = 0;
      for (let i = 0; i < 40; i++) samples.setColorAt(i, col.set(0x8a929c));
      if (samples.instanceColor) samples.instanceColor.needsUpdate = true;
      drawPaper();
    };
    const dur = (ph: Phase) => ({
      header: params.headerS, scan: params.scanS, inspect: mode === 'hoje' ? params.inspectS : params.inspectDigitalS,
      write: params.writeS, capture: params.tagS, close: params.closeS, type: params.typeS, autoclose: params.autoCloseS,
    })[ph];
    const lotName = (n: number) => `L26-${String(4100 + n)}`;

    function drawPaper() {
      if (!paper) return;
      const g2 = paper.g;
      g2.fillStyle = '#fbfaf5'; g2.fillRect(0, 0, 256, 340);
      g2.fillStyle = '#222'; g2.font = `600 20px ${font}`;
      g2.fillText('FICHA DE INSPEÇÃO', 14, 30);
      g2.font = `500 16px ${font}`;
      if (st.phase !== 'header' || st.t > params.headerS * 0.5) g2.fillText(`Lote ${lotName(st.lot)}`, 14, 56);
      g2.strokeStyle = '#c9c4b5'; g2.lineWidth = 1;
      for (let y = 80; y < 330; y += 24) { g2.beginPath(); g2.moveTo(10, y); g2.lineTo(246, y); g2.stroke(); }
      g2.fillStyle = '#1f3a8a'; g2.font = `italic 500 16px ${font}`;
      st.written.forEach((w, i) => g2.fillText(w, 16, 76 + (i + 1) * 24));
      if (st.phase === 'close' || st.phase === 'type') { g2.fillStyle = '#1f3a8a'; g2.fillText('Assinado ✓', 150, 320); }
      paper.tex.needsUpdate = true;
    }
    function drawScreen() {
      if (!screen) return;
      const g2 = screen.g;
      const seed = st.lot * 100 + st.k, d = st.defects[st.k] ?? null;
      const showDefect = st.phase === 'capture' || (st.phase === 'inspect' && st.t > dur('inspect') * 0.6);
      const [c2, g3] = mk(440, 300);
      drawMicroscope(g3, 440, 300, seed, showDefect ? d : null, st.pan);
      g2.fillStyle = '#0a1520'; g2.fillRect(0, 0, 640, 360);
      g2.drawImage(c2, 10, 40);
      g2.strokeStyle = 'rgba(255,255,255,0.6)'; g2.lineWidth = 1;
      g2.beginPath(); g2.moveTo(230, 160); g2.lineTo(230, 220); g2.moveTo(200, 190); g2.lineTo(260, 190); g2.stroke();
      if (st.phase === 'capture' && d) { g2.strokeStyle = DEFECT_CLASSES.find(x => x.id === d)!.color; g2.lineWidth = 3; g2.strokeRect(150, 110, 170, 150); }
      if (st.flash > 0) { g2.fillStyle = `rgba(255,255,255,${Math.min(0.8, st.flash * 2)})`; g2.fillRect(10, 40, 440, 300); }
      g2.fillStyle = '#fff'; g2.font = `600 20px ${font}`; g2.textBaseline = 'middle';
      g2.fillText(`${lotName(st.lot)} · amostra ${Math.min(params.samples, st.k + 1)}/${params.samples}`, 12, 20);
      g2.fillStyle = '#22c55e'; g2.fillText('MES ●', 560, 20);
      st.gallery.slice(-3).reverse().forEach((cap, i) => {
        const [c4, g4] = mk(170, 116);
        drawMicroscope(g4, 170, 116, cap.seed, cap.defect, 0.5);
        g2.drawImage(c4, 460, 40 + i * 104, 170, 96);
        g2.fillStyle = DEFECT_CLASSES.find(x => x.id === cap.defect)!.color; g2.font = `600 14px ${font}`;
        g2.fillText(DEFECT_CLASSES.find(x => x.id === cap.defect)!.name, 466, 50 + i * 104);
      });
      screen.tex.needsUpdate = true;
    }

    let screenT = 0;
    function step(dt: number) {
      stats.t += dt;
      st.t += dt;
      st.flash = Math.max(0, st.flash - dt);
      if (st.phase === 'inspect') { stats.inspectT += dt; if (mode === 'hoje') stats.eyepieceT += dt; st.pan = 0.5 + 0.35 * Math.sin(stats.t * 0.7 + st.k); }
      else stats.recordT += dt;
      if (st.t >= dur(st.phase)) {
        st.t = 0;
        const d = st.defects[st.k];
        switch (st.phase) {
          case 'header': case 'scan': st.phase = 'inspect'; break;
          case 'inspect':
            stats.samples++;
            samples.setColorAt(st.k, col.set(d ? 0xff4d4d : 0x9be7b5)); samples.instanceColor!.needsUpdate = true;
            if (d) { stats.defects++; st.phase = mode === 'hoje' ? 'write' : 'capture'; if (mode === 'digital') st.flash = 0.35; }
            else nextSample();
            break;
          case 'write':
            st.written.push(`Amostra ${st.k + 1}: ${DEFECT_CLASSES.find(x => x.id === d)!.name.toLowerCase()}`);
            drawPaper(); nextSample(); break;
          case 'capture': {
            const cap: Capture = { seed: st.lot * 100 + st.k, defect: d!, lot: st.lot, sample: st.k + 1, t: stats.t };
            st.gallery.push(cap); if (st.gallery.length > 12) st.gallery.shift();
            stats.images++; stats.byClass[d!]++; stats.traceable++; stats.traceableWithImage++;
            nextSample(); break;
          }
          case 'close': st.phase = 'type'; drawPaper(); break;
          case 'type': stats.traceable += st.defects.filter(Boolean).length; stats.lots++; st.lot++; startLot(); break;
          case 'autoclose': stats.lots++; st.lot++; startLot(); break;
        }
      }
      if (st.phase === 'header' && st.t > params.headerS * 0.5 && st.t - dt <= params.headerS * 0.5) drawPaper();
      // samples: pending tray → stage → inspected tray
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < params.samples && i < 40; i++) {
        const r = Math.floor(i / 5), c = i % 5;
        let p: [number, number, number];
        if (i < st.k) p = [0.3 + c * 0.034, 0.92, -0.03 + r * 0.03];
        else if (i === st.k && st.phase !== 'header' && st.phase !== 'scan' && st.phase !== 'close' && st.phase !== 'type' && st.phase !== 'autoclose') p = [0, 0.97, -0.06];
        else p = [-0.5 + c * 0.034, 0.92, -0.03 + r * 0.03];
        m4.makeTranslation(...p);
        samples.setMatrixAt(i, m4);
      }
      samples.count = Math.min(40, params.samples);
      samples.instanceMatrix.needsUpdate = true;
      // posture: leaning over the eyepieces, writing on the form, or upright at the monitor
      const lean = mode === 'hoje' ? (st.phase === 'inspect' ? 0.42 : st.phase === 'write' || st.phase === 'header' || st.phase === 'close' || st.phase === 'type' ? 0.3 : 0.15) : 0.08;
      const yaw = mode === 'hoje' ? (st.phase === 'write' || st.phase === 'header' || st.phase === 'close' || st.phase === 'type' ? -0.55 : 0) : (st.phase === 'inspect' || st.phase === 'capture' ? 0.45 : st.phase === 'scan' ? -0.5 : 0.2);
      torso.rotation.x += (-lean - torso.rotation.x) * Math.min(1, dt * 4);
      head.rotation.y += (yaw - head.rotation.y) * Math.min(1, dt * 4);
      head.rotation.x += ((mode === 'hoje' && st.phase === 'inspect' ? -0.35 : 0) - head.rotation.x) * Math.min(1, dt * 4);
      if (pedalMat) pedalMat.emissiveIntensity = st.flash > 0 ? 1.5 : 0;
      if (screen && (screenT += dt) > 0.25) { screenT = 0; drawScreen(); }
    }
    function nextSample() { st.k++; if (st.k >= params.samples) { st.k = params.samples; st.phase = mode === 'hoje' ? 'close' : 'autoclose'; } else st.phase = 'inspect'; }

    startLot();
    drawScreen();
    return {
      mode, step, state: st,
      get stats() { return stats; },
      resetStats() { stats = newStats(); },
    };
  }

  const today = bench('hoje', -1.1), digital = bench('digital', 1.1);
  return {
    params, shared, today, digital,
    step(dt: number) { today.step(dt); digital.step(dt); },
    resetStats() { today.resetStats(); digital.resetStats(); },
  };
}

export type Stations = ReturnType<typeof createStations>;
