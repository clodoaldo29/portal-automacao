import { describe, expect, it } from 'vitest';
import { PLACEMENTS, overlaps } from '../../src/projects/memory-flow/in-plant';
import { AREAS, EQUIPMENT } from '../../src/projects/memory-flow/layout';

describe('project cells placed in the plant', () => {
  for (const p of Object.values(PLACEMENTS)) {
    it(`${p.slug}: fits in ${p.area} and no remaining equipment sits inside the cell`, () => {
      const a = AREAS.find(x => x.id === p.area)!;
      const [fx0, fx1, fz0, fz1] = p.footprint;
      expect(p.x + fx0).toBeGreaterThanOrEqual(a.x0);
      expect(p.x + fx1).toBeLessThanOrEqual(a.x1);
      expect(p.z + fz0).toBeGreaterThanOrEqual(a.z0);
      expect(p.z + fz1).toBeLessThanOrEqual(a.z1);
      expect(overlaps(p).map(e => `${e.area}-${e.tag}`)).toEqual([]);
      // what it replaces really exists in that area
      for (const t of p.replaces) expect(EQUIPMENT.some(e => e.area === p.area && e.tag === t), t).toBe(true);
    });
  }
});
