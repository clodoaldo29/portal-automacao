// A cobot in the scene: pedestal + UR arm driven by the 6-axis IK.
// Motion planners work with a simple pose [yaw φ, reach r, height y (relative to the shoulder), tool tilt, tool yaw];
// each frame the arm's 6 joints are solved so the tool flange lands on that pose.
import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { at, box, cyl, cylA, shadowify } from '../kit';
import { clamp } from '../math';
import type { Materials } from '../materials';
import type { Pose } from '../sequencer';
import { UR_BASE, UR_TOOL, UR10E, urFK, urIK, urM, type URModel, type URPart, type URState } from './ur-kinematics';

export interface ArmState extends URState {
  joints: THREE.Object3D[];
  root: THREE.Group;
  visNodes: THREE.Object3D[];
}

export interface CobotOptions {
  x: number;
  z: number;
  /** Planner arm segments (the planar 2-link solve that feeds the pose convention). */
  L1?: number;
  L2?: number;
  /** Pedestal height and width. */
  ped?: number;
  pedW?: number;
}

export type Cobot = ReturnType<typeof makeCobot>;

/** Pedestal with status LED ring, and the planner rig (yaw → shoulder → elbow → wrist → tool → mount). */
export function makeCobot(scene: THREE.Scene, M: Materials, { x, z, L1 = 2.2, L2 = 2.0, ped = 0.8, pedW = 1.1 }: CobotOptions) {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  scene.add(root);
  root.add(at(box(pedW, ped, pedW, M.cabinet), 0, ped / 2, 0));
  root.add(at(box(pedW + 0.04, 0.02, pedW + 0.04, M.aluDark), 0, ped - 0.01, 0)); // mounting plate
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x0b1b33, emissive: 0x3b82f6, emissiveIntensity: 1.4 });
  root.add(at(box(pedW + 0.02, 0.025, pedW + 0.02, ledMat), 0, ped - 0.06, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) root.add(at(cyl(0.035, 0.045, 0.03, M.dark, 10), sx * pedW * 0.4, 0.015, sz * pedW * 0.4));
  const oldBase = [at(cyl(0.3, 0.32, 0.32, M.cobot), 0, ped + 0.16, 0), at(cyl(0.31, 0.31, 0.04, M.cobotCap), 0, ped + 0.3, 0)];
  oldBase.forEach(m => root.add(m));
  const yaw = new THREE.Group();
  yaw.position.y = ped + 0.32;
  root.add(yaw);
  yaw.add(at(cyl(0.26, 0.26, 0.36, M.cobot), 0, 0.18, 0));
  const shoulder = new THREE.Group();
  shoulder.position.y = 0.42;
  yaw.add(shoulder);
  shoulder.add(cylA(0.26, 0.56, M.cobot, 'z'));
  const upper = cylA(0.15, L1 - 0.42, M.cobotLink, 'x');
  upper.position.x = L1 / 2;
  shoulder.add(upper);
  const elbow = new THREE.Group();
  elbow.position.x = L1;
  shoulder.add(elbow);
  elbow.add(cylA(0.21, 0.46, M.cobot, 'z'));
  const fore = cylA(0.12, L2 - 0.36, M.cobotLink, 'x');
  fore.position.x = L2 / 2;
  elbow.add(fore);
  const wrist = new THREE.Group();
  wrist.position.x = L2;
  elbow.add(wrist);
  wrist.add(cylA(0.15, 0.36, M.cobot, 'z'));
  const tool = new THREE.Group();
  wrist.add(tool);
  tool.add(at(cylA(0.14, 0.3, M.cobot, 'x'), 0, -0.24, 0));
  const mount = new THREE.Group();
  mount.position.y = -0.62;
  tool.add(mount);
  shadowify(root);
  return { root, yaw, shoulder, elbow, wrist, tool, mount, L1, L2, ledMat, oldBase, ped, shoulderY: ped + 0.32 + 0.42, ur: null as ArmState | null };
}

/** Planar 2-link solve of the planner rig (kept for the pose convention; the UR arm follows the tool flange). */
export function solve(arm: Cobot, [phi, r, yRel, tilt = 0, yawW = 0]: Pose) {
  arm.yaw.rotation.y = phi;
  const { L1, L2 } = arm;
  const d = Math.min(Math.hypot(r, yRel), L1 + L2 - 0.03);
  const a = Math.atan2(yRel, r);
  const t1 = a + Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const t2 = -(Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1)));
  arm.shoulder.rotation.z = t1;
  arm.elbow.rotation.z = t2;
  arm.wrist.rotation.z = -(t1 + t2);
  // with order YXZ the tool's world orientation is Ry(yawW)·Rx(tilt), independent of the arm joints
  arm.tool.rotation.y = yawW - phi;
  arm.tool.rotation.x = tilt;
}

