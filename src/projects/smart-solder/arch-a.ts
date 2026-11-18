// Smart Solder AI · Architecture A: one collaborative arm (UR10e) feeds three cartesian soldering robots.
//
// The arm stands behind the line between the three cartesians (left, back, right). At PICK it takes the blank off the
// pallet (the empty pallet moves on to PLACE and waits), puts it on the table of a cartesian, and later takes the
// soldered blank back to an empty pallet at PLACE. The arm serves the cartesians in turn (round-robin), so each one
// solders one blank in three: the same load for the three. Each cartesian aligns on the fiducials and solders every
// joint of its blank: the table moves the blank front to back (Y), the head moves across (X) and down (Z).
import * as THREE from 'three';
import { at, box, cyl, shadowify, std } from '../../sim/kit';
import type { Materials } from '../../sim/materials';
import { armClearance, obstacleBox, orientedObstacle, type Obstacle } from '../../sim/robots/collision';
import { vacuumPlate } from '../../sim/robots/grippers';
import { LED, makeCobot, poseAt, solve, upgradeArm, urTrack } from '../../sim/robots/ur-arm';
import { UR10E } from '../../sim/robots/ur-kinematics';
import { runSeq, type Pose, type Step } from '../../sim/sequencer';
import type { RobotStat } from './arch-b';
import type { Blank, Pallet, SolderLine } from './line';
import { A, LINE, PALLET, PCB, type SolderParams } from './model';
import { cellSign, solderIron, type SolderIron } from './tools';

const ROBOT = { x: 0, z: -0.72, ped: 0.72 };
/** Cartesian robots: centre, facing (rotation about y; local +z faces the arm). */
const MACH: { x: number; z: number; ry: number }[] = [
  { x: -1.02, z: -0.74, ry: Math.PI / 2 },
  { x: 0, z: -1.56, ry: 0 },
  { x: 1.02, z: -0.74, ry: -Math.PI / 2 },
];
/** Cartesian local geometry: table top, load position of the table, head plane, iron length. */
const C = { tableY: 0.81, load: 0.2, headZ: 0, tipLen: 0.3, restY: 0.1, beamY: 0.81 + 0.58 };
const GRIP = 0.16;
let IK_ITERS = 10;
export const setIkIters = (n: number) => { IK_ITERS = n; };

export interface ZoneStatsA { robots: RobotStat[]; cobotT: number; transfers: number; maxIkErr: number; minClear: number; minClearAt: string }
const newZone = (): ZoneStatsA => ({ robots: Array.from({ length: 3 }, () => ({ blanks: 0, points: 0, busyT: 0 })), cobotT: 0, transfers: 0, maxIkErr: 0, minClear: Infinity, minClearAt: '' });

