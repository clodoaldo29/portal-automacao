// What moves: lots (cassettes coloured by family) on shelves, machines and carriers; operators pushing carts in
// clean-room suits, or AMRs. Positions come from the engine at the current simulated time.
import * as THREE from 'three';
import { at, box, cyl, cylA, std } from '../../sim/kit';
import type { Engine, Machine } from './engine';
import { DOCK_IN } from './layout';
import { equipPoint, W, shelfSlot, type Plant } from './plant3d';
import { FAMILIES, FAMILY_INFO } from './process';

const MAX_LOTS = 900;

function makeOperator() {
  const g = new THREE.Group();
  const suit = std(0xf4f6f8, 0.0, 0.7), visor = std(0x1d2733, 0.3, 0.2), blue = std(0x2f6fb0, 0.1, 0.5), steel = std(0xb8bfc7, 0.8, 0.3);
  // person behind the cart (local −z), facing +z
  g.add(at(cyl(0.2, 0.17, 0.85, suit, 12), 0, 0.95, -0.55));
  g.add(at(cyl(0.12, 0.12, 0.75, suit, 10), -0.09, 0.38, -0.55));
  g.add(at(cyl(0.12, 0.12, 0.75, suit, 10), 0.09, 0.38, -0.55));
  g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), suit), 0, 1.5, -0.55));
  g.add(at(box(0.2, 0.08, 0.06, visor), 0, 1.52, -0.42));
  g.add(at(box(0.36, 0.05, 0.3, blue), 0, 0.02, -0.55));
  for (const s of [-1, 1]) g.add(at(cylA(0.05, 0.55, suit, 'z', 8), s * 0.2, 1.05, -0.3));
  // cart
  g.add(at(box(0.6, 0.04, 0.8, steel), 0, 0.8, 0.25));
  g.add(at(box(0.6, 0.04, 0.8, steel), 0, 0.3, 0.25));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(box(0.03, 0.75, 0.03, steel), sx * 0.28, 0.45, 0.25 + sz * 0.38));
  g.add(at(cylA(0.02, 0.6, steel, 'x', 8), 0, 1.05, -0.17));
  return g;
}

function makeAmr() {
  const g = new THREE.Group();
  const body = std(0x2b3036, 0.3, 0.45), deck = std(0xd5dae0, 0.4, 0.4), led = new THREE.MeshBasicMaterial({ color: 0x38bdf8, toneMapped: false });
  g.add(at(box(0.62, 0.3, 0.92, body), 0, 0.2, 0));
  g.add(at(box(0.58, 0.03, 0.88, deck), 0, 0.36, 0));
  g.add(at(box(0.64, 0.03, 0.94, led), 0, 0.12, 0));
  g.add(at(cyl(0.06, 0.07, 0.07, std(0x15171b, 0.2, 0.4), 12), 0, 0.41, 0.36));
  g.add(at(box(0.3, 0.05, 0.02, std(0xf2c230, 0.1, 0.5)), 0, 0.22, 0.47));
  return g;
}

