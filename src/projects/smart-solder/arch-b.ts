// Smart Solder AI · Architecture B: three soldering cells along the line, each with an articulated arm (UR10e) and a
// soldering iron, working IN PARALLEL with the same load.
//
// Balancing on a straight line without bypass: pallets wait at the buffer stop and go in as a group of three. The first
// one rides to cell 3, the second to cell 2, the third to cell 1; each arm solders a whole blank, all three at the same
// time, and the group leaves together while the next group comes in. Every robot solders one blank in three, and the
// alignment and the pallet move are paid once per robot and per blank (see strategiesB in model.ts for the series
// alternative, slower).
import * as THREE from 'three';
import { at, box, shadowify, std } from '../../sim/kit';
import type { Materials } from '../../sim/materials';
import { armClearance, obstacleBox, type Obstacle } from '../../sim/robots/collision';
import { LED, makeCobot, poseAt, solve, upgradeArm, urTrack, type Cobot } from '../../sim/robots/ur-arm';
import { UR10E } from '../../sim/robots/ur-kinematics';
import { runSeq, type Pose, type Step } from '../../sim/sequencer';
import type { Pallet, SolderLine } from './line';
import { CELLS_B, LINE, PALLET, PCB, ST, activeCells, blankSize, type SolderParams } from './model';
import { TIP, cellSign, solderIron, type SolderIron } from './tools';

export interface RobotStat { blanks: number; points: number; busyT: number }
export interface ZoneStats { robots: RobotStat[]; maxIkErr: number; minClear: number; minClearAt: string; groups: number }
const newZone = (n: number): ZoneStats => ({ robots: Array.from({ length: n }, () => ({ blanks: 0, points: 0, busyT: 0 })), maxIkErr: 0, minClear: Infinity, minClearAt: '', groups: 0 });

const RZ = -0.72, PED = 0.72;
let IK_ITERS = 10;
export const setIkIters = (n: number) => { IK_ITERS = n; };