export function createArchA(scene: THREE.Scene, M: Materials, font: string, line: SolderLine, params: SolderParams) {
  let stats = newZone();
  const obstacles: Obstacle[] = [];
  const glass = new THREE.MeshStandardMaterial({ color: 0xbcd6ea, transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
  const machine = std(0xe9ecef, 0.15, 0.45), rail = std(0x6b7280, 0.6, 0.35);

  interface Cart {
    i: number; g: THREE.Group; table: THREE.Group; head: THREE.Group; carriage: THREE.Group; iron: SolderIron;
    actor: { seq: Step[]; pose: Pose }; state: 'empty' | 'work' | 'done'; blank: Blank | null; heat: boolean; reserved: boolean;
    andon: { state: 'run' | 'wait' | 'alarm' };
  }
  /** Pose of a cartesian: [head x, tip height above the joint plane, table z]. */
  const restPose = (): Pose => [0, C.restY, C.load];
  const carts: Cart[] = MACH.map((m, i) => {
    const g = new THREE.Group();
    g.position.set(m.x, 0, m.z);
    g.rotation.y = m.ry;
    scene.add(g);
    const add = (name: string | null, o: THREE.Mesh, w: number, h: number, d: number) => {
      g.add(o);
      if (name) { g.updateMatrixWorld(true); const p = o.getWorldPosition(new THREE.Vector3()); obstacles.push(orientedObstacle(name, p.x, p.y, p.z, w, h, d, m.ry)); }
    };
    const nm = `cartesiano ${i + 1}`;
    add(nm, at(box(0.66, C.tableY - 0.03, 0.62, machine), 0, (C.tableY - 0.03) / 2, 0), 0.66, C.tableY - 0.03, 0.62);
    for (const sx of [-1, 1]) g.add(at(box(0.03, 0.02, 0.6, rail), sx * 0.15, C.tableY - 0.02, 0));
    // gantry: two columns and the beam, at the back half
    for (const sx of [-1, 1]) add(nm, at(box(0.06, 0.62, 0.08, M.alu), sx * 0.36, C.tableY + 0.28, C.headZ - 0.09), 0.06, 0.62, 0.08);
    add(nm, at(box(0.78, 0.09, 0.09, M.alu), 0, C.tableY + 0.58, C.headZ - 0.09), 0.78, 0.09, 0.09);
    g.add(at(box(0.74, 0.02, 0.02, rail), 0, C.tableY + 0.6, C.headZ - 0.04));
    // enclosure: back and sides, roof; the front is open to the arm (light curtain)
    const pane = (w: number, h: number, x: number, y: number, z: number, ry: number) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glass); p.position.set(x, y, z); p.rotation.y = ry; p.userData.noShadow = true; g.add(p); };
    pane(0.66, 0.75, 0, C.tableY + 0.38, -0.34, 0);
    for (const sx of [-1, 1]) pane(0.6, 0.75, sx * 0.33, C.tableY + 0.38, -0.04, Math.PI / 2);
    for (const sx of [-1, 1]) g.add(at(box(0.03, 0.8, 0.03, M.yellow), sx * 0.33, C.tableY + 0.4, 0.29));
    for (const sx of [-1, 1]) { g.updateMatrixWorld(true); const p = new THREE.Vector3(sx * 0.33, C.tableY + 0.38, -0.04).applyMatrix4(g.matrixWorld); obstacles.push(orientedObstacle(nm, p.x, p.y, p.z, 0.03, 0.75, 0.6, m.ry)); }
    { g.updateMatrixWorld(true); const p = new THREE.Vector3(0, C.tableY + 0.38, -0.34).applyMatrix4(g.matrixWorld); obstacles.push(orientedObstacle(nm, p.x, p.y, p.z, 0.66, 0.75, 0.03, m.ry)); }
    for (const sx of [-1, 1]) { g.updateMatrixWorld(true); const p = new THREE.Vector3(sx * 0.33, C.tableY + 0.4, 0.29).applyMatrix4(g.matrixWorld); obstacles.push(orientedObstacle(nm, p.x, p.y, p.z, 0.03, 0.8, 0.03, m.ry)); }
    // the moving table (berço adaptável)
    const table = new THREE.Group();
    g.add(table);
    table.add(at(box(0.44, 0.02, 0.36, M.dark), 0, -0.01, 0));
    for (const sx of [-1, 1]) table.add(at(box(0.02, 0.012, 0.3, M.blue), sx * 0.2, 0.006, 0));
    for (const sz of [-1, 1]) table.add(at(box(0.36, 0.012, 0.02, M.blue), 0, 0.006, sz * 0.165));
    table.position.set(0, C.tableY, C.load);
    // head: X carriage on the beam, Z slide, iron
    const head = new THREE.Group();
    g.add(head);
    const carriage = new THREE.Group();
    carriage.position.set(0, C.beamY, C.headZ - 0.02);
    g.add(carriage);
    carriage.add(at(box(0.12, 0.16, 0.04, M.dark), 0, 0, 0));
    head.add(at(box(0.05, 0.3, 0.04, M.aluDark), 0, C.tipLen + 0.15, 0));
    const ironMount = new THREE.Object3D();
    ironMount.position.y = C.tipLen;
    head.add(ironMount);
    const iron = solderIron(ironMount, M, C.tipLen);
    const sign = cellSign(`Cartesiano ${i + 1}`, font);
    sign.scale.setScalar(0.6);
    sign.position.set(0, C.tableY + 0.7, C.headZ - 0.04);
    g.add(sign);
    const andon = line.andons.make(g, 0.36, C.tableY + 0.62, C.headZ - 0.09);
    shadowify(g);
    return { i, g, table, head, carriage, iron, actor: { seq: [], pose: restPose() }, state: 'empty', blank: null, heat: false, reserved: false, andon };
  });
  const jointY = C.tableY + 0.003 + PCB.t + 0.0014;
  function placeCart(c: Cart) {
    const [hx, hy, tz] = c.actor.pose;
    c.table.position.z = tz;
    c.carriage.position.x = hx;
    c.head.position.set(hx, jointY + hy, C.headZ);
  }
  carts.forEach(placeCart);

  /** Cartesian job: fiducials, every joint, table back to the load position. */
  function cartJob(c: Cart): Step[] {
    const b = c.blank!, a = params.alignS, s = params.pointS;
    const dwell = Math.max(0.6, s * 0.5), down = 0.22, up = 0.22, move = Math.max(0.1, s - dwell - down - up), lift = 0.03;
    const { l } = { l: 2 * 0.16 + 3 * 0.015 };
    const steps: Step[] = [
      { to: [-l / 2 + 0.015, 0.07, C.headZ], dur: 0.3 * a }, { dur: 0.15 * a },
      { to: [l / 2 - 0.015, 0.07, C.headZ], dur: 0.15 * a }, { dur: 0.1 * a },
    ];
    b.pts.forEach((p, k) => steps.push(
      { to: [p.x, lift, C.headZ - p.z], dur: move },
      { to: [p.x, 0, C.headZ - p.z], dur: down },
      { fn: () => { c.heat = true; } },
      { dur: dwell },
      { fn: () => { c.heat = false; line.solderJoint(b, k); stats.robots[c.i].points++; } },
      { to: [p.x, lift, C.headZ - p.z], dur: up },
    ));
    steps.push({ to: restPose(), dur: 0.3 * a }, { fn: () => { c.state = 'done'; b.by = c.i; stats.robots[c.i].blanks++; } });
    return steps;
  }

  // ---------- the arm ----------
  const arm = makeCobot(scene, M, { x: ROBOT.x, z: ROBOT.z, L1: 0.61, L2: 0.57, ped: ROBOT.ped, pedW: 0.36 });
  arm.tool.rotation.order = 'YXZ';
  const grip = vacuumPlate(arm.mount, M, { w: 0.3, d: 0.2, drop: GRIP, nx: 3, nz: 2 });
  const P = (x: number, y: number, z: number, yaw = 0): Pose => [...poseAt(arm, x, z, y + GRIP), 0, yaw];
  const idle = P(0, 1.15, -0.3);
  upgradeArm(scene, arm, idle, UR10E);
  const actor = { seq: [] as Step[], pose: idle.slice() };
  const andonArm = new THREE.Group();
  andonArm.position.set(0.32, 0, -0.42);
  scene.add(andonArm);
  andonArm.add(at(cyl(0.025, 0.025, 1.4, M.alu, 8), 0, 0.7, 0));
  const armAndon = line.andons.make(andonArm, 0, 1.4, 0);
  for (const sx of [-1.6, 1.6]) { scene.add(at(box(0.05, 2.2, 0.05, M.yellow), sx, 1.1, 0.42)); obstacles.push(obstacleBox('cortina de luz', sx, 1.1, 0.42, 0.05, 2.2, 0.05)); }
  scene.add(at(box(3.25, 0.06, 0.06, std(0xdfe3e7, 0.4, 0.4)), 0, 2.2, 0.42));

  // line under the arm, stoppers, pallets waiting at PICK and PLACE
  obstacles.push(obstacleBox('esteira', 0, (LINE.top - 0.005) / 2, 0, 3.2, LINE.top - 0.005, LINE.beltW + 0.1));
  for (const s of [-1, 1]) obstacles.push(obstacleBox('guia da esteira', 0, LINE.top + 0.015, s * (LINE.beltW / 2 + 0.03), 3.2, 0.05, 0.05));
  for (const x of [A.pick, A.place]) scene.add(at(box(0.04, 0.03, 0.08, M.yellow), x + PALLET.l / 2 + 0.03, LINE.top + 0.015, -0.18));
  const blankTop = LINE.top + PALLET.h + 0.003 + PCB.t + 0.014; // edge gripper over the components
  let atPick: Pallet | null = null, atPlace: Pallet | null = null;
  line.zoneStop(A.pick, it => !!it.blank && it.blank.done === 0, it => { atPick = it; });
  line.zoneStop(A.place, it => !it.blank, it => { atPlace = it; });

  /** Table load point of a cartesian in world coordinates, and the tool yaw that lines the blank up with the table. */
  function loadPoint(c: Cart) {
    c.g.updateMatrixWorld(true);
    const p = new THREE.Vector3(0, C.tableY + 0.003 + PCB.t + 0.014, C.load).applyMatrix4(c.g.matrixWorld);
    return { x: p.x, y: p.y, z: p.z, yaw: MACH[c.i].ry };
  }
  const SAFE = 1.2, TUCK = 0.42, DOWN = 0.45;
  const tucked = (x: number, z: number, y: number, yaw: number): Pose => {
    const dx = x - ROBOT.x, dz = z - ROBOT.z, d = Math.hypot(dx, dz) || 1;
    return P(ROBOT.x + (dx / d) * TUCK, y, ROBOT.z + (dz / d) * TUCK, yaw);
  };
  const near = (p: Pose): (() => Pose) => () => {
    const q = p.slice(), cur = actor.pose[0];
    while (q[0] - cur > Math.PI) q[0] -= 2 * Math.PI;
    while (q[0] - cur < -Math.PI) q[0] += 2 * Math.PI;
    return q;
  };
  const travel = (x: number, y: number, z: number, yaw: number): Step[] => [
    { toFn: () => { const [phi, , yRel, , yw] = actor.pose; return [phi, TUCK, yRel, 0, yw]; }, dur: 0.5 },
    { toFn: near(tucked(x, z, SAFE, yaw)), dur: 0.9 },
    { toFn: near(P(x, Math.max(SAFE - 0.12, y + 0.12), z, yaw)), dur: 0.6 },
    { toFn: near(P(x, y, z, yaw)), dur: DOWN },
  ];
  const rise = (x: number, y: number, z: number, yaw: number): Step => ({ toFn: near(P(x, Math.max(SAFE - 0.12, y + 0.12), z, yaw)), dur: DOWN });
  // both home steps are "ready": a new job replaces them, so the arm goes straight from one job to the next
  const home = (): Step[] => [
    { toFn: () => { const [phi, , yRel, , yw] = actor.pose; return [phi, TUCK, yRel, 0, yw]; }, dur: 0.5, ready: true },
    { toFn: near(idle), dur: 0.8, ready: true },
  ];
  /** Pick at PICK, load cartesian c. */
  function loadJob(c: Cart, it: Pallet): Step[] {
    const lp = loadPoint(c), x = it.obj.position.x;
    return [
      ...travel(x, blankTop, 0, 0),
      { fn: () => { const b = it.blank!; grip.attach(b.obj); it.blank = null; it.hold = null; atPick = null; c.blank = b; } },
      rise(x, blankTop, 0, 0),
      ...travel(lp.x, lp.y, lp.z, lp.yaw),
      { fn: () => {
        const b = c.blank!;
        c.table.attach(b.obj);
        b.obj.position.set(0, 0.003, 0); b.obj.rotation.set(0, 0, 0);
        c.state = 'work'; c.reserved = false; stats.transfers++;
        c.actor.seq.length = 0; c.actor.seq.push(...cartJob(c));
      } },
      rise(lp.x, lp.y, lp.z, lp.yaw),
      ...home(),
    ];
  }
  /** Unload cartesian c onto the empty pallet at PLACE. */
  function unloadJob(c: Cart, it: Pallet): Step[] {
    const lp = loadPoint(c), x = it.obj.position.x;
    return [
      ...travel(lp.x, lp.y, lp.z, lp.yaw),
      { fn: () => { grip.attach(c.blank!.obj); } },
      rise(lp.x, lp.y, lp.z, lp.yaw),
      ...travel(x, blankTop, 0, 0),
      { fn: () => {
        const b = c.blank!;
        it.obj.attach(b.obj);
        b.obj.position.set(0, PALLET.h + 0.003, 0); b.obj.rotation.set(0, 0, 0);
        it.blank = b; it.hold = null; atPlace = null;
        c.blank = null; c.state = 'empty'; c.reserved = false; stats.transfers++;
      } },
      rise(x, blankTop, 0, 0),
      ...home(),
    ];
  }
  let rr = 0;
  /** Round-robin: serve the next active cartesian; wait for it rather than skip it. */
  function nextJob() {
    if (!actor.seq.every(s => s.ready)) return;
    const n = carts.length;
    for (let k = 0; k < n && !params.cells[rr % n]; k++) rr++;
    const c = carts[rr % n];
    if (!params.cells[c.i]) return;
    if (c.state === 'done' && !c.reserved && atPlace) { c.reserved = true; actor.seq.length = 0; actor.seq.push(...unloadJob(c, atPlace)); return; }
    if (c.state === 'empty' && !c.reserved && atPick) { c.reserved = true; actor.seq.length = 0; actor.seq.push(...loadJob(c, atPick)); rr++; }
  }

  // ---------- collision ----------
  const toolBox = new THREE.Box3(), heldBox = new THREE.Box3();
  const gripGroup = grip.parent!;
  function liveObstacles(): Obstacle[] {
    const out = obstacles.slice();
    for (const c of carts) {
      c.head.updateMatrixWorld(true);
      out.push({ name: `cabeça do cartesiano ${c.i + 1}`, box: new THREE.Box3().setFromObject(c.head) });
    }
    return out;
  }
  function check() {
    gripGroup.updateWorldMatrix(true, true);
    toolBox.setFromObject(gripGroup);
    const tools = [toolBox];
    const held = grip.children.find(o => o.type === 'Group');
    if (held) { held.updateWorldMatrix(true, true); heldBox.setFromObject(held); tools.push(heldBox); }
    const r = armClearance(arm, liveObstacles(), tools);
    if (r.min < stats.minClear) { stats.minClear = r.min; stats.minClearAt = `${r.name} (${r.part})`; }
    return r;
  }

  let ik = true, checkT = 0;
  function step(dt: number) {
    nextJob();
    const busy = actor.seq.some(s => !s.ready);
    if (busy) stats.cobotT += dt;
    runSeq(actor, dt);
    for (const c of carts) {
      if (c.state === 'work') stats.robots[c.i].busyT += dt;
      runSeq(c.actor, dt);
      placeCart(c);
      c.iron.heat(c.heat, dt);
      c.andon.state = c.state === 'work' ? 'run' : 'wait';
    }
    if (ik) {
      solve(arm, actor.pose);
      const err = urTrack(arm, actor.pose, IK_ITERS);
      if (busy && line.stats.t > 3) stats.maxIkErr = Math.max(stats.maxIkErr, err);
      if ((checkT += dt) >= 1 / 15) { checkT = 0; check(); }
    }
    arm.ledMat.emissive.setHex(busy ? LED.run : LED.wait);
    armAndon.state = busy ? 'run' : 'wait';
  }

  return {
    carts, arm, step, arms: [arm],
    setIk(on: boolean) { ik = on; if (on) { solve(arm, actor.pose); urTrack(arm, actor.pose, 60); } },
    get stats() { return stats; },
    resetStats() { stats = newZone(); },
    get cobotBusy() { return actor.seq.some(s => !s.ready); },
    robotState: (i: number) => (!params.cells[i] ? 'desligado' : carts[i].state === 'work' ? 'soldando' : carts[i].state === 'done' ? 'aguardando o braço' : 'vazio'),
    clearance: check,
  };
}

export type ArchA = ReturnType<typeof createArchA>;