export function createActors(scene: THREE.Scene, plant: Plant) {
  // lots: one instanced mesh, colour per family
  const lotMat = std(0xffffff, 0.1, 0.45);
  const lots = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.28, 0.34), lotMat, MAX_LOTS);
  lots.frustumCulled = false;
  lots.castShadow = true;
  const famCol = Object.fromEntries(FAMILIES.map(f => [f, new THREE.Color(FAMILY_INFO[f].color)]));
  for (let i = 0; i < MAX_LOTS; i++) lots.setColorAt(i, famCol.DDR4);
  lots.count = 0;
  scene.add(lots);

  const fleet = new THREE.Group();
  scene.add(fleet);
  let bodies: THREE.Group[] = [];
  const heading: number[] = [];
  let builtFor: Engine | null = null;

  function setEngine(e: Engine) {
    bodies.forEach(b => fleet.remove(b));
    bodies = e.carriers.map(() => {
      const b = e.fleet.kind === 'amr' ? makeAmr() : makeOperator();
      b.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      fleet.add(b);
      return b;
    });
    heading.length = 0;
    builtFor = e;
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  const tmp = new THREE.Vector3();

  function update(e: Engine, t: number) {
    if (builtFor !== e) setEngine(e);
    // carriers
    const deckY = e.fleet.kind === 'amr' ? 0.52 : 0.96, deckFwd = e.fleet.kind === 'amr' ? 0 : 0.25;
    const carrierLot = new Map<number, THREE.Vector3>();
    e.carriers.forEach((c, i) => {
      const p = e.carrierPos(c, t), b = bodies[i];
      const [X, Z] = W(p.x, p.z);
      if (p.dx || p.dz) heading[i] = Math.atan2(p.dx, p.dz);
      const h = heading[i] ?? 0;
      b.position.set(X, 0, Z);
      b.rotation.y = h;
      carrierLot.set(c.id, new THREE.Vector3(X + Math.sin(h) * deckFwd, deckY, Z + Math.cos(h) * deckFwd));
    });

    // lots
    const nodeMachine = new Map<number, Machine>();
    for (const m of e.machines) nodeMachine.set(m.node, m);
    const atNode = new Map<number, number>(), onMachine = new Map<Machine, number>();
    let n = 0;
    const put = (v: THREE.Vector3, fam: keyof typeof famCol) => {
      if (n >= MAX_LOTS) return;
      m4.compose(v, q.identity(), one);
      lots.setMatrixAt(n, m4);
      lots.setColorAt(n, famCol[fam]);
      n++;
    };
    // queues on the shelves, in order
    for (const s of e.steps) {
      const sh = plant.shelves[s.def.area];
      s.queue.forEach((lot, i) => put(shelfSlot(sh, i), lot.fam));
    }
    for (const lot of e.lots) {
      if (lot.state === 'queue') continue;
      if (lot.state === 'moving' && lot.carrier) { put(carrierLot.get(lot.carrier.id)!.clone(), lot.fam); continue; }
      if (lot.state === 'process') {
        const m = lot.machine;
        if (!m) { // dwell in the finished-goods buffer
          const s = e.steps[lot.route[lot.ri]], sh = plant.shelves[s.def.area];
          const k = (atNode.get(-1 - s.idx) ?? 0); atNode.set(-1 - s.idx, k + 1);
          put(shelfSlot(sh, s.queue.length + k), lot.fam);
          continue;
        }
        const k = onMachine.get(m) ?? 0; onMachine.set(m, k + 1);
        const eq = m.eq, onBench = eq.kind === 'bench';
        put(onBench ? equipPoint(eq, -eq.w * 0.2 + k * 0.45, 1.06, 0.05) : equipPoint(eq, -eq.w / 2 + 0.38 + (k % 3) * 0.42, 1.09 + Math.floor(k / 3) * 0.3, eq.d / 2 + 0.16), lot.fam);
        continue;
      }
      // waiting for pickup: next to the machine's port, at the dock, or on the buffer shelf
      const k = atNode.get(lot.at) ?? 0; atNode.set(lot.at, k + 1);
      const m = nodeMachine.get(lot.at);
      if (m) {
        const eq = m.eq;
        put(equipPoint(eq, eq.w / 2 - 0.3 - (k % 3) * 0.42, 0.18 + Math.floor(k / 3) * 0.3, eq.d / 2 + 0.3), lot.fam);
      } else if (lot.ri < 0) {
        const [X, Z] = W(DOCK_IN.x - 0.4 + (k % 3) * 0.42, DOCK_IN.z + 1.6);
        put(tmp.set(X, 0.3 + Math.floor(k / 3) * 0.3, Z).clone(), lot.fam);
      } else {
        const s = e.steps[lot.route[lot.ri]], sh = plant.shelves[s.def.area];
        put(shelfSlot(sh, s.queue.length + 6 + k), lot.fam);
      }
    }
    lots.count = n;
    lots.instanceMatrix.needsUpdate = true;
    if (lots.instanceColor) lots.instanceColor.needsUpdate = true;
  }

  return { update, lots, fleet };
}
