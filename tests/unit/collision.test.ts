import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { armClearance, obstacleBox } from '../../src/sim/robots/collision';
import type { Cobot } from '../../src/sim/robots/ur-arm';

// Only the tool boxes are checked here (an arm without the UR model has no links).
const noArm = { ur: null } as unknown as Cobot;
const box = (x: number, y: number, z: number, s: number) => new THREE.Box3(new THREE.Vector3(x - s / 2, y - s / 2, z - s / 2), new THREE.Vector3(x + s / 2, y + s / 2, z + s / 2));

describe('collision check', () => {
  it('gives the gap to the nearest obstacle and names it', () => {
    const obs = [obstacleBox('mesa', 0, 0.5, 0, 1, 1, 1), obstacleBox('poste', 3, 1, 0, 0.1, 2, 0.1)];
    const c = armClearance(noArm, obs, [box(0, 1.2, 0, 0.2)]);
    expect(c.min).toBeCloseTo(0.1, 9);
    expect(c.name).toBe('mesa');
    expect(c.part).toBe('ferramenta 1');
  });

  it('is negative when the tool goes into an obstacle', () => {
    const c = armClearance(noArm, [obstacleBox('mesa', 0, 0.5, 0, 1, 1, 1)], [box(0, 0.95, 0, 0.2)]);
    expect(c.min).toBeCloseTo(-0.15, 9);
  });
});
