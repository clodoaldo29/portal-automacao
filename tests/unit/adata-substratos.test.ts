import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, STRIP, UNITS, inspectStrip, unitPos } from '../../src/projects/adata-substratos/substrate';

describe('substrate strip inspection', () => {
  it('lays out 80 units inside the strip without overlap', () => {
    expect(UNITS).toBe(80);
    const ps = Array.from({ length: UNITS }, (_, k) => unitPos(k));
    for (const p of ps) { expect(Math.abs(p.x) + 4.5).toBeLessThan(STRIP.l / 2); expect(Math.abs(p.y) + 6.5).toBeLessThan(STRIP.w / 2); }
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      expect(Math.abs(ps[i].x - ps[j].x) >= 9 || Math.abs(ps[i].y - ps[j].y) >= 13).toBe(true);
    }
  });

  it('is the same strip for the same seed, and counts add up', () => {
    const a = inspectStrip(3), b = inspectStrip(3);
    expect(a).toEqual(b);
    expect(a.counts.reduce((s, n) => s + n, 0)).toBe(UNITS);
    expect(a.xouts).toBe(UNITS - a.counts[0]);
  });

  it('a normal lot has few X-outs and almost no NG strips; an oxidised lot is caught by the spectral index', () => {
    const n = 300;
    const normal = Array.from({ length: n }, (_, i) => inspectStrip(i));
    const ox = Array.from({ length: n }, (_, i) => inspectStrip(i, { oxidized: true }));
    expect(normal.filter(s => s.ng).length / n).toBeLessThan(0.05);
    expect(normal.reduce((s, r) => s + r.counts[4], 0)).toBe(0);
    expect(ox.filter(s => s.ng).length / n).toBeGreaterThan(0.8);
    expect(ox.reduce((s, r) => s + r.oxMean, 0) / n).toBeGreaterThan(normal.reduce((s, r) => s + r.oxMean, 0) / n * 2);
  });

  it('a stricter oxidation limit marks more units', () => {
    const n = 200, strict = { ...DEFAULT_LIMITS, oxLimit: 0.2 };
    const a = Array.from({ length: n }, (_, i) => inspectStrip(i, { oxidized: true })).reduce((s, r) => s + r.counts[4], 0);
    const b = Array.from({ length: n }, (_, i) => inspectStrip(i, { oxidized: true, limits: strict })).reduce((s, r) => s + r.counts[4], 0);
    expect(b).toBeGreaterThan(a);
  });
});
