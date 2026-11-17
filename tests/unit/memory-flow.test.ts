import { describe, expect, it } from 'vitest';
import { createEngine, plantGraph, runScenario } from '../../src/projects/memory-flow/engine';
import { AREAS, EQUIPMENT, RACKS } from '../../src/projects/memory-flow/layout';
import { DEFAULT_PARAMS, STEPS, cloneParams } from '../../src/projects/memory-flow/process';

describe('memory-flow layout', () => {
  it('has the 219 equipment of the plan, split by group as on sheet 06', () => {
    const counted = EQUIPMENT.filter(e => e.counted);
    expect(counted.length).toBe(219);
    const n = (pred: (a: string) => boolean) => counted.filter(e => pred(e.area)).length;
    expect(n(a => a.startsWith('P01'))).toBe(47);
    expect(n(a => a.startsWith('P02'))).toBe(22);
    expect(n(a => a === 'P03')).toBe(11);
    expect(n(a => a === 'T01')).toBe(14);
    expect(n(a => a === 'T02')).toBe(10);
    expect(n(a => a === 'Q01')).toBe(9);
    expect(n(a => a === 'L05')).toBe(6);
    expect(n(a => /^L0[1-4]$/.test(a))).toBe(13);
    expect(n(a => a === 'M01' || a === 'Q02')).toBe(9);
    expect(n(a => a.startsWith('F'))).toBe(78);
  });

  it('keeps every piece of equipment inside its area and clear of the others', () => {
    for (const e of EQUIPMENT) {
      const a = AREAS.find(x => x.id === e.area)!;
      expect(e.x - e.w / 2, `${e.area}-${e.tag}`).toBeGreaterThanOrEqual(a.x0 - 0.05);
      expect(e.x + e.w / 2, `${e.area}-${e.tag}`).toBeLessThanOrEqual(a.x1 + 0.05);
      expect(e.z - e.d / 2, `${e.area}-${e.tag}`).toBeGreaterThanOrEqual(a.z0 - 0.05);
      expect(e.z + e.d / 2, `${e.area}-${e.tag}`).toBeLessThanOrEqual(a.z1 + 0.05);
    }
    for (let i = 0; i < EQUIPMENT.length; i++) for (let j = i + 1; j < EQUIPMENT.length; j++) {
      const a = EQUIPMENT[i], b = EQUIPMENT[j];
      const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.01 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 0.01;
      expect(overlap, `${a.area}-${a.tag} × ${b.area}-${b.tag}`).toBe(false);
    }
  });

  it('connects every load port, shelf and the dock', () => {
    const g = plantGraph();
    const dock = g.nodeOf('dock');
    for (const s of STEPS) {
      expect(isFinite(g.distance(dock, g.nodeOf(`rack:${s.area}`))), s.area).toBe(true);
      expect(RACKS[s.area], s.area).toBeDefined();
    }
  });
});

describe('memory-flow engine', () => {
  it('conserves lots: released = shipped + in process', () => {
    const e = createEngine({ params: DEFAULT_PARAMS, scenario: 'atual' });
    e.advanceTo(10 * 1440);
    const released = Math.floor((10 * 1440) / (1440 / DEFAULT_PARAMS.release)) + 1;
    const m = e.metrics();
    expect(m.lotsOut + e.lots.length).toBe(released);
    for (const mc of e.machines) expect(mc.lots.length).toBeLessThanOrEqual(mc.slots);
  });

  it('is deterministic for a seed', () => {
    const a = runScenario(DEFAULT_PARAMS, 'atual', 5), b = runScenario(DEFAULT_PARAMS, 'atual', 5);
    expect(a).toEqual(b);
  });

  // Flow reference: 14 simulated days after a 7-day warm-up, default (provisional) parameters, seed 1.
  // Same table as tests/e2e/memory-flow.spec.ts. When the model or the defaults change on purpose,
  // re-measure and update both tables in the same commit.
  const REFERENCE = [
    { scenario: 'atual', lotsOut: 189, leadTimeH: 67.9, bottleneck: 'INS' },
    { scenario: 'amr', lotsOut: 187, leadTimeH: 64.3, bottleneck: 'INS' },
    { scenario: 'amr-ia', lotsOut: 190, leadTimeH: 62.1, bottleneck: 'DAB' },
  ] as const;
  for (const ref of REFERENCE) {
    it(`${ref.scenario}: flow matches the reference`, () => {
      const m = runScenario(DEFAULT_PARAMS, ref.scenario, 14);
      expect({ scenario: ref.scenario, lotsOut: m.lotsOut, leadTimeH: Math.round(m.leadTimeH * 10) / 10, bottleneck: m.bottleneck }).toEqual(ref);
    });
  }

  it('above capacity, the manual scenario falls behind and the AMR scenarios keep up', () => {
    const hi = cloneParams(DEFAULT_PARAMS);
    hi.release = 18;
    const [atual, amr, ia] = (['atual', 'amr', 'amr-ia'] as const).map(s => runScenario(hi, s));
    expect(atual.lotsPerDay).toBeLessThan(16);
    expect(amr.lotsPerDay).toBeGreaterThan(atual.lotsPerDay);
    expect(ia.lotsPerDay).toBeGreaterThan(17);
    expect(ia.leadTimeH).toBeLessThan(atual.leadTimeH);
  });
});
