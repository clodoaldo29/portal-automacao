import { describe, expect, it } from 'vitest';
import { DIE_GRID, DIE_H, DIE_W, USABLE_R, makeWaferMap } from '../../src/projects/memory-flow/cell/wafer';

describe('wafer die map', () => {
  it('fits every die inside the usable radius', () => {
    expect(DIE_GRID.length).toBeGreaterThan(650);
    expect(DIE_GRID.length).toBeLessThan(900);
    for (const d of DIE_GRID) expect(Math.hypot(Math.abs(d.x) + DIE_W / 2, Math.abs(d.y) + DIE_H / 2)).toBeLessThanOrEqual(USABLE_R + 1e-9);
  });

  it('is the same map for the same seed', () => {
    expect(makeWaferMap(42)).toEqual(makeWaferMap(42));
    expect(makeWaferMap(42)).not.toEqual(makeWaferMap(43));
  });

  it('counts add up and the yield matches', () => {
    const m = makeWaferMap(7);
    expect(m.counts.reduce((a, b) => a + b, 0)).toBe(m.dies.length);
    expect(m.defects).toBe(m.dies.length - m.counts[0]);
    expect(m.yield).toBeCloseTo(m.counts[0] / m.dies.length, 12);
  });

  it('a worn blade gives much more chipping and most wafers are rejected', () => {
    const n = 200;
    const normal = Array.from({ length: n }, (_, i) => makeWaferMap(i));
    const worn = Array.from({ length: n }, (_, i) => makeWaferMap(i, { worn: true }));
    const chip = (ms: typeof normal) => ms.reduce((s, m) => s + m.counts[2], 0) / n;
    expect(chip(worn)).toBeGreaterThan(chip(normal) * 5);
    expect(normal.filter(m => m.ng).length / n).toBeLessThan(0.1);
    expect(worn.filter(m => m.ng).length / n).toBeGreaterThan(0.7);
  });

  it('chipping concentrates on the edge dies', () => {
    let edge = 0, inner = 0, nEdge = 0, nInner = 0;
    for (let s = 0; s < 100; s++) for (const d of makeWaferMap(s, { worn: true }).dies) {
      if (d.edge) { nEdge++; if (d.cls === 2) edge++; } else { nInner++; if (d.cls === 2) inner++; }
    }
    expect(edge / nEdge).toBeGreaterThan((inner / nInner) * 4);
  });
});
