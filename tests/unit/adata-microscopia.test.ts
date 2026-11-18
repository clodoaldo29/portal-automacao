import { describe, expect, it } from 'vitest';
import { DEFAULT_MICRO, lotDefects, lotTime } from '../../src/projects/adata-microscopia/model';

describe('microscope stations model', () => {
  it('the digital bench spends far less time recording and finishes lots faster', () => {
    const a = lotTime(DEFAULT_MICRO, 'hoje'), b = lotTime(DEFAULT_MICRO, 'digital');
    expect(b.total).toBeLessThan(a.total);
    expect(b.record).toBeLessThan(a.record / 5);
    // today: 20 × 20 s + 90 + 2.4 × 35 + 30 + 180
    expect(a.total).toBeCloseTo(20 * 20 + 90 + 2.4 * 35 + 30 + 180, 9);
  });

  it('both benches see the same samples of a lot (same seed)', () => {
    expect(lotDefects(7, DEFAULT_MICRO)).toEqual(lotDefects(7, DEFAULT_MICRO));
    expect(lotDefects(7, DEFAULT_MICRO)).toHaveLength(DEFAULT_MICRO.samples);
  });

  it('the defect share follows the rate, and a problem lot has more defects', () => {
    const n = 400, count = (f: number) => Array.from({ length: n }, (_, i) => lotDefects(i, DEFAULT_MICRO, f)).flat().filter(Boolean).length;
    const share = count(1) / (n * DEFAULT_MICRO.samples);
    expect(share).toBeGreaterThan(0.09);
    expect(share).toBeLessThan(0.15);
    expect(count(3)).toBeGreaterThan(count(1) * 2.5);
  });
});