/** Planner pose [φ, r, yRel] that puts the flange over world (x, z) at world height yW. */
export const poseAt = (arm: Cobot, x: number, z: number, yW: number): Pose => {
  const b = arm.root.position, dx = x - b.x, dz = z - b.z;
  return [Math.atan2(-dz, dx), Math.hypot(dx, dz), yW - arm.shoulderY];
};

const URC = {
  J: new THREE.MeshStandardMaterial({ color: 0xc4c8cc, metalness: 0.15, roughness: 0.42 }), // joint housings
  L: new THREE.MeshStandardMaterial({ color: 0xe6e8ea, metalness: 0.1, roughness: 0.35 }), // link tubes
  B: new THREE.MeshStandardMaterial({ color: 0x8fb4d2, metalness: 0.1, roughness: 0.4 }), // joint caps
  K: new THREE.MeshStandardMaterial({ color: 0x1b1c1f, metalness: 0.2, roughness: 0.5 }), // rubber rings
};

function urPart([c, axis, r, a, b, u, v]: URPart) {
  const g = new THREE.CylinderGeometry(r, r, b - a, 40);
  const m = new THREE.Mesh(g, URC[c]);
  const mid = (a + b) / 2;
  if (axis === 'z') { g.rotateX(Math.PI / 2); m.position.set(u, v, mid); }
  else if (axis === 'x') { g.rotateZ(Math.PI / 2); m.position.set(mid, u, v); }
  else m.position.set(u, mid, v);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// world target of the tool flange for a planner pose
const _tp = new THREE.Vector3(), _tq = new THREE.Quaternion(), _e = new THREE.Euler(), _rx = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

function urTarget(arm: Cobot, [phi, r, yRel, tilt = 0, yawW = 0]: Pose) {
  const b = arm.root.position;
  _tq.setFromEuler(_e.set(tilt, yawW, 0, 'YXZ')); // gripper frame orientation
  _tp.set(b.x + r * Math.cos(phi), arm.shoulderY + yRel, b.z - r * Math.sin(phi));
  _tq.multiply(_rx); // gripper → tool0 axes
}

/** Solve the UR joints for the pose (warm-started; `iters` caps the work per frame). Returns the IK error. */
export function urTrack(arm: Cobot, pose: Pose, iters = 10): number {
  if (!arm.ur) return 0;
  urTarget(arm, pose);
  const err = urIK(arm.ur, _tp, _tq, iters);
  arm.ur.joints.forEach((jn, i) => { jn.rotation.z = arm.ur!.q[i]; });
  return err;
}

/** Replace the planner rig's visuals with a UR arm of the given model, on top of the pedestal. */
export function upgradeArm(scene: THREE.Scene, arm: Cobot, pose: Pose, model: URModel = UR10E) {
  const root = new THREE.Group();
  root.position.set(arm.root.position.x, arm.ped, arm.root.position.z);
  root.rotation.x = -Math.PI / 2;
  root.scale.setScalar(model.S);
  scene.add(root);
  root.updateMatrixWorld(true);
  const visNodes: THREE.Object3D[] = [];
  const addVis = (node: THREE.Object3D, i: number) => {
    visNodes[i] = node;
    model.parts[i].forEach(p => { const m = urPart(p); m.userData.urPart = true; node.add(m); });
  };
  let node = new THREE.Object3D();
  node.applyMatrix4(UR_BASE);
  root.add(node);
  addVis(node, 0);
  const joints: THREE.Object3D[] = [];
  for (let i = 0; i < 6; i++) {
    const o = new THREE.Object3D();
    o.applyMatrix4(model.O[i]);
    node.add(o);
    const j = new THREE.Object3D();
    o.add(j);
    joints.push(j);
    addVis(j, i + 1);
    node = j;
  }
  const tool0 = new THREE.Object3D();
  tool0.applyMatrix4(UR_TOOL);
  node.add(tool0);
  const adapter = new THREE.Object3D();
  adapter.rotation.x = -Math.PI / 2;
  adapter.scale.setScalar(1 / model.S);
  tool0.add(adapter);
  adapter.add(arm.mount);
  arm.mount.position.set(0, 0, 0);
  arm.mount.rotation.set(0, 0, 0);
  arm.ur = { model, q: [0, -1.57, 1.57, -1.57, -1.57, 0], rootM: root.matrixWorld.clone(), joints, root, visNodes };
  // pick the elbow-up solution with the smallest error among a few seeds
  urTarget(arm, pose);
  let best: { score: number; q: number[] } | null = null;
  for (const q1 of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) for (const el of [1, -1]) {
    arm.ur.q = [q1, -1.4, el * 1.6, -1.8, -1.57, 0];
    const err = urIK(arm.ur, _tp, _tq, 250);
    urFK(arm.ur, arm.ur.q, 3).decompose(_p, _q, _s);
    const score = err * 10 - _p.y; // elbow high is better
    if (!best || score < best.score) best = { score, q: arm.ur.q.slice() };
  }
  arm.ur.q = best!.q;
  arm.yaw.visible = false;
  arm.oldBase.forEach(m => (m.visible = false));
  urTrack(arm, pose, 50);
}

// Visual origin of each original UR10e mesh in its link frame (ur_macro.xacro + visual_parameters.yaml)
const UR_VIS: [string, THREE.Matrix4][] = [
  ['base', urM(0, 0, 0, 0, 0, Math.PI)], ['shoulder', urM(0, 0, 0, 0, 0, Math.PI)],
  ['upperarm', urM(0, 0, 0.1762, Math.PI / 2, 0, -Math.PI / 2)], ['forearm', urM(0, 0, 0.0393, Math.PI / 2, 0, -Math.PI / 2)],
  ['wrist1', urM(0, 0, -0.135, Math.PI / 2, 0, 0)], ['wrist2', urM(0, 0, -0.12, 0, 0, 0)], ['wrist3', urM(0, 0, -0.1168, Math.PI / 2, 0, 0)],
];

/** Swap the modelled UR10e links for the original meshes (ROS-Industrial universal_robot, BSD) loaded from `baseUrl`. */
export async function useUR10eMeshes(arms: Cobot[], baseUrl: string) {
  const targets = arms.filter(a => a.ur && a.ur.model === UR10E);
  if (!targets.length) return;
  const loader = new ColladaLoader();
  const texts = await Promise.all(UR_VIS.map(([name]) => fetch(`${baseUrl}${name}.dae`).then(r => { if (!r.ok) throw new Error(`${name}.dae ${r.status}`); return r.text(); })));
  const meshes: Record<string, THREE.Group> = {};
  UR_VIS.forEach(([name, M], i) => {
    const s = loader.parse(texts[i], '').scene;
    s.quaternion.identity();
    s.scale.set(1, 1, 1); // keep the mesh in its ROS link frame
    s.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const conv = (m: THREE.Material) => new THREE.MeshStandardMaterial({ color: (m as THREE.MeshStandardMaterial).color ? (m as THREE.MeshStandardMaterial).color.clone() : new THREE.Color(0xcccccc), metalness: 0.2, roughness: 0.38 });
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    const g = new THREE.Group();
    g.add(s);
    g.applyMatrix4(M);
    meshes[name] = g;
  });
  targets.forEach(arm => arm.ur!.visNodes.forEach((node, i) => {
    node.children.filter(o => o.userData.urPart).forEach(o => node.remove(o));
    node.add(meshes[UR_VIS[i][0]].clone());
  }));
}

/** Replace the procedural environment map with an equirectangular HDRI (Radiance .hdr). */
export async function useHDRI(renderer: THREE.WebGLRenderer, scene: THREE.Scene, url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HDRI ${r.status}`);
  const buf = await r.arrayBuffer();
  const td = new RGBELoader().setDataType(THREE.UnsignedByteType).parse(buf) as { data: Uint8Array; width: number; height: number };
  const tex = new THREE.DataTexture(td.data as unknown as BufferSource, td.width, td.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.encoding = THREE.RGBEEncoding;
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = true;
  tex.needsUpdate = true;
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromEquirectangular(tex).texture;
  pm.dispose();
  tex.dispose();
}

/** Status lamp colours for the pedestal LED ring. */
export const LED = { run: 0x3b82f6, wait: 0xf59e0b, off: 0x1e293b } as const;
