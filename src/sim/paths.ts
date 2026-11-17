// Floor routes for carts, AGVs and AMRs: a graph built from straight lanes (corridors), shortest paths between
// named points, and position along a route. Plan coordinates in metres (x, z). No DOM, no three.js.

export interface P2 { x: number; z: number }
/** A straight lane. A door lane is a short segment that crosses a wall (pass box, automatic door). */
export interface Lane { a: P2; b: P2; door?: boolean }
export interface Route { pts: P2[]; length: number; doors: number }

interface Edge { to: number; w: number; door: boolean }

const EPS = 1e-6;
const key = (p: P2) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`;

/** Parameter t of the projection of p on segment ab (clamped to [0, 1]) and the distance to it. */
function project(p: P2, a: P2, b: P2) {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
  const q = { x: a.x + dx * t, z: a.z + dz * t };
  return { t, q, d: Math.hypot(p.x - q.x, p.z - q.z) };
}

/** Intersection parameters of segments ab and cd, or null when they do not cross. */
function cross(a: P2, b: P2, c: P2, d: P2) {
  const r = { x: b.x - a.x, z: b.z - a.z }, s = { x: d.x - c.x, z: d.z - c.z };
  const den = r.x * s.z - r.z * s.x;
  if (Math.abs(den) < EPS) return null;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den, u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
  return t > -EPS && t < 1 + EPS && u > -EPS && u < 1 + EPS ? { t, u } : null;
}

/**
 * Build the graph. Lanes are joined where they cross or where one ends on another. Each named point is linked to
 * the nearest lane by a short stub (a machine's load port to its corridor, for example).
 */
export function createLaneGraph(lanes: Lane[], points: Record<string, P2>) {
  const pos: P2[] = [], adj: Edge[][] = [], ids = new Map<string, number>();
  const node = (p: P2) => {
    const k = key(p);
    let id = ids.get(k);
    if (id == null) { id = pos.length; ids.set(k, id); pos.push({ x: p.x, z: p.z }); adj.push([]); }
    return id;
  };
  const link = (a: number, b: number, door: boolean) => {
    if (a === b) return;
    const w = Math.hypot(pos[a].x - pos[b].x, pos[a].z - pos[b].z);
    adj[a].push({ to: b, w, door });
    adj[b].push({ to: a, w, door });
  };

  // split points along each lane: its ends, crossings with other lanes, and where named points attach
  const splits: number[][] = lanes.map(() => [0, 1]);
  lanes.forEach((l, i) => lanes.forEach((m, j) => {
    if (j <= i) return;
    const c = cross(l.a, l.b, m.a, m.b);
    if (c) { splits[i].push(c.t); splits[j].push(c.u); }
  }));
  const named = new Map<string, number>();
  const stubs: [string, P2][] = [];
  for (const [name, p] of Object.entries(points)) {
    let best = -1, bt = 0, bd = Infinity;
    lanes.forEach((l, i) => { if (l.door) return; const pr = project(p, l.a, l.b); if (pr.d < bd - EPS) { bd = pr.d; best = i; bt = pr.t; } });
    if (best < 0) throw new Error(`no lane for point ${name}`);
    splits[best].push(bt);
    const l = lanes[best];
    stubs.push([name, { x: l.a.x + (l.b.x - l.a.x) * bt, z: l.a.z + (l.b.z - l.a.z) * bt }]);
  }
  lanes.forEach((l, i) => {
    const ts = [...new Set(splits[i].map(t => Math.min(1, Math.max(0, t)).toFixed(6)))].map(Number).sort((a, b) => a - b);
    const ns = ts.map(t => node({ x: l.a.x + (l.b.x - l.a.x) * t, z: l.a.z + (l.b.z - l.a.z) * t }));
    for (let k = 1; k < ns.length; k++) link(ns[k - 1], ns[k], !!l.door);
  });
  for (const [name, q] of stubs) {
    const on = node(q), p = points[name];
    if (Math.hypot(p.x - q.x, p.z - q.z) < 1e-3) { named.set(name, on); continue; }
    const id = node(p);
    link(id, on, false);
    named.set(name, id);
  }

  // shortest-path trees, computed once per source and cached
  const trees = new Map<number, { dist: Float64Array; prev: Int32Array }>();
  function tree(src: number) {
    let t = trees.get(src);
    if (t) return t;
    const n = pos.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    dist[src] = 0;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0) break;
      done[u] = 1;
      for (const e of adj[u]) if (dist[u] + e.w < dist[e.to] - EPS) { dist[e.to] = dist[u] + e.w; prev[e.to] = u; }
    }
    t = { dist, prev };
    trees.set(src, t);
    return t;
  }

  function nodeOf(name: string) {
    const id = named.get(name);
    if (id == null) throw new Error(`unknown point ${name}`);
    return id;
  }

  /** Shortest route between two nodes. */
  function route(a: number, b: number): Route {
    const { dist, prev } = tree(a);
    if (!isFinite(dist[b])) throw new Error(`no route from node ${a} to ${b}`);
    const ids: number[] = [];
    for (let v = b; v !== -1; v = prev[v]) ids.push(v);
    ids.reverse();
    let doors = 0;
    for (let k = 1; k < ids.length; k++) if (adj[ids[k - 1]].find(e => e.to === ids[k])?.door) doors++;
    return { pts: ids.map(i => pos[i]), length: dist[b], doors };
  }

  return { nodeOf, route, pos: (id: number) => pos[id], get size() { return pos.length; }, distance: (a: number, b: number) => tree(a).dist[b] };
}

export type LaneGraph = ReturnType<typeof createLaneGraph>;

/** Point and heading at distance s along a route (clamped to its ends). */
export function pointAlong(r: Route, s: number): { x: number; z: number; dx: number; dz: number } {
  const p = r.pts;
  if (p.length === 1) return { x: p[0].x, z: p[0].z, dx: 0, dz: 1 };
  let left = Math.max(0, s);
  for (let i = 1; i < p.length; i++) {
    const l = Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
    if (l < EPS) continue;
    const dx = (p[i].x - p[i - 1].x) / l, dz = (p[i].z - p[i - 1].z) / l;
    if (left <= l || i === p.length - 1) {
      const u = Math.min(left, l);
      return { x: p[i - 1].x + dx * u, z: p[i - 1].z + dz * u, dx, dz };
    }
    left -= l;
  }
  const a = p[p.length - 2], b = p[p.length - 1], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: b.x, z: b.z, dx: (b.x - a.x) / l, dz: (b.z - a.z) / l };
}
