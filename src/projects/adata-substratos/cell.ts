// Project 02 · Adata Technology: intelligent inspection of BGA substrate strips. REAL SCALE (metres).
//
// Strips leave the input magazine (pusher), ride the rails through a tunnel with an RGB line camera (particles,
// residues, scratches on the metallisation) and a multispectral head (oxidation index, corrosion). Units out of
// limits are marked X-out in the strip map for the MES; strips with too many X-outs are shifted by the diverter
// into the NG magazine, the others go into the output magazine.
import * as THREE from 'three';
import { createAndons } from '../../sim/andon';
import { at, box, canvasTex, mk, shadowify, std } from '../../sim/kit';
import type { Materials } from '../../sim/materials';
import { DEFAULT_LIMITS, STRIP, UNITS, drawStrip, inspectStrip, type StripLimits, type StripResult } from './substrate';

const RAIL = 0.95, L = STRIP.l / 1000, Wd = STRIP.w / 1000;
const X_MAG_IN = -1.25, X_START = -0.98, X_RGB = -0.05, X_SPEC = 0.25, X_END = 0.92, X_MAG_OUT = 1.3, Z_NG = 0.2;
const SLOTS = 20, PITCH = 0.012;

export interface SubstrateParams {
  /** Belt speed under the cameras (m/s). */
  speed: number;
  limits: StripLimits;
  /** Target strips per hour (OEE performance). */
  target: number;
  /** A lot stored with humidity: high oxidation index. */
  oxidized: boolean;
}
export const DEFAULT_SUBSTRATE: SubstrateParams = { speed: 0.06, limits: { ...DEFAULT_LIMITS }, target: 600, oxidized: false };

export interface SubstrateStats { t: number; strips: number; ng: number; units: number; xouts: number; byClass: number[]; oxSum: number; magazines: number }
const newStats = (): SubstrateStats => ({ t: 0, strips: 0, ng: 0, units: 0, xouts: 0, byClass: [0, 0, 0, 0, 0, 0], oxSum: 0, magazines: 0 });
export const stripsPerHour = (s: SubstrateStats) => (s.t > 90 && s.strips >= 5 ? (s.strips / s.t) * 3600 : null);

interface Strip {
  obj: THREE.Mesh; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; seq: number;
  x: number; z: number; res: StripResult; phase: 'push' | 'ride' | 'shift' | 'enter'; rgb: number; spec: number; counted: boolean;
}

