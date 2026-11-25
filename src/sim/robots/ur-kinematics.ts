// Universal Robots kinematics (UR10e, UR30) and a 6-axis numeric IK (damped least squares).
// Joint origins follow ROS-Industrial universal_robot (BSD): config/<model>/default_kinematics.yaml.
// Frames are ROS (z up, metres); the scene places the robot base frame through `rootM`.
import * as THREE from 'three';
import { clamp } from '../math';

/** Pose from xyz + roll/pitch/yaw (ROS convention: extrinsic XYZ = intrinsic ZYX). */
export const urM = (x: number, y: number, z: number, r: number, p: number, yw: number) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(r, p, yw, 'ZYX')), new THREE.Vector3(1, 1, 1));

/** base_link → base_link_inertia */
export const UR_BASE = urM(0, 0, 0, 0, 0, Math.PI);
/** wrist_3 → flange → tool0 */
export const UR_TOOL = urM(0, 0, 0, 0, -Math.PI / 2, -Math.PI / 2).multiply(urM(0, 0, 0, Math.PI / 2, 0, Math.PI / 2));

/** Cylinder part of a link, in the link frame: [colour key, axis, radius, from, to, centre-a, centre-b].
 *  centre-a/b are the two coordinates across the axis (x,y for 'z'; y,z for 'x'; x,z for 'y'). */
export type URPart = ['J' | 'L' | 'B' | 'K', 'x' | 'y' | 'z', number, number, number, number, number];

export interface URModel {
  name: string;
  /** Joint origins in the parent link frame. */
  O: THREE.Matrix4[];
  /** Visual parts per link: base, shoulder, upper arm, forearm, wrist 1, wrist 2, wrist 3. */
  parts: URPart[][];
  /** Scene scale (1 = real size in metres). */
  S: number;
  /** Colours by part key, when not the UR ones (J housings, L link tubes, B caps, K rings). */
  colors?: Partial<Record<URPart[0], number>>;
}

export const UR10E: URModel = {
  name: 'UR10e',
  S: 1,
  O: [
    urM(0, 0, 0.1807, 0, 0, 0), urM(0, 0, 0, Math.PI / 2, 0, 0), urM(-0.6127, 0, 0, 0, 0, 0),
    urM(-0.57155, 0, 0.17415, 0, 0, 0), urM(0, -0.11985, 0, Math.PI / 2, 0, 0), urM(0, 0.11655, 0, Math.PI / 2, Math.PI, Math.PI),
  ],
  parts: [
    [['J', 'z', 0.095, 0, 0.085, 0, 0], ['K', 'z', 0.075, 0.085, 0.099, 0, 0]], // base
    [['J', 'z', 0.075, -0.082, 0.03, 0, 0], ['J', 'y', 0.075, -0.08, 0.075, 0, 0], ['B', 'z', 0.0764, 0.028, 0.094, 0, 0],
      ['K', 'y', 0.075, -0.0946, -0.08, 0, 0]], // shoulder
    [['J', 'z', 0.075, 0.095, 0.205, 0, 0], ['B', 'z', 0.076, 0.204, 0.269, 0, 0], ['K', 'x', 0.075, -0.093, -0.08, 0, 0.176],
      ['L', 'x', 0.075, -0.539, -0.093, 0, 0.176], ['K', 'x', 0.058, -0.552, -0.539, 0, 0.176],
      ['J', 'z', 0.058, 0.113, 0.186, -0.6115, 0], ['B', 'z', 0.06, 0.185, 0.248, -0.612, 0], ['K', 'z', 0.058, 0.0986, 0.1128, -0.612, 0]], // upper arm
    [['J', 'z', 0.058, -0.019, 0.099, -0.002, 0], ['K', 'x', 0.058, -0.076, -0.063, 0, 0.039],
      ['L', 'x', 0.058, -0.5085, -0.076, 0, 0.039], ['K', 'x', 0.045, -0.5177, -0.5085, 0, 0.039],
      ['J', 'z', 0.049, 0.029, 0.096, -0.5667, 0], ['B', 'z', 0.047, -0.018, 0.029, -0.5706, 0], ['K', 'z', 0.045, 0.096, 0.106, -0.5706, 0]], // forearm
    [['J', 'y', 0.045, -0.0565, 0.0104, 0, 0], ['J', 'z', 0.045, -0.068, 0, 0, 0], ['B', 'y', 0.047, 0.0104, 0.0575, 0, 0],
      ['K', 'y', 0.045, -0.0666, -0.0565, 0, 0]], // wrist 1
    [['J', 'y', 0.045, -0.0099, 0.057, 0, 0], ['J', 'z', 0.045, -0.0534, 0, 0, 0], ['B', 'y', 0.047, -0.057, -0.0099, 0, 0],
      ['K', 'y', 0.045, 0.057, 0.0679, 0, 0]], // wrist 2
    [['L', 'z', 0.045, -0.049, 0, 0, 0], ['K', 'z', 0.032, -0.052, -0.049, 0, 0]], // wrist 3 / tool flange
  ],
};

