import { describe, expect, it } from 'vitest';
import { EventQueue, createRng } from '../../src/sim/des';
import { createLaneGraph, pointAlong } from '../../src/sim/paths';

describe('lane graph', () => {
  // an L of corridors plus a crossing lane, with a door on one branch
  const lanes = [
    { a: { x: 0, z: 0 }, b: { x: 10, z: 0 } },
    { a: { x: 10, z: 0 }, b: { x: 10, z: 10 } },
    { a: { x: 5, z: -5 }, b: { x: 5, z: 5 } },
    { a: { x: 5, z: 5 }, b: { x: 5, z: 6 }, door: true },
    { a: { x: 5, z: 6 }, b: { x: 5, z: 9 } },
  ];
  const g = createLaneGraph(lanes, { A: { x: 0, z: 0 }, B: { x: 10, z: 10 }, port: { x: 7, z: 1.5 }, C: { x: 5, z: 9 }, D: { x: 5, z: -5 } });

  it('routes along the lanes, joining at crossings and ends', () => {
    const r = g.route(g.nodeOf('A'), g.nodeOf('B'));
    expect(r.length).toBeCloseTo(20, 9);
    expect(r.pts[0]).toEqual({ x: 0, z: 0 });
    expect(r.pts[r.pts.length - 1]).toEqual({ x: 10, z: 10 });
    expect(g.route(g.nodeOf('D'), g.nodeOf('A')).length).toBeCloseTo(10, 9);
  });

  it('links a point to the nearest lane with a stub and counts doors', () => {
    expect(g.route(g.nodeOf('A'), g.nodeOf('port')).length).toBeCloseTo(8.5, 9);
    const r = g.route(g.nodeOf('A'), g.nodeOf('C'));
    expect(r.length).toBeCloseTo(14, 9);
    expect(r.doors).toBe(1);
  });

  it('gives the position and heading along a route', () => {
    const r = g.route(g.nodeOf('A'), g.nodeOf('B'));
    expect(pointAlong(r, 4)).toEqual({ x: 4, z: 0, dx: 1, dz: 0 });
    const p = pointAlong(r, 15);
    expect([p.x, p.z, p.dx, p.dz]).toEqual([10, 5, 0, 1]);
    expect(pointAlong(r, 99)).toMatchObject({ x: 10, z: 10 });
  });
});

describe('discrete events', () => {
  it('runs events in time order, ties in scheduling order', () => {
    const q = new EventQueue(), log: string[] = [];
    q.at(5, () => log.push('b'));
    q.at(1, () => { log.push('a'); q.in(4, () => log.push('c')); });
    q.at(9, () => log.push('d'));
    q.runUntil(6);
    expect(log).toEqual(['a', 'b', 'c']);
    expect(q.now).toBe(6);
    q.runUntil(10);
    expect(log).toEqual(['a', 'b', 'c', 'd']);
  });

  it('seeded generator repeats and stays in [0, 1)', () => {
    const a = createRng(7), b = createRng(7);
    const xs = Array.from({ length: 1000 }, a);
    expect(xs).toEqual(Array.from({ length: 1000 }, b));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
  });
});
