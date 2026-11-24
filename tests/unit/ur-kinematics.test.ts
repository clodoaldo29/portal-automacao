import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { UR10E, UR30, ZU50, solve6, urFK, urIK, type URModel, type URState } from '../../src/sim/robots/ur-kinematics';

// deterministic pseudo-random numbers so a failure can be reproduced
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

const state = (model: URModel, q: number[]): URState => ({ model, q, rootM: new THREE.Matrix4() });

describe('solve6', () => {
  it('solves a 6×6 linear system', () => {
    const r = rng(1);
    const A = [...Array(6)].map((_, i) => [...Array(6)].map((_, j) => (i === j ? 4 : 0) + r() - 0.5));
    const x = [1, -2, 3, 0.5, -0.25, 2];
    const b = A.map(row => row.reduce((s, v, j) => s + v * x[j], 0));
    solve6(A, b).forEach((v, i) => expect(v).toBeCloseTo(x[i], 9));
  });
});

describe.each([UR10E, UR30, ZU50])('%s kinematics', model => {
  it('puts the zero-pose flange where the DH parameters say', () => {
    // all joints at zero: arm stretched along x (a2 + a3), wrist offsets d4 + d6 sideways, height d1 - d5
    const p = new THREE.Vector3().setFromMatrixPosition(urFK(state(model, [0, 0, 0, 0, 0, 0]), [0, 0, 0, 0, 0, 0]));
    const o = model.O.map(m => new THREE.Vector3().setFromMatrixPosition(m));
    const a2 = -o[2].x, a3 = -o[3].x, d1 = o[0].z, d4 = o[3].z, d5 = -o[4].y, d6 = o[5].y;
    expect(Math.abs(p.x)).toBeCloseTo(a2 + a3, 6);
    expect(Math.abs(p.y)).toBeCloseTo(d4 + d6, 6);
    expect(p.z).toBeCloseTo(d1 - d5, 6);
  });

  it('IK recovers random reachable poses from a nearby start', () => {
    const r = rng(model === UR30 ? 30 : 10);
    for (let n = 0; n < 40; n++) {
      // elbow bent, away from the stretched-out singularity
      const qt = [r() * 6 - 3, -0.4 - r() * 2.2, (r() < 0.5 ? 1 : -1) * (0.5 + r() * 2.2), r() * 6 - 3, r() * 2.4 + 0.3, r() * 6 - 3];
      const target = urFK(state(model, qt), qt).clone();
      const tp = new THREE.Vector3(), tq = new THREE.Quaternion(), s = new THREE.Vector3();
      target.decompose(tp, tq, s);
      const ur = state(model, qt.map(v => v + (r() - 0.5) * 0.3));
      const err = urIK(ur, tp, tq, 200);
      expect(err).toBeLessThan(2e-3);
      const got = new THREE.Vector3().setFromMatrixPosition(urFK(ur, ur.q));
      expect(got.distanceTo(tp)).toBeLessThan(2e-3);
    }
  });
});
