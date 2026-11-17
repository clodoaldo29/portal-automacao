// Accumulation conveyor model: items ride the belt at constant speed, keep a minimum gap from the item ahead,
// and stop at stations (stoppers) whose rule asks for it. A held item stays until its `hold` is cleared.
import type * as THREE from 'three';
import type { Track } from './track';

export interface Station<I extends LineItem = LineItem> {
  /** Distance along the track. */
  s: number;
  /** Called once when an item reaches the station: true stops it there. */
  shouldStop: (it: I) => boolean;
  /** Called when the item stops at the station. */
  arrive: (it: I) => void;
}

export interface LineItem {
  obj: THREE.Object3D;
  /** Distance along the track. */
  s: number;
  /** Station holding the item, or null while it moves. */
  hold: Station<any> | null;
  /** Stations already passed (each one decides once per item). */
  passed: Set<Station<any>>;
}

export interface Line<I extends LineItem = LineItem> {
  track: Track;
  /** Belt speed, m/s. */
  speed: number;
  /** Minimum distance between consecutive items (item length + clearance). */
  gap: number;
  /** Belt texture, scrolled to show motion (texture tile: 0.25 m). */
  tex: THREE.Texture | null;
  items: I[];
  stations: Station<I>[];
  /** Height of the belt top where items sit. */
  y: number;
  /** Called when an item rides off the end of an open (non-loop) line, after it is taken off `items`. */
  onExit: (it: I) => void;
}

export function makeLine<I extends LineItem>(opts: Pick<Line<I>, 'track' | 'speed' | 'gap' | 'tex' | 'y' | 'onExit'>): Line<I> {
  return { ...opts, items: [], stations: [] };
}

export function station<I extends LineItem>(L: Line<I>, s: number, shouldStop: (it: I) => boolean, arrive: (it: I) => void): Station<I> {
  const st = { s, shouldStop, arrive };
  L.stations.push(st);
  return st;
}

/** Advance every item by dt seconds and place its 3D object on the track. */
export function updateLine<I extends LineItem>(L: Line<I>, dt: number) {
  if (L.tex) L.tex.offset.x = (L.tex.offset.x - L.speed * dt / 0.25) % 1;
  const len = L.track.length, arr = L.items.slice().sort((a, b) => b.s - a.s);
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    if (!it.hold) {
      let ns = it.s + L.speed * dt;
      let ahead: I | null = null, aheadS = 0;
      if (i > 0) { ahead = arr[i - 1]; aheadS = ahead.s; }
      else if (L.track.loop && arr.length > 1) { ahead = arr[arr.length - 1]; aheadS = ahead.s + len; }
      if (ahead) ns = Math.max(it.s, Math.min(ns, aheadS - L.gap));
      for (const st of L.stations) {
        if (it.passed.has(st)) continue;
        if (it.s <= st.s + 1e-6 && ns >= st.s) {
          it.passed.add(st);
          if (st.shouldStop(it)) { ns = st.s; it.hold = st; st.arrive(it); break; }
        }
      }
      if (L.track.loop && ns >= len) { ns -= len; it.passed.clear(); }
      it.s = ns;
      if (!L.track.loop && it.s >= len) {
        L.items.splice(L.items.indexOf(it), 1);
        L.onExit(it);
        continue;
      }
    }
    const p = L.track.at(it.s);
    it.obj.position.set(p.x, L.y, p.z);
    it.obj.rotation.y = -p.h;
  }
}
