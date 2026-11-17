// A conveyor path made of straight lines and arcs, parametrised by distance s (metres) along it.
import { clamp } from './math';

export interface LineSeg { type: 'line'; x0: number; z0: number; x1: number; z1: number; len: number }
export interface ArcSeg { type: 'arc'; cx: number; cz: number; r: number; a0: number; a1: number; len: number }
export type Seg = LineSeg | ArcSeg;
/** Point on the track: position and heading (radians, atan2(dz, dx)). */
export interface TrackPoint { x: number; z: number; h: number }

export const line = (x0: number, z0: number, x1: number, z1: number): Omit<LineSeg, 'len'> => ({ type: 'line', x0, z0, x1, z1 });
export const arc = (cx: number, cz: number, r: number, a0: number, a1: number): Omit<ArcSeg, 'len'> => ({ type: 'arc', cx, cz, r, a0, a1 });

export class Track {
  readonly segs: Seg[];
  readonly loop: boolean;
  readonly length: number;

  constructor(segs: (Omit<LineSeg, 'len'> | Omit<ArcSeg, 'len'>)[], loop: boolean) {
    this.segs = segs.map(s => ({ ...s, len: s.type === 'line' ? Math.hypot(s.x1 - s.x0, s.z1 - s.z0) : Math.abs(s.a1 - s.a0) * s.r }) as Seg);
    this.loop = loop;
    this.length = this.segs.reduce((a, s) => a + s.len, 0);
  }

  at(s: number): TrackPoint {
    s = this.loop ? ((s % this.length) + this.length) % this.length : clamp(s, 0, this.length);
    for (let i = 0; i < this.segs.length; i++) {
      const g = this.segs[i];
      if (s <= g.len || i === this.segs.length - 1) {
        const u = g.len ? Math.min(1, s / g.len) : 0;
        if (g.type === 'line') {
          const dx = g.x1 - g.x0, dz = g.z1 - g.z0;
          return { x: g.x0 + dx * u, z: g.z0 + dz * u, h: Math.atan2(dz, dx) };
        }
        const a = g.a0 + (g.a1 - g.a0) * u, dir = Math.sign(g.a1 - g.a0);
        return { x: g.cx + g.r * Math.cos(a), z: g.cz + g.r * Math.sin(a), h: Math.atan2(Math.cos(a) * dir, -Math.sin(a) * dir) };
      }
      s -= g.len;
    }
    throw new Error('empty track');
  }

  /** Distance along the track to the point of straight segment `segIndex` at world x. */
  sAtX(segIndex: number, x: number): number {
    let s = 0;
    for (let i = 0; i < segIndex; i++) s += this.segs[i].len;
    const g = this.segs[segIndex];
    if (g.type !== 'line') throw new Error('sAtX needs a straight segment');
    return s + Math.abs(x - g.x0);
  }
}
