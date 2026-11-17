import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeLine, station, updateLine, type LineItem } from '../../src/sim/line';
import { Track, line } from '../../src/sim/track';

const item = (s: number): LineItem => ({ obj: new THREE.Object3D(), s, hold: null, passed: new Set() });

function belt(exits: LineItem[] = []) {
  return makeLine<LineItem>({ track: new Track([line(0, 0, 20, 0)], false), speed: 1, gap: 2.4, tex: null, y: 0.88, onExit: it => exits.push(it) });
}
const run = (L: ReturnType<typeof belt>, seconds: number) => { for (let i = 0; i < seconds * 30; i++) updateLine(L, 1 / 30); };

describe('accumulation line', () => {
  it('moves items at belt speed and places them on the track', () => {
    const L = belt();
    const a = item(0);
    L.items.push(a);
    run(L, 3);
    expect(a.s).toBeCloseTo(3, 6);
    expect(a.obj.position.x).toBeCloseTo(3, 6);
    expect(a.obj.position.y).toBe(0.88);
  });

  it('stops at a station that asks for it and queues the next item one gap behind', () => {
    const L = belt();
    const st = station(L, 10, () => true, () => {});
    const a = item(4), b = item(0);
    L.items.push(a, b);
    run(L, 15);
    expect(a.s).toBe(10);
    expect(a.hold).toBe(st);
    expect(b.s).toBeCloseTo(10 - 2.4, 6);
    a.hold = null; // released: both move on, and b does not stop again at a station it has passed
    run(L, 2);
    expect(a.s).toBeCloseTo(12, 6);
  });

  it('asks each station once per item and lets items pass when it says no', () => {
    const L = belt();
    let asked = 0;
    station(L, 5, () => { asked++; return false; }, () => {});
    L.items.push(item(0));
    run(L, 8);
    expect(asked).toBe(1);
    expect(L.items[0].s).toBeCloseTo(8, 6);
  });

  it('takes items off at the end of an open line and reports them', () => {
    const exits: LineItem[] = [];
    const L = belt(exits);
    const a = item(19);
    L.items.push(a);
    run(L, 2);
    expect(L.items).toHaveLength(0);
    expect(exits).toEqual([a]);
  });
});
