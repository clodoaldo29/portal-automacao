import { describe, expect, it } from 'vitest';
import { blockers, current, diff, editParam, inUse, outOfRange, routeFor, sampleProducts, stageOf } from '../../src/projects/adata-npi/data';

describe('NPI platform rules', () => {
  it('the route follows the plant: burn-in only for DRAM', () => {
    expect(routeFor('DDR4')).toContain('BIN');
    expect(routeFor('EMMC')).not.toContain('BIN');
    expect(routeFor('DDR5')[0]).toBe('REC');
  });

  it('sample products sit at different stages of the workflow', () => {
    const [a, b, c] = sampleProducts();
    expect(stageOf(a)).toBe('liberado');
    expect(stageOf(b)).toBe('aprovacao');
    expect(stageOf(c)).toBe('receitas');
    expect(blockers(b)).toEqual([]);
    expect(blockers(c).length).toBeGreaterThan(0);
  });

  it('editing an approved recipe opens a new draft; the machines keep the approved version', () => {
    const p = sampleProducts()[1], r = p.recipes.find(x => x.step === 'WB')!;
    const before = current(r);
    const v = editParam(r, 'us', 95, 'eng', '2026-11-18');
    expect(v.v).toBe(before.v + 1);
    expect(v.status).toBe('rascunho');
    expect(inUse(r)).toBe(before);
    expect(diff(before, v)).toEqual([{ key: 'us', name: 'Potência ultrassônica', unit: 'mW', from: 90, to: 95 }]);
    // a second change edits the same draft
    editParam(r, 'loop', 160, 'eng', '2026-11-18');
    expect(r.versions).toHaveLength(2);
    expect(stageOf(p)).toBe('receitas');
    expect(blockers(p).some(b => b.includes('Wire bonding'))).toBe(true);
  });

  it('flags values out of the allowed range', () => {
    const r = sampleProducts()[1].recipes.find(x => x.step === 'RFL')!;
    const v = editParam(r, 'pico', 300, 'eng', '2026-11-18');
    expect(outOfRange(v).map(x => x.key)).toEqual(['pico']);
  });
});
