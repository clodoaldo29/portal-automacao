// Intellifix AI · the cell in 3D: roller conveyor with pre-stop and stop, enclosure in aluminium profile, two UR10e on
// pedestals facing each other across the belt, screw feeders, HMI, stack light, air unit, emergency stops, control
// cabinet. Everything is placed from an origin (ox, oz) so the cell can stand alone or in front of the Transfer Flow.
import * as THREE from 'three';
import { createAndons } from '../../sim/andon';
import { liftUnit } from '../../sim/conveyor';
import { at, box, canvasTex, cyl, mk, shadowify, std } from '../../sim/kit';
import type { Materials } from '../../sim/materials';
import { obstacleBox, type Obstacle } from '../../sim/robots/collision';
import { makeCobot, poseAt, upgradeArm, type Cobot } from '../../sim/robots/ur-arm';
import { UR10E } from '../../sim/robots/ur-kinematics';
import type { Pose } from '../../sim/sequencer';
import { JIG_L, JIG_TOP, JIG_W, SIZES, TOP, TV_T } from '../transfer-flow/config';
import { makeJig, makeTV, type TV } from '../transfer-flow/products';
import { rollerConveyor } from '../transfer-flow/rollers';
import { CELL, robotHome, tvCentersZ, type TvModel } from './model';
import { TIP, screwdriver, type Screwdriver } from './tool';

/** Layout in the cell's own frame (metres): the belt runs along +x at z = 0, the stop under the robots at x = 0. */
export const LAY = {
  top: TOP, // roller top: the same height as the Transfer Flow belts
  x0: -4.7, x1: 3.3, // conveyor ends
  beltW: 1.2,
  stopX: 0,
  /** Pre-stop: the next pallet waits here, one pallet length (+ 0.3 m) before the stop. */
  preX: -2.1,
  /** The pallet is the Transfer Flow assembly jig ("base colchão"): it goes on to the transfers as it is. */
  pal: { l: JIG_L, w: JIG_W },
  // base low, at the height of the jig: the screw points are close to the base, and a higher base folds the arm on itself;
  // the upper arm still clears the pallet edge (the jig foam, lower than the TVs) when it reaches out for the far points
  ped: TOP + 0.1, pedW: 0.22,
  cab: { x: 1.35, z: 1.4, h: 2.3 },
  /** Travel height of the nose above the back cover between screws, and at home. */
  travel: 0.07, homeLift: 0.3,
};
/** Control cabinet (PLC, robot and torque controllers), in front of the cell (robot 1 side). */
export const CABINET = { x: -0.8, z: LAY.cab.z + 0.45 };
/** Air unit (FRL) on the front panel, between the cabinet and the HMI. */
export const FRL_X = -0.12;
/** TV seat (top of the foam) and the back-cover surface of a TV lying screen-down. */
export const SEAT_Y = LAY.top + JIG_TOP;
export const BACK_Y = SEAT_Y + TV_T;
/** Tool turn about its axis, per robot: the two face each other, so the screwdrivers are mirrored and each camera is on
 *  the outer side, away from its own arm. */
export const TOOL_YAW = [Math.PI, 0] as const;

export interface PalletObj { g: THREE.Group; tvs: TV[]; holes: THREE.Group; screws: THREE.Mesh[]; marks: THREE.Mesh[] }

