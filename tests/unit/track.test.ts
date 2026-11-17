import { describe, expect, it } from 'vitest';
import { Track, arc, line } from '../../src/sim/track';

describe('Track', () => {
  it('measures and walks a straight line', () => {
    const t = new Track([line(-8.3, 1.05, 5.1, 1.05)], false);
    expect(t.length).toBeCloseTo(13.4, 9);
    expect(t.at(0)).toMatchObject({ x: -8.3, z: 1.05, h: 0 });
    expect(t.at(5).x).toBeCloseTo(-3.3, 9);
    expect(t.sAtX(0, -2)).toBeCloseTo(6.3, 9);
  });

  it('clamps an open track and wraps a loop', () => {
    const open = new Track([line(0, 0, 10, 0)], false);
    expect(open.at(-1).x).toBe(0);
    expect(open.at(12).x).toBe(10);
    const loop = new Track([line(0, 0, 10, 0), arc(10, 1, 1, -Math.PI / 2, Math.PI / 2), line(10, 2, 0, 2), arc(0, 1, 1, Math.PI / 2, 1.5 * Math.PI)], true);
    expect(loop.length).toBeCloseTo(20 + 2 * Math.PI, 9);
    const p = loop.at(loop.length + 3);
    expect(p.x).toBeCloseTo(3, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });

  it('gives arc points on the circle with a tangent heading', () => {
    const t = new Track([arc(0, 0, 2, 0, Math.PI / 2)], false);
    const p = t.at(t.length / 2);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(2, 9);
    // tangent is perpendicular to the radius
    expect(Math.cos(p.h) * p.x + Math.sin(p.h) * p.z).toBeCloseTo(0, 9);
  });
});
