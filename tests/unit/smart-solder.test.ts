import { describe, expect, it } from 'vitest';
import {
  CELLS_B, DEFAULT_SOLDER, LINE, PALLET_FIT, ST, blankJoints, blankS, blankSize, boardCenters, capacityA, groupIndexS, pcbSize, strategiesB, type SolderParams,
} from '../../src/projects/smart-solder/model';

const P = (o: Partial<SolderParams> = {}): SolderParams => ({ ...DEFAULT_SOLDER, cells: [...DEFAULT_SOLDER.cells], ...o });

describe('Smart Solder AI · blank', () => {
  it('has every joint of every PCB inside the blank, once', () => {
    for (let boards = 1; boards <= 10; boards++) for (const points of [4, 10, 20]) {
      const { l, w } = blankSize(boards), js = blankJoints(boards, points);
      expect(js).toHaveLength(boards * points);
      expect(js.every(j => Math.abs(j.x) < l / 2 && Math.abs(j.z) < w / 2)).toBe(true);
      expect(new Set(js.map(j => `${j.x.toFixed(4)},${j.z.toFixed(4)}`)).size).toBe(js.length);
      for (let b = 0; b < boards; b++) expect(js.filter(j => j.board === b)).toHaveLength(points);
    }
  });

  it('solders board by board (no jumping back to a finished PCB)', () => {
    const order = blankJoints(10, 10).map(j => j.board).filter((b, i, a) => i === 0 || b !== a[i - 1]);
    expect(new Set(order).size).toBe(order.length);
  });

  it('several PCBs per blank: the remote control PCB, the same blank as before', () => {
    for (const points of [4, 10, 30, 100]) {
      expect(pcbSize(6, points)).toMatchObject({ l: 0.16, w: 0.045, fixed: true });
      expect(blankSize(6, points).w).toBeCloseTo(3 * 0.05 + 2 * 0.015);
    }
  });

  it('a single PCB grows with its joints, keeps them apart and fits the pallet while it can', () => {
    const sizes = [4, 10, 20, 40, 60, 80, 100].map(p => pcbSize(1, p));
    for (let i = 1; i < sizes.length; i++) expect(sizes[i].l * sizes[i].w).toBeGreaterThanOrEqual(sizes[i - 1].l * sizes[i - 1].w);
    expect(sizes[0]).toMatchObject({ l: 0.16, w: 0.045 });
    for (const points of [1, 4, 10, 30, 60, 100]) {
      const pcb = pcbSize(1, points), b = blankSize(1, points), js = blankJoints(1, points);
      expect(js).toHaveLength(points);
      if (pcb.fits) { expect(b.l).toBeLessThanOrEqual(PALLET_FIT.l + 1e-9); expect(b.w).toBeLessThanOrEqual(PALLET_FIT.w + 1e-9); }
      expect(js.every(j => Math.abs(j.x) < b.l / 2 && Math.abs(j.z) < b.w / 2)).toBe(true);
      let min = Infinity;
      for (let i = 0; i < js.length; i++) for (let k = i + 1; k < js.length; k++) min = Math.min(min, Math.hypot(js[i].x - js[k].x, js[i].z - js[k].z));
      if (points > 1) expect(min).toBeGreaterThanOrEqual(0.005 - 1e-9); // LED legs are 5 mm apart, the rest at least the minimum pitch
    }
    expect(pcbSize(1, 100).fits).toBe(true);
  });

  it('PCBs do not overlap', () => {
    const c = boardCenters(10);
    for (let i = 0; i < c.length; i++) for (let k = i + 1; k < c.length; k++) {
      const apart = Math.abs(c[i].x - c[k].x) >= 0.16 || Math.abs(c[i].z - c[k].z) >= 0.045;
      expect(apart).toBe(true);
    }
  });
});

describe('Smart Solder AI · capacity', () => {
  it('both architectures reach the 350 UPH target with the default (provisional) values', () => {
    expect(strategiesB(P())[0].uph).toBeGreaterThanOrEqual(350);
    expect(capacityA(P()).uph).toBeGreaterThanOrEqual(350);
  });

  it('B: the group of three is faster than splitting the joints in series, for any blank size', () => {
    for (let boards = 1; boards <= 10; boards++) for (const pointS of [1.5, 2.5, 5]) {
      const [group, series] = strategiesB(P({ boards, pointS }));
      expect(group.uph).toBeGreaterThan(series.uph);
    }
  });

  it('B and A: the active robots get the same share of the work', () => {
    expect(strategiesB(P())[0].share).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(strategiesB(P({ cells: [true, false, true] }))[0].share).toEqual([0.5, 0, 0.5]);
  });

  it('B: the group rides from the buffer to the farthest active cell', () => {
    expect(groupIndexS(P())).toBeCloseTo((CELLS_B[2] - ST.buffer) / LINE.speed);
    expect(groupIndexS(P({ cells: [true, true, false] }))).toBeCloseTo((CELLS_B[1] - ST.buffer) / LINE.speed);
  });

  it('turning a cell off takes about a third of the capacity away', () => {
    const three = strategiesB(P())[0].uph, two = strategiesB(P({ cells: [true, true, false] }))[0].uph;
    expect(two / three).toBeGreaterThan(0.6);
    expect(two / three).toBeLessThan(0.72);
    expect(capacityA(P({ cells: [true, false, true] })).uph / capacityA(P()).uph).toBeCloseTo(2 / 3);
  });

  it('A: the cartesians limit the line, the arm has room to spare', () => {
    const c = capacityA(P());
    expect(c.bottleneck).toBe('cartesianos');
    expect(c.cobotLoad).toBeLessThan(0.4);
    // very short soldering: the arm becomes the bottleneck
    expect(capacityA(P({ boards: 4, points: 2, pointS: 1.5 })).bottleneck).toBe('cobot');
  });

  it('one blank takes the soldering of all its joints plus the alignment', () => {
    expect(blankS(P())).toBe(6 * 10 * 2.5 + 3);
  });
});