export function createArchB(scene: THREE.Scene, M: Materials, font: string, line: SolderLine, params: SolderParams) {
  let stats = newZone(3);
  const glass = new THREE.MeshStandardMaterial({ color: 0xbcd6ea, transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
  const frameMat = std(0xdfe3e7, 0.4, 0.4);

  interface Cell {
    i: number; x: number; arm: Cobot; iron: SolderIron; actor: { seq: Step[]; pose: Pose };
    state: 'empty' | 'work' | 'done'; pallet: Pallet | null; heat: boolean; obstacles: Obstacle[];
    andon: { state: 'run' | 'wait' | 'alarm' }; P: (x: number, y: number, z: number) => Pose; idle: Pose;
  }
  const cells: Cell[] = CELLS_B.map((x, i) => {
    const obstacles: Obstacle[] = [];
    const solid = (name: string, cx: number, cy: number, cz: number, w: number, h: number, d: number, mat: THREE.Material) => {
      scene.add(at(box(w, h, d, mat), cx, cy, cz));
      obstacles.push(obstacleBox(name, cx, cy, cz, w, h, d));
    };
    // frame: posts, top beams, back and side guards behind the line, light curtain at the front
    const X0 = x - 0.6, X1 = x + 0.6, Zb = -1.2, Zf = 0.42, H = 2.15;
    for (const px of [X0, X1]) {
      solid('estrutura da célula', px, H / 2, Zb, 0.05, H, 0.05, frameMat);
      solid('cortina de luz', px, H / 2, Zf, 0.05, H, 0.05, M.yellow);
    }
    for (const pz of [Zb, Zf]) scene.add(at(box(1.25, 0.06, 0.06, frameMat), x, H, pz));
    for (const px of [X0, X1]) scene.add(at(box(0.06, 0.06, Zf - Zb + 0.06, frameMat), px, H, (Zb + Zf) / 2));
    const panel = (w: number, h: number, px: number, py: number, pz: number, ry: number) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glass); p.position.set(px, py, pz); p.rotation.y = ry; p.userData.noShadow = true; scene.add(p);
    };
    panel(1.2, H - 0.1, x, H / 2, Zb, 0);
    obstacles.push(obstacleBox('proteção traseira', x, H / 2, Zb, 1.2, H, 0.03));
    for (const px of [X0, X1]) {
      panel(Zb * -1 - 0.33, H - 0.1, px, H / 2, (Zb - 0.33) / 2, Math.PI / 2);
      obstacles.push(obstacleBox('proteção lateral', px, H / 2, (Zb - 0.33) / 2, 0.03, H, -Zb - 0.33));
    }
    const sign = cellSign(`Célula robótica ${i + 1}`, font);
    sign.position.set(x, H - 0.12, Zf + 0.035);
    scene.add(sign);
    // fume extraction hood over the work area
    solid('exaustão', x, H - 0.25, -0.15, 0.36, 0.08, 0.36, std(0x9aa1a9, 0.6, 0.35));
    scene.add(at(box(0.1, 0.25, 0.1, std(0x9aa1a9, 0.6, 0.35)), x, H - 0.08, -0.15));
    // the line through the cell, the pallet stopped under the arm
    obstacles.push(obstacleBox('esteira', x, (LINE.top - 0.005) / 2, 0, 1.3, LINE.top - 0.005, LINE.beltW + 0.1));
    for (const s of [-1, 1]) obstacles.push(obstacleBox('guia da esteira', x, LINE.top + 0.015, s * (LINE.beltW / 2 + 0.03), 1.3, 0.05, 0.05));
    const bw = blankSize(10);
    const partsTop = LINE.top + PALLET.h + 0.003 + PCB.t + 0.016;
    obstacles.push(obstacleBox('pallet e componentes', x, (LINE.top + partsTop) / 2, 0, Math.max(PALLET.l, bw.l), partsTop - LINE.top, PALLET.d));
    scene.add(at(box(0.04, 0.03, 0.08, M.yellow), x + PALLET.l / 2 + 0.03, LINE.top + 0.015, -0.18)); // stopper

    const arm = makeCobot(scene, M, { x, z: RZ, L1: 0.61, L2: 0.57, ped: PED, pedW: 0.36 });
    arm.tool.rotation.order = 'YXZ';
    const iron = solderIron(arm.mount, M);
    const P = (px: number, py: number, pz: number): Pose => [...poseAt(arm, px, pz, py + TIP), 0, 0];
    const idle = P(x, 1.12, -0.28);
    upgradeArm(scene, arm, idle, UR10E);
    const andonG = new THREE.Group();
    andonG.position.set(X1, H, Zb);
    scene.add(andonG);
    const andon = line.andons.make(andonG, 0, 0, 0);
    shadowify(arm.root);
    return { i, x, arm, iron, actor: { seq: [], pose: idle.slice() }, state: 'empty', pallet: null, heat: false, obstacles, andon, P, idle };
  });

  // buffer stop: pallets wait there until a whole group can go in
  line.zoneStop(ST.buffer, it => it.target < 0, () => {});
  scene.add(at(box(0.04, 0.03, 0.08, M.yellow), ST.buffer + PALLET.l / 2 + 0.03, LINE.top + 0.015, -0.18));
  cells.forEach(c => line.zoneStop(c.x, it => it.target === c.i, it => { c.pallet = it; c.state = 'work'; c.actor.seq.length = 0; c.actor.seq.push(...solderJob(c, it)); }));

  /** Every joint of the blank on the pallet, with the fiducial check first. */
  function solderJob(c: Cell, it: Pallet): Step[] {
    const b = it.blank!, a = params.alignS, s = params.pointS;
    const dwell = Math.max(0.6, s * 0.5), down = 0.22, up = 0.22, move = Math.max(0.1, s - dwell - down - up);
    const pts = b.pts.map((_, k) => line.jointWorld(b, k));
    const lift = 0.03;
    const { l } = blankSize(b.boards);
    const cx = it.obj.position.x, top = LINE.top + PALLET.h + 0.003 + PCB.t;
    const fid = [cx - l / 2 + 0.015, cx + l / 2 - 0.015];
    const steps: Step[] = [
      { to: c.P(fid[0], top + 0.07, 0), dur: 0.3 * a },
      { dur: 0.15 * a },
      { to: c.P(fid[1], top + 0.07, 0), dur: 0.15 * a },
      { dur: 0.1 * a },
    ];
    pts.forEach((p, k) => {
      steps.push(
        { to: c.P(p.x, p.y + lift, p.z), dur: move },
        { to: c.P(p.x, p.y, p.z), dur: down },
        { fn: () => { c.heat = true; } },
        { dur: dwell },
        { fn: () => { c.heat = false; line.solderJoint(b, k); stats.robots[c.i].points++; } },
        { to: c.P(p.x, p.y + lift, p.z), dur: up },
      );
    });
    steps.push(
      { to: c.idle, dur: 0.3 * a, ready: true },
      { fn: () => { c.state = 'done'; b.by = c.i; stats.robots[c.i].blanks++; } },
    );
    return steps;
  }

  /** Release a finished group and send the next one in (both at the same moment). */
  function dispatch() {
    const act = cells.filter(c => params.cells[c.i]);
    if (!act.length) return;
    const allFree = cells.every(c => c.state !== 'work') && act.every(c => c.state === 'empty' || c.state === 'done');
    if (!allFree) return;
    const k = activeCells(params);
    const bufS = ST.buffer - LINE.x0;
    const queue = line.L.items.filter(it => it.target < 0 && it.blank && it.blank.pre && it.blank.done === 0 && it.s <= bufS + 1e-6 && it.s >= bufS - (k - 1) * LINE.gap - 0.05)
      .sort((a, b) => b.s - a.s);
    const anyDone = cells.some(c => c.state === 'done');
    if (queue.length < k && !anyDone) return;
    for (const c of cells) if (c.state === 'done' && c.pallet) { c.pallet.target = -1; c.pallet.hold = null; c.pallet = null; c.state = 'empty'; }
    if (queue.length < k) return; // the cells wait empty for a whole group
    const far = act.slice().sort((a, b) => b.x - a.x);
    queue.slice(0, k).forEach((it, n) => { it.target = far[n].i; it.hold = null; });
    stats.groups++;
  }

  // ---------- collision ----------
  const toolBox = new THREE.Box3();
  let checkT = 0;
  function check(c: Cell) {
    c.iron.body.updateWorldMatrix(true, true);
    toolBox.setFromObject(c.iron.body);
    const r = armClearance(c.arm, c.obstacles, [toolBox]);
    if (r.min < stats.minClear) { stats.minClear = r.min; stats.minClearAt = `célula ${c.i + 1}: ${r.name} (${r.part})`; }
    return r;
  }

  let ik = true;
  function step(dt: number) {
    dispatch();
    const doCheck = ik && (checkT += dt) >= 1 / 15;
    if (doCheck) checkT = 0;
    for (const c of cells) {
      const busy = c.actor.seq.some(s => !s.ready);
      if (busy) stats.robots[c.i].busyT += dt;
      runSeq(c.actor, dt);
      c.iron.heat(c.heat, dt);
      if (ik) {
        solve(c.arm, c.actor.pose);
        const err = urTrack(c.arm, c.actor.pose, IK_ITERS);
        if (busy && line.stats.t > 3) stats.maxIkErr = Math.max(stats.maxIkErr, err);
        if (doCheck) check(c);
      }
      c.arm.ledMat.emissive.setHex(!params.cells[c.i] ? LED.off : busy ? LED.run : LED.wait);
      c.andon.state = busy ? 'run' : 'wait';
    }
  }

  return {
    cells, step, setIk(on: boolean) { ik = on; if (on) cells.forEach(c => { solve(c.arm, c.actor.pose); urTrack(c.arm, c.actor.pose, 60); }); },
    arms: cells.map(c => c.arm),
    get stats() { return stats; },
    resetStats() { stats = newZone(3); },
    robotState: (i: number) => (!params.cells[i] ? 'desligada' : cells[i].state === 'work' ? 'soldando' : cells[i].state === 'done' ? 'aguardando o lote' : 'aguardando pallet'),
    clearance: () => cells.map(check),
  };
}

export type ArchB = ReturnType<typeof createArchB>;