/** UR30 (30 kg payload): config/ur30/default_kinematics.yaml and physical_parameters.yaml; housings bulkier than the UR10e. */
export const UR30: URModel = {
  name: 'UR30',
  S: 1,
  O: [
    urM(0, 0, 0.2363, 0, 0, 0), urM(0, 0, 0, Math.PI / 2, 0, 0), urM(-0.637, 0, 0, 0, 0, 0),
    urM(-0.5037, 0, 0.201, 0, 0, 0), urM(0, -0.1593, 0, Math.PI / 2, 0, 0), urM(0, 0.1543, 0, Math.PI / 2, Math.PI, Math.PI),
  ],
  parts: [
    [['J', 'z', 0.1225, 0, 0.11, 0, 0], ['K', 'z', 0.098, 0.11, 0.128, 0, 0]], // base (Ø245 mm footprint)
    [['J', 'z', 0.098, -0.108, 0.04, 0, 0], ['J', 'y', 0.098, -0.14, 0.098, 0, 0], ['B', 'z', 0.1, 0.038, 0.122, 0, 0],
      ['K', 'y', 0.098, -0.155, -0.14, 0, 0]], // shoulder
    [['J', 'z', 0.098, 0.155, 0.298, 0, 0], ['B', 'z', 0.1, 0.296, 0.38, 0, 0], ['K', 'x', 0.098, -0.12, -0.104, 0, 0.26],
      ['L', 'x', 0.098, -0.542, -0.12, 0, 0.26], ['K', 'x', 0.075, -0.556, -0.542, 0, 0.26],
      ['J', 'z', 0.075, 0.155, 0.27, -0.637, 0], ['B', 'z', 0.077, 0.268, 0.35, -0.637, 0]], // upper arm
    [['J', 'z', 0.075, -0.02, 0.155, 0, 0], ['K', 'x', 0.075, -0.098, -0.082, 0, 0.043],
      ['L', 'x', 0.075, -0.4387, -0.098, 0, 0.043], ['K', 'x', 0.058, -0.452, -0.4387, 0, 0.043],
      ['J', 'z', 0.062, 0.035, 0.113, -0.5037, 0], ['B', 'z', 0.064, -0.023, 0.035, -0.5037, 0], ['K', 'z', 0.058, 0.113, 0.126, -0.5037, 0]], // forearm
    [['J', 'y', 0.058, -0.073, 0.013, 0, 0], ['J', 'z', 0.058, -0.088, 0, 0, 0], ['B', 'y', 0.06, 0.013, 0.075, 0, 0],
      ['K', 'y', 0.058, -0.087, -0.073, 0, 0]], // wrist 1
    [['J', 'y', 0.058, -0.013, 0.074, 0, 0], ['J', 'z', 0.058, -0.069, 0, 0, 0], ['B', 'y', 0.06, -0.074, -0.013, 0, 0],
      ['K', 'y', 0.058, 0.074, 0.088, 0, 0]], // wrist 2
    [['L', 'z', 0.058, -0.064, 0, 0, 0], ['K', 'z', 0.042, -0.068, -0.064, 0, 0]], // wrist 3 / tool flange
  ],
};

/**
 * JAKA Zu 50 (50 kg payload, 2.1 m reach): link lengths from JAKA's own URDF (github.com/JAKARobotics/jaka_ros2,
 * jaka_description/urdf/jaka_zu50.urdf): shoulder height 303.5 mm, upper arm 1066 mm, forearm 852 mm, wrist offsets
 * 234.5 / 182 / 165 mm. The same 6-axis layout as the UR arms, written in their frames (joint zeros and signs as in a
 * UR, not JAKA's). The housings are drawn from the UR30 ones scaled to these offsets (Ø290 mm base); the real shapes
 * are JAKA's STL meshes.
 */