/** `x1`: where the conveyor ends (cell frame); integrated, it ends where the Transfer Flow belt starts. */
export function createCell(scene: THREE.Scene, M: Materials, font: string, ox: number, oz: number, opts: { exitLift: boolean; x1?: number }) {
  const X = (x: number) => ox + x, Z = (z: number) => oz + z;
  const obstacles: Obstacle[] = [];
  const solid = (name: string, cx: number, cy: number, cz: number, w: number, h: number, d: number, mat: THREE.Material, collide = true) => {
    const m = at(box(w, h, d, mat), X(cx), cy, Z(cz));
    scene.add(shadowify(m));
    if (collide) obstacles.push(obstacleBox(name, X(cx), cy, Z(cz), w, h, d));
    return m;
  };

  // ---------- roller conveyor (the TV line conveyor) ----------
  const { top, x0, beltW } = LAY, x1 = opts.x1 ?? LAY.x1, len = x1 - x0, mid = (x0 + x1) / 2;
  rollerConveyor(scene, M, { x0: X(x0), x1: X(x1), z: Z(0), top, w: beltW });
  obstacles.push(obstacleBox('esteira', X(mid), (top - 0.01) / 2, Z(0), len, top - 0.01, beltW + 0.08));
  // the pallet at the stop with its TV(s), up to the back-cover bump: the arm links must stay clear of it (only the
  // screwdriver nose touches the screw)
  // (the pallet at the stop and its TVs are obstacles too: palletObstacles(), per model)
  liftUnit(scene, M, { x: X(x0 - 0.15), z: Z(0), beltW: LAY.pal.w, side: -1, open: 1.6 });
  if (opts.exitLift) liftUnit(scene, M, { x: X(x1 + 0.15), z: Z(0), beltW: LAY.pal.w, side: 1, open: 1.6 });

  // pneumatic stoppers (rise between the rollers) and photo-eyes at the pre-stop and the stop
  const stopperAt = (x: number) => solid('', x + LAY.pal.l / 2 + 0.03, top - 0.01, 0, 0.04, 0.05, 0.12, M.yellow, false);
  const stoppers = [stopperAt(LAY.preX), stopperAt(LAY.stopX)];
  const sensorOn = new THREE.MeshBasicMaterial({ color: 0x22c55e, toneMapped: false }), sensorOff = new THREE.MeshBasicMaterial({ color: 0x334155 });
  const sensorLeds = [LAY.preX, LAY.stopX].map(x => {
    const g = new THREE.Group();
    g.position.set(X(x + LAY.pal.l / 2 - 0.08), top + 0.02, Z(-(beltW / 2 + 0.05)));
    scene.add(g);
    g.add(at(box(0.035, 0.05, 0.035, M.dark), 0, 0, 0));
    const led = at(box(0.014, 0.014, 0.006, sensorOff), 0, 0.012, 0.019);
    g.add(led);
    return led;
  });

  // ---------- enclosure ----------
  const { cab } = LAY, frameMat = std(0xe9ecef, 0.45, 0.35), panelBlue = std(0x1f3fb0, 0.25, 0.45);
  const glass = new THREE.MeshStandardMaterial({ color: 0xc9dceb, transparent: true, opacity: 0.14, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
  const P = 0.05, H = cab.h, lowH = 0.95, open = { z: LAY.pal.w / 2 + 0.12, h: 1.55 };
  const post = (x: number, z: number) => solid('estrutura da cabine', x, H / 2, z, P, H, P, frameMat);
  for (const x of [-cab.x, 0, cab.x]) for (const z of [-cab.z, cab.z]) post(x, z);
  for (const s of [-1, 1]) for (const z of [-open.z, open.z]) post(s * cab.x, z);
  for (const z of [-cab.z, cab.z]) solid('', 0, H, z, 2 * cab.x + P, P, P, frameMat, false);
  for (const x of [-cab.x, 0, cab.x]) solid('', x, H, 0, P, P, 2 * cab.z - P, frameMat, false);
  for (const s of [-1, 1]) solid('', s * cab.x, open.h, 0, P, P, 2 * open.z - P, frameMat, false); // lintel over the belt
  const pane = (w: number, h: number, x: number, y: number, z: number, ry: number, rx = 0) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glass);
    p.position.set(X(x), y, Z(z)); p.rotation.set(rx, ry, 0, 'YXZ'); p.userData.noShadow = true; scene.add(p);
  };
  // roof: clear panels in the frame (the concept render shows a white roof; here it is clear so the robots show)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pane(cab.x - P, cab.z - P, sx * cab.x / 2, H + 0.02, sz * cab.z / 2, 0, -Math.PI / 2);
  obstacles.push(obstacleBox('teto da cabine', X(0), H + 0.02, Z(0), 2 * cab.x, 0.04, 2 * cab.z));
  // long sides (robot sides): blue lower panels, clear guards above
  for (const z of [-cab.z, cab.z]) {
    solid('proteção', 0, lowH / 2, z, 2 * cab.x - P, lowH, 0.02, panelBlue);
    for (const x of [-cab.x / 2, cab.x / 2]) pane(cab.x - P, H - lowH - P, x, lowH + (H - lowH) / 2, z, 0);
    obstacles.push(obstacleBox('proteção', X(0), H / 2, Z(z), 2 * cab.x, H, 0.03));
  }
  // short sides (conveyor in and out): blue panels beside the opening, clear above the lintel and beside it
  for (const s of [-1, 1]) {
    const x = s * cab.x, wSide = cab.z - open.z;
    for (const zs of [-1, 1]) {
      const zc = zs * (open.z + wSide / 2);
      solid('proteção', x, lowH / 2, zc, 0.02, lowH, wSide - P, panelBlue);
      pane(wSide - P, H - lowH - P, x, lowH + (H - lowH) / 2, zc, Math.PI / 2);
    }
    pane(2 * open.z - P, H - open.h - P, x, open.h + (H - open.h) / 2, 0, Math.PI / 2);
    // light curtain at the opening (yellow posts)
    for (const zs of [-1, 1]) solid('cortina de luz', x + s * 0.04, (open.h - 0.1) / 2 + 0.05, zs * (open.z - 0.05), 0.035, open.h - 0.1, 0.035, M.yellow);
  }

  // ---------- robots ----------
  const arms: Cobot[] = [], tools: Screwdriver[] = [];
  const idlePose = (r: 0 | 1, arm: Cobot): Pose => {
    const h = robotHome(r);
    return [...poseAt(arm, X(LAY.stopX + h.x), Z(h.z), BACK_Y + TIP + LAY.homeLift), 0, TOOL_YAW[r]];
  };
  for (const r of [0, 1] as const) {
    const z = r === 0 ? CELL.robotZ : -CELL.robotZ;
    const arm = makeCobot(scene, M, { x: X(LAY.stopX), z: Z(z), L1: 0.61, L2: 0.57, ped: LAY.ped, pedW: LAY.pedW });
    arm.tool.rotation.order = 'YXZ';
    tools.push(screwdriver(arm.mount, M));
    upgradeArm(scene, arm, idlePose(r, arm), UR10E);
    shadowify(arm.root);
    arms.push(arm);
    // the other robot's pedestal is an obstacle for this one (and the frame of its own base plate)
    obstacles.push(obstacleBox(`pedestal do robô ${r + 1}`, X(LAY.stopX), LAY.ped / 2, Z(z), LAY.pedW, LAY.ped, LAY.pedW));
  }

  // ---------- screw feeders (one per robot), hoses drawn by the simulation ----------
  const feeders: THREE.Vector3[] = [];
  for (const r of [0, 1] as const) {
    const sz = r === 0 ? 1 : -1, fx = 0.62, fz = sz * 1.05;
    solid('mesa do alimentador', fx, 0.42, fz, 0.42, 0.84, 0.36, M.cabinet);
    solid('alimentador de parafusos', fx, 0.84 + 0.14, fz, 0.36, 0.28, 0.3, std(0xf2c230, 0.15, 0.45));
    solid('', fx, 0.84 + 0.29, fz, 0.2, 0.04, 0.16, M.dark, false); // bowl lid
    solid('', fx + 0.12, 0.84 + 0.33, fz - sz * 0.06, 0.06, 0.06, 0.06, M.dark, false); // escapement / outlet
    feeders.push(new THREE.Vector3(X(fx + 0.12), 0.84 + 0.36, Z(fz - sz * 0.06)));
  }

  // ---------- HMI, stack light, air unit, emergency stops, control cabinet ----------
  const [hc, hg] = mk(512, 320);
  const hmiTex = canvasTex(hc);
  const hmi = new THREE.Group();
  hmi.position.set(X(0.75), 1.45, Z(cab.z + 0.12));
  scene.add(hmi);
  hmi.add(at(box(0.05, 0.05, 0.12, M.aluDark), 0, -0.25, -0.06));
  hmi.add(at(box(0.44, 0.3, 0.04, M.dark), 0, 0, 0));
  const scr = at(new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.25), new THREE.MeshBasicMaterial({ map: hmiTex, toneMapped: false })), 0, 0, 0.021);
  scr.userData.noShadow = true;
  hmi.add(scr);
  shadowify(hmi);
  function drawHmi(lines: { title: string; state: string; color: string; rows: [string, string][] }) {
    hg.fillStyle = '#0b1622'; hg.fillRect(0, 0, 512, 320);
    hg.fillStyle = '#1f5fd6'; hg.fillRect(0, 0, 512, 54);
    hg.fillStyle = '#fff'; hg.font = `700 34px ${font}`; hg.textBaseline = 'middle'; hg.fillText(lines.title, 16, 28);
    hg.fillStyle = lines.color; hg.fillRect(16, 70, 480, 54);
    hg.fillStyle = '#0b1622'; hg.font = `700 32px ${font}`; hg.fillText(lines.state, 28, 98);
    hg.font = `600 28px ${font}`;
    lines.rows.forEach(([k, v], i) => { hg.fillStyle = '#93a4b8'; hg.fillText(k, 18, 160 + i * 40); hg.fillStyle = '#e6edf5'; hg.fillText(v, 250, 160 + i * 40); });
    hmiTex.needsUpdate = true;
  }
  const andons = createAndons(M);
  const andon = andons.make(scene, X(cab.x - 0.25), H + 0.06, Z(cab.z - 0.25));
  // Everything outside the enclosure stands on the front side (robot 1): the back side stays free for the Transfer
  // Flow test belt, which runs right behind the cell in the integrated line.
  // air preparation unit (FRL) on the front panel
  const frl = new THREE.Group();
  frl.position.set(X(FRL_X), 1.25, Z(cab.z + 0.06));
  frl.rotation.y = Math.PI; // gauge facing out
  scene.add(frl);
  frl.add(at(box(0.3, 0.04, 0.04, M.aluDark), 0, 0.12, 0));
  [-0.09, 0, 0.09].forEach((x, i) => {
    frl.add(at(cyl(0.03, 0.03, 0.06, i === 1 ? M.blue : M.dark, 16), x, 0.07, 0));
    frl.add(at(cyl(0.024, 0.02, 0.12, std(0xcfe3f2, 0.1, 0.1, { transparent: true, opacity: 0.6 }), 16), x, -0.03, 0));
  });
  frl.add(at(cyl(0.025, 0.025, 0.012, M.white, 16).rotateX(Math.PI / 2), 0, 0.07, -0.035));
  shadowify(frl);
  // emergency stops: front (beside the HMI) and on the exit-side panel
  solid('', 0.35, 1.1, cab.z + 0.04, 0.09, 0.09, 0.06, M.yellow, false);
  scene.add(shadowify(at(cyl(0.028, 0.028, 0.03, M.red, 20).rotateX(Math.PI / 2), X(0.35), 1.1, Z(cab.z + 0.085))));
  solid('', cab.x + 0.04, 1.1, 1.0, 0.06, 0.09, 0.09, M.yellow, false);
  scene.add(shadowify(at(cyl(0.028, 0.028, 0.03, M.red, 20).rotateZ(Math.PI / 2), X(cab.x + 0.085), 1.1, Z(1.0))));
  // control cabinet (PLC, robot controllers, torque controllers) and the two UR control boxes, in front of the cell
  solid('', CABINET.x, 0.95, CABINET.z, 0.9, 1.9, 0.45, M.cabinet, false);
  solid('', CABINET.x, 1.2, CABINET.z + 0.23, 0.6, 0.3, 0.01, M.dark, false);
  for (let i = 0; i < 2; i++) solid('', 0.0 + i * 0.25, 0.35, cab.z + 0.35, 0.22, 0.7, 0.32, M.cabinet, false);
  // floor marking around the enclosure (just behind the back panel: the test belt runs there in the integrated line)
  const tape = new THREE.MeshBasicMaterial({ color: 0xf2c230 });
  const strip = (w: number, d: number, x: number, z: number) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), tape); m.rotation.x = -Math.PI / 2; m.position.set(X(x), 0.014, Z(z)); m.userData.noShadow = true; scene.add(m); };
  const mx = cab.x + 0.5, zf = cab.z + 0.85, zb = -cab.z - 0.06;
  strip(2 * mx, 0.08, 0, zb); strip(2 * mx, 0.08, 0, zf);
  for (const sx of [-mx, mx]) strip(0.08, zf - zb - 0.08, sx, (zf + zb) / 2);

  // ---------- pallets with TVs ----------
  const holeM = std(0x0b0c0e, 0.1, 0.7);
  const headM = std(0xc8ced6, 0.9, 0.25), nokM = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff2020, emissiveIntensity: 1.6, transparent: true, opacity: 0.85, depthWrite: false });
  const okRing = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 1.2, transparent: true, opacity: 0.8, depthWrite: false });
  const headGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.003, 14), holeGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.0015, 10), markGeo = new THREE.RingGeometry(0.009, 0.014, 20);
  /** A pallet for `model`: the Transfer Flow jig (base colchão), TV(s) screen-down, the screw holes, hidden screw
   *  heads and result marks. */
  function makePallet(model: TvModel, points: { x: number; z: number }[]): PalletObj {
    const g = makeJig(M).g;
    const tvs = tvCentersZ(model.inch).map(cz => {
      const tv = makeTV(M, model.inch);
      tv.obj.rotation.x = Math.PI; // screen down, back cover up
      tv.obj.position.set(0, JIG_TOP + TV_T / 2, cz);
      g.add(tv.obj);
      return tv;
    });
    const holes = new THREE.Group(), screws: THREE.Mesh[] = [], marks: THREE.Mesh[] = [];
    g.add(holes);
    const yb = JIG_TOP + TV_T;
    for (const p of points) {
      holes.add(at(new THREE.Mesh(holeGeo, holeM), p.x, yb + 0.0008, p.z));
      const s = at(new THREE.Mesh(headGeo, headM), p.x, yb + 0.0015, p.z);
      s.visible = false;
      holes.add(s); screws.push(s);
      const mk2 = at(new THREE.Mesh(markGeo, okRing), p.x, yb + 0.004, p.z);
      mk2.rotation.x = -Math.PI / 2; mk2.visible = false; mk2.userData.noShadow = true;
      holes.add(mk2); marks.push(mk2);
    }
    shadowify(g);
    holes.traverse(m => { if ((m as THREE.Mesh).isMesh) { m.castShadow = false; } });
    scene.add(g);
    return { g, tvs, holes, screws, marks };
  }
  const markMats = { ok: okRing, nok: nokM };

  /** The pallet at the stop as it is for model: the jig foam, the TV back covers, the electronics bump in their middle. */
  function palletObstacles(model: TvModel): Obstacle[] {
    const [w, d] = SIZES[model.inch], cx = X(LAY.stopX);
    const out: Obstacle[] = [obstacleBox('pallet e TVs', cx, (top + SEAT_Y) / 2, Z(0), LAY.pal.l, SEAT_Y - top, LAY.pal.w)];
    for (const cz of tvCentersZ(model.inch)) {
      out.push(obstacleBox('pallet e TVs', cx, (SEAT_Y + BACK_Y) / 2, Z(cz), w, BACK_Y - SEAT_Y, d));
      out.push(obstacleBox('pallet e TVs', cx, BACK_Y + 0.0225, Z(cz), w * 0.56, 0.045, d * 0.56)); // bump
    }
    return out;
  }

  return {
    obstacles, palletObstacles, arms, tools, feeders, stoppers, sensorLeds, sensorOn, sensorOff, andons, andon, drawHmi, makePallet, markMats, idlePose,
    X, Z, x1,
  };
}
export type Cell = ReturnType<typeof createCell>;