export function createSubstrateCell(scene: THREE.Scene, M: Materials, font: string) {
  const params: SubstrateParams = { ...DEFAULT_SUBSTRATE, limits: { ...DEFAULT_LIMITS } };
  const stripSide = std(0x1f5f3f, 0.1, 0.6);

  // ---------- base, rails, belts ----------
  scene.add(at(box(2.9, 0.86, 0.75, M.cabinet), 0.03, 0.43, 0.05));
  scene.add(at(box(2.9, 0.04, 0.75, std(0x2b2f36, 0.1, 0.35)), 0.03, 0.88, 0.05));
  for (const z of [-Wd / 2 - 0.004, Wd / 2 + 0.004]) scene.add(at(box(X_END - X_START + 0.1, 0.05, 0.008, M.alu), (X_START + X_END) / 2, RAIL - 0.02, z));
  for (const x of [-0.8, -0.3, 0.2, 0.7]) scene.add(at(box(0.04, RAIL - 0.9, 0.12, M.aluDark), x, 0.9 + (RAIL - 0.9) / 2 - 0.02, 0));
  // ---------- magazines on elevators ----------
  const magMat = std(0xb8bfc7, 0.6, 0.35);
  function magazine(x: number, z: number) {
    const g = new THREE.Group();
    g.position.set(x, 0.9, z);
    scene.add(g);
    g.add(at(box(0.08, 0.6, 0.08, M.aluDark), 0, 0.3, -0.12));
    const body = new THREE.Group();
    g.add(body);
    for (const s of [-1, 1]) body.add(at(box(L + 0.02, SLOTS * PITCH + 0.02, 0.004, magMat), 0, SLOTS * PITCH / 2, s * (Wd / 2 + 0.006)));
    body.add(at(box(L + 0.02, 0.006, Wd + 0.016, magMat), 0, 0, 0));
    body.add(at(box(L + 0.02, 0.006, Wd + 0.016, magMat), 0, SLOTS * PITCH + 0.01, 0));
    const fill = new THREE.InstancedMesh(new THREE.BoxGeometry(L, 0.0012, Wd), stripSide, SLOTS);
    body.add(fill);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < SLOTS; i++) { m4.makeTranslation(0, 0.01 + i * PITCH, 0); fill.setMatrixAt(i, m4); }
    shadowify(g);
    return { g, body, fill, set(n: number) { fill.count = Math.max(0, Math.min(SLOTS, n)); } };
  }
  const magIn = magazine(X_MAG_IN, 0), magOk = magazine(X_MAG_OUT, 0), magNg = magazine(X_MAG_OUT, Z_NG);
  scene.add(at(box(0.06, 0.04, 0.06, std(0xd23b3b, 0.1, 0.5)), X_MAG_OUT, 0.9 + SLOTS * PITCH + 0.06, Z_NG));
  const pusher = at(box(0.1, 0.012, 0.012, M.aluDark), X_MAG_IN - 0.18, RAIL + 0.005, 0);
  scene.add(pusher);
  // diverter shuttle
  const shuttle = new THREE.Group();
  shuttle.position.set(X_END + 0.13, RAIL - 0.025, 0);
  scene.add(shuttle);
  shuttle.add(at(box(0.27, 0.02, 0.1, M.aluDark), 0, 0, 0));
  scene.add(at(box(0.04, 0.04, 0.5, M.alu), X_END + 0.13, RAIL - 0.06, Z_NG / 2));

  // ---------- inspection tunnel: RGB line camera and multispectral head ----------
  const tunnel = new THREE.Group();
  scene.add(tunnel);
  const hood = std(0xe9ecef, 0.15, 0.45);
  tunnel.add(at(box(0.8, 0.02, 0.36, hood), 0.1, RAIL + 0.42, 0));
  tunnel.add(at(box(0.8, 0.42, 0.02, hood), 0.1, RAIL + 0.21, -0.18));
  tunnel.add(at(box(0.8, 0.3, 0.01, new THREE.MeshStandardMaterial({ color: 0x334b5e, transparent: true, opacity: 0.35, depthWrite: false })), 0.1, RAIL + 0.27, 0.18));
  tunnel.add(at(box(0.8, 0.04, 0.02, std(0x8e5bb5, 0.2, 0.45)), 0.1, RAIL + 0.44, 0.181));
  const head = (x: number, color: number) => {
    tunnel.add(at(box(0.08, 0.14, 0.08, std(0x1b1d22, 0.3, 0.4)), x, RAIL + 0.32, 0));
    tunnel.add(at(box(0.05, 0.03, 0.05, std(0x2b3036, 0.4, 0.3)), x, RAIL + 0.235, 0));
    tunnel.add(at(box(0.02, 0.02, 0.2, new THREE.MeshBasicMaterial({ color, toneMapped: false })), x - 0.05, RAIL + 0.15, 0));
    tunnel.add(at(box(0.02, 0.02, 0.2, new THREE.MeshBasicMaterial({ color, toneMapped: false })), x + 0.05, RAIL + 0.15, 0));
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(0.004, Wd + 0.01), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    beam.rotation.x = -Math.PI / 2;
    beam.position.set(x, RAIL + 0.0025, 0);
    beam.userData.noShadow = true;
    tunnel.add(beam);
    return beam;
  };
  const rgbBeam = head(X_RGB, 0x7dd3fc), specBeam = head(X_SPEC, 0xc084fc);
  shadowify(tunnel);

  // ---------- HMI and andon ----------
  const [hc, hg] = mk(640, 400);
  const hTex = canvasTex(hc);
  const hmi = new THREE.Group();
  hmi.position.set(-0.75, 0, -0.55);
  hmi.rotation.y = 0.2;
  scene.add(hmi);
  hmi.add(at(box(0.06, 1.6, 0.06, M.alu), 0, 0.8, 0));
  hmi.add(at(box(0.62, 0.42, 0.05, M.black), 0, 1.72, 0.04));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.37), new THREE.MeshBasicMaterial({ map: hTex, toneMapped: false }));
  scr.position.set(0, 1.72, 0.07);
  hmi.add(scr);
  shadowify(hmi);
  const andons = createAndons(M);
  const andon = andons.make(scene, 1.45, 0.9, -0.28);

  // ---------- strips ----------
  const strips: Strip[] = [];
  let seq = 0, pushT = 0;
  const st = { inN: SLOTS, okN: 0, ngN: 0, last: null as Strip | null, current: null as Strip | null, alarmT: 0 };
  let stats = newStats();
  function newStrip(): Strip {
    const [c, g] = mk(480, 148);
    const tex = canvasTex(c);
    const res = inspectStrip(++seq, { oxidized: params.oxidized, limits: params.limits });
    drawStrip(g, 480, 148, res, 0, 'rgb');
    tex.needsUpdate = true;
    const top = std(0xffffff, 0.15, 0.5, { map: tex });
    const obj = new THREE.Mesh(new THREE.BoxGeometry(L, 0.0012, Wd), [stripSide, stripSide, top, stripSide, stripSide, stripSide]);
    obj.castShadow = true;
    scene.add(obj);
    return { obj, g, tex, seq, x: X_MAG_IN, z: 0, res, phase: 'push', rgb: 0, spec: 0, counted: false };
  }
  const remove = (s: Strip) => { scene.remove(s.obj); s.tex.dispose(); (s.obj.material as THREE.Material[])[2].dispose(); s.obj.geometry.dispose(); strips.splice(strips.indexOf(s), 1); };

  function drawHmi() {
    const g = hg, s = st.current ?? st.last;
    g.fillStyle = '#0a1520'; g.fillRect(0, 0, 640, 400);
    g.fillStyle = '#0b3a6b'; g.fillRect(0, 0, 640, 52);
    g.fillStyle = '#fff'; g.font = `600 27px ${font}`; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillText('INSPEÇÃO DE SUBSTRATOS · RGB + ESPECTRAL', 18, 27);
    if (s) {
      const [c1, g1] = mk(600, 185), [c2, g2] = mk(600, 185);
      drawStrip(g1, 600, 185, s.res, s.rgb, 'rgb');
      drawStrip(g2, 600, 185, s.res, s.spec, 'spec');
      g.drawImage(c1, 20, 62, 380, 117); g.drawImage(c2, 20, 192, 380, 117);
      g.font = `500 20px ${font}`; g.fillStyle = '#a9bdd3';
      g.fillText('RGB', 410, 120); g.fillText('Espectral (oxidação)', 410, 250);
      g.font = `600 24px ${font}`; g.fillStyle = '#fff';
      g.fillText(`Tira ${s.seq} · X-out ${s.res.xouts}/${UNITS}`, 20, 340);
      g.fillStyle = s.spec < 1 ? '#7dd3fc' : s.res.ng ? '#ef4444' : '#22c55e';
      g.font = `700 28px ${font}`;
      g.fillText(s.spec < 1 ? 'Inspecionando…' : s.res.ng ? 'TIRA NG' : 'TIRA OK', 410, 340);
    }
    g.font = `500 20px ${font}`; g.fillStyle = '#a9bdd3';
    g.fillText(`Tiras ${stats.strips} · NG ${stats.ng} · mapa X-out enviado ao MES`, 20, 382);
    hTex.needsUpdate = true;
  }

  // ---------- step ----------
  let hmiT = 0;
  function step(dt: number) {
    stats.t += dt;
    // push a new strip when the rails are free behind the last one
    pushT -= dt;
    const lastOnRails = strips.filter(s => s.phase === 'push' || s.phase === 'ride').reduce((m, s) => Math.min(m, s.x), Infinity);
    if (pushT <= 0 && lastOnRails - L / 2 > X_START + L / 2 + 0.05) {
      strips.push(newStrip());
      st.inN--;
      if (st.inN <= 0) st.inN = SLOTS; // operator loads a full magazine
      pushT = 0.8;
    }
    let pushing: Strip | null = null;
    for (const s of strips.slice()) {
      if (s.phase === 'push') {
        pushing = s;
        s.x += 0.2 * dt;
        if (s.x >= X_START) { s.x = X_START; s.phase = 'ride'; }
      } else if (s.phase === 'ride') {
        s.x += params.speed * dt;
        const front = s.x + L / 2;
        const r0 = s.rgb, p0 = s.spec;
        s.rgb = Math.max(0, Math.min(1, (front - X_RGB) / L));
        s.spec = Math.max(0, Math.min(1, (front - X_SPEC) / L));
        if (s.rgb > 0 && s.rgb < 1) st.current = s;
        if (Math.floor(s.rgb * 12) !== Math.floor(r0 * 12)) { drawStrip(s.g, 480, 148, s.res, s.rgb, 'rgb'); s.tex.needsUpdate = true; }
        if (s.spec >= 1 && p0 < 1 && !s.counted) {
          s.counted = true;
          stats.strips++; stats.units += UNITS; stats.xouts += s.res.xouts; stats.oxSum += s.res.oxMean;
          s.res.counts.forEach((n, i) => (stats.byClass[i] += n));
          if (s.res.ng) { stats.ng++; st.alarmT = 1.2; }
          st.last = s; if (st.current === s) st.current = null;
          drawHmi();
        }
        if (s.x >= X_END + L / 2 - 0.15) { s.x = X_END + L / 2 - 0.15; s.phase = s.res.ng ? 'shift' : 'enter'; }
      } else if (s.phase === 'shift') {
        s.z = Math.min(Z_NG, s.z + 0.25 * dt);
        shuttle.position.z = s.z;
        if (s.z >= Z_NG) s.phase = 'enter';
      } else if (s.phase === 'enter') {
        s.x += 0.25 * dt;
        if (s.x >= X_MAG_OUT) {
          if (s.res.ng) { st.ngN++; if (st.ngN > SLOTS) st.ngN = 1; } else { st.okN++; if (st.okN >= SLOTS) { st.okN = 0; stats.magazines++; } }
          remove(s);
          continue;
        }
      }
      const y = s.phase === 'enter' ? RAIL + 0.012 : RAIL + 0.0006;
      s.obj.position.set(s.x, y, s.z);
    }
    if (!strips.some(s => s.phase === 'shift')) shuttle.position.z += (0 - shuttle.position.z) * Math.min(1, dt * 4);
    pusher.position.x = X_MAG_IN - 0.18 + (pushing ? Math.min(0.26, (pushing as Strip).x - X_MAG_IN) : 0);
    magIn.set(st.inN); magOk.set(st.okN); magNg.set(st.ngN);
    rgbBeam.visible = strips.some(s => s.phase === 'ride' && s.rgb > 0 && s.rgb < 1);
    specBeam.visible = strips.some(s => s.phase === 'ride' && s.spec > 0 && s.spec < 1);
    if ((hmiT += dt) > 0.4 && st.current) { hmiT = 0; drawHmi(); }
    st.alarmT = Math.max(0, st.alarmT - dt);
    andon.state = st.alarmT > 0 ? 'alarm' : strips.length ? 'run' : 'wait';
  }

  drawHmi();
  return {
    params, andons, step, state: st,
    get stats() { return stats; },
    resetStats() { stats = newStats(); },
  };
}

export type SubstrateCell = ReturnType<typeof createSubstrateCell>;