export const ZU50: URModel = {
  name: 'JAKA Zu 50',
  S: 1,
  // as JAKA shows it: red joint housings, silver link tubes and caps, grey rings between them
  colors: { J: 0x8a0f17, L: 0xd4d7da, B: 0xe3e5e7, K: 0x9ea3a8 },
  O: [
    urM(0, 0, 0.3035, 0, 0, 0), urM(0, 0, 0, Math.PI / 2, 0, 0), urM(-1.066, 0, 0, 0, 0, 0),
    urM(-0.852, 0, 0.2345, 0, 0, 0), urM(0, -0.182, 0, Math.PI / 2, 0, 0), urM(0, 0.165, 0, Math.PI / 2, Math.PI, Math.PI),
  ],
  parts: [
    [['J', 'z', 0.145, 0, 0.14, 0, 0], ['K', 'z', 0.118, 0.14, 0.163, 0, 0]], // base (Ø290 mm)
    [['J', 'z', 0.118, -0.14, 0.05, 0, 0], ['J', 'y', 0.118, -0.165, 0.115, 0, 0], ['B', 'z', 0.12, 0.048, 0.155, 0, 0],
      ['K', 'y', 0.118, -0.182, -0.165, 0, 0]], // shoulder
    [['J', 'z', 0.118, 0.18, 0.35, 0, 0], ['B', 'z', 0.12, 0.348, 0.445, 0, 0], ['K', 'x', 0.11, -0.14, -0.12, 0, 0.3],
      ['L', 'x', 0.11, -0.96, -0.14, 0, 0.3], ['K', 'x', 0.088, -0.976, -0.96, 0, 0.3],
      ['J', 'z', 0.088, 0.18, 0.32, -1.066, 0], ['B', 'z', 0.09, 0.318, 0.41, -1.066, 0]], // upper arm
    [['J', 'z', 0.088, -0.023, 0.18, 0, 0], ['K', 'x', 0.088, -0.115, -0.096, 0, 0.05],
      ['L', 'x', 0.088, -0.765, -0.115, 0, 0.05], ['K', 'x', 0.07, -0.78, -0.765, 0, 0.05],
      ['J', 'z', 0.07, 0.041, 0.132, -0.852, 0], ['B', 'z', 0.072, -0.027, 0.041, -0.852, 0], ['K', 'z', 0.068, 0.132, 0.147, -0.852, 0]], // forearm
    [['J', 'y', 0.068, -0.083, 0.015, 0, 0], ['J', 'z', 0.068, -0.1, 0, 0, 0], ['B', 'y', 0.07, 0.015, 0.086, 0, 0],
      ['K', 'y', 0.068, -0.1, -0.083, 0, 0]], // wrist 1
    [['J', 'y', 0.068, -0.014, 0.079, 0, 0], ['J', 'z', 0.068, -0.074, 0, 0, 0], ['B', 'y', 0.07, -0.079, -0.014, 0, 0],
      ['K', 'y', 0.068, 0.079, 0.094, 0, 0]], // wrist 2
    [['L', 'z', 0.068, -0.068, 0, 0, 0], ['K', 'z', 0.05, -0.072, -0.068, 0, 0]], // wrist 3 / tool flange
  ],
};

/** Minimal state the solver needs: the model, joint angles and where the base sits in the world. */
export interface URState {
  model: URModel;
  q: number[];
  rootM: THREE.Matrix4;
}

const _m = new THREE.Matrix4(), _rz = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _qi = new THREE.Quaternion();

/** Forward kinematics: world matrix of the frame after joint `upTo` (6 = tool0). The result is a shared temporary. */
export function urFK(ur: URState, q: number[], upTo = 6): THREE.Matrix4 {
  _m.copy(ur.rootM).multiply(UR_BASE);
  for (let i = 0; i < upTo; i++) _m.multiply(ur.model.O[i]).multiply(_rz.makeRotationZ(q[i]));
  if (upTo === 6) _m.multiply(UR_TOOL);
  return _m;
}

/** 6-vector error (position, weighted orientation) between tool0 and the target; returns its norm. */
function urErr(ur: URState, q: number[], tp: THREE.Vector3, tq: THREE.Quaternion, e: number[]) {
  urFK(ur, q).decompose(_p, _q, _s);
  e[0] = tp.x - _p.x; e[1] = tp.y - _p.y; e[2] = tp.z - _p.z;
  _qi.copy(tq).multiply(_q.invert());
  if (_qi.w < 0) { _qi.x = -_qi.x; _qi.y = -_qi.y; _qi.z = -_qi.z; _qi.w = -_qi.w; }
  const W = 2.4;
  e[3] = 2 * _qi.x * W; e[4] = 2 * _qi.y * W; e[5] = 2 * _qi.z * W;
  return Math.hypot(...e);
}

/** Gaussian elimination with partial pivoting (6×6). */
export function solve6(A: number[][], b: number[]): number[] {
  const n = 6, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

const e0 = new Array(6), e1 = new Array(6);
/** Damped least squares IK, warm-started from ur.q (updated in place). Returns the final error. */
export function urIK(ur: URState, tp: THREE.Vector3, tq: THREE.Quaternion, iters: number): number {
  const q = ur.q, J = [...Array(6)].map(() => new Array(6)), d = 1e-4, lam2 = 0.04;
  let err = 0;
  for (let it = 0; it < iters; it++) {
    err = urErr(ur, q, tp, tq, e0);
    if (err < 2e-3) break;
    for (let j = 0; j < 6; j++) {
      q[j] += d; urErr(ur, q, tp, tq, e1); q[j] -= d;
      for (let i = 0; i < 6; i++) J[i][j] = (e0[i] - e1[i]) / d;
    }
    const A = [...Array(6)].map((_, i) => [...Array(6)].map((_, k) => { let s = 0; for (let j = 0; j < 6; j++) s += J[i][j] * J[k][j]; return s + (i === k ? lam2 : 0); }));
    const x = solve6(A, e0);
    for (let j = 0; j < 6; j++) { let s = 0; for (let i = 0; i < 6; i++) s += J[i][j] * x[i]; q[j] += clamp(s, -0.25, 0.25); }
  }
  return err;
}
