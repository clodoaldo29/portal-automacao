// Static batching: every mesh under a group that shares a material is merged into one mesh, so a plant with
// thousands of boxes renders in a few dozen draw calls. Only for geometry that never moves.
import * as THREE from 'three';
import { BufferGeometryUtils } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Replace the meshes under `root` with one merged mesh per material. Returns the number of meshes merged. */
export function mergeStatic(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; shadow: boolean }>();
  const remove: THREE.Mesh[] = [];
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material) || o.userData.keep) return;
    let g = m.geometry as THREE.BufferGeometry;
    g = g.index ? g.toNonIndexed() : g.clone();
    // keep only the attributes every primitive has, so all of them merge
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const mat = m.material as THREE.Material;
    let b = buckets.get(mat);
    if (!b) { b = { geos: [], shadow: !o.userData.noShadow && !mat.transparent }; buckets.set(mat, b); }
    b.geos.push(g);
    remove.push(m);
  });
  remove.forEach(m => m.parent?.remove(m));
  for (const [mat, b] of buckets) {
    const merged = BufferGeometryUtils.mergeBufferGeometries(b.geos, false);
    b.geos.forEach(g => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = mesh.receiveShadow = b.shadow;
    if (!b.shadow) mesh.userData.noShadow = true;
    root.add(mesh);
  }
  return remove.length;
}
