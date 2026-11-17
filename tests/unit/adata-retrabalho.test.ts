import { describe, expect, it } from 'vitest';
import { DEFAULT_TOL, NOMINAL, PKG, measureIc } from '../../src/projects/adata-retrabalho/ics';

describe('reworked BGA measurement', () => {
  it('has the 78 balls of an FBGA 78 on a 0.8 mm pitch', () => {
    const ic = measureIc(1);
    expect(ic.balls).toHaveLength(78);
    expect(ic.balls.every(b => Math.abs(b.x) <= PKG.w / 2 && Math.abs(b.y) <= PKG.h / 2)).toBe(true);
  });

  it('is the same package for the same seed', () => {
    expect(measureIc(9)).toEqual(measureIc(9));
  });

  it('a good package is within tolerance', () => {
    const goods = Array.from({ length: 300 }, (_, i) => measureIc(i)).filter(r => r.ok);
    expect(goods.length).toBeGreaterThan(270);
    for (const r of goods) {
      expect(r.coplanarity).toBeLessThanOrEqual(DEFAULT_TOL.copMax);
      expect(r.offMax).toBeLessThanOrEqual(DEFAULT_TOL.offMax);
      expect(r.dMax - NOMINAL.d).toBeLessThanOrEqual(DEFAULT_TOL.dTol);
      expect(r.missing).toBe(0);
    }
  });

  it('a poor rework batch fails many more packages, and each failure names its defects', () => {
    const n = 500;
    const bad = Array.from({ length: n }, (_, i) => measureIc(i, { bad: true }));
    const normal = Array.from({ length: n }, (_, i) => measureIc(i));
    const fails = (rs: typeof bad) => rs.filter(r => !r.ok).length;
    expect(fails(bad)).toBeGreaterThan(fails(normal) * 3);
    for (const r of bad) expect(r.ok).toBe(r.defects.length === 0);
  });

  it('a tighter coplanarity limit rejects more packages', () => {
    const tight = { ...DEFAULT_TOL, copMax: 0.04 };
    const n = 300;
    const a = Array.from({ length: n }, (_, i) => measureIc(i)).filter(r => r.defects.includes('coplanaridade')).length;
    const b = Array.from({ length: n }, (_, i) => measureIc(i, { tol: tight })).filter(r => r.defects.includes('coplanaridade')).length;
    expect(b).toBeGreaterThan(a);
  });
});
