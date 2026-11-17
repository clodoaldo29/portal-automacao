import { describe, expect, it } from 'vitest';
import { oee, pct, uph } from '../../src/sim/kpi';

describe('kpi', () => {
  it('UPH needs 30 s of data, then scales to an hour', () => {
    expect(uph(10, 20)).toBeNull();
    expect(uph(88, 600)).toBeCloseTo(528, 9);
  });

  it('OEE multiplies availability, capped performance and quality', () => {
    const o = oee({ lineUph: 528, target: 600, good: 90, inspected: 90 });
    expect(o.performance).toBeCloseTo(0.88, 9);
    expect(o.quality).toBe(1);
    expect(o.oee).toBeCloseTo(0.88, 9);
    expect(oee({ lineUph: 700, target: 600, good: 9, inspected: 10 }).oee).toBeCloseTo(0.9, 9);
  });

  it('OEE is unknown until there is output and inspection data', () => {
    expect(oee({ lineUph: null, target: 600, good: 0, inspected: 0 })).toEqual({ availability: 1, performance: null, quality: null, oee: null });
    expect(pct(0.876)).toBe('88%');
  });
});
