// Many small status lights in one draw call (one instanced mesh with a colour per light), for plants with
// hundreds of machines where a full andon tower per machine would be too heavy.
import * as THREE from 'three';

export function createBeacons(parent: THREE.Object3D, count: number, radius = 0.1, height = 0.22) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(radius, radius, height, 12), mat, count);
  mesh.userData.noShadow = true;
  mesh.frustumCulled = false;
  parent.add(mesh);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  const current = new Int32Array(count).fill(-1);
  for (let i = 0; i < count; i++) mesh.setColorAt(i, col.set(0x888888));

  return {
    mesh,
    place(i: number, x: number, y: number, z: number) { m4.makeTranslation(x, y, z); mesh.setMatrixAt(i, m4); mesh.instanceMatrix.needsUpdate = true; },
    /** Set a light's colour (only touches the GPU buffer when it changes). */
    color(i: number, hex: number) {
      if (current[i] === hex) return;
      current[i] = hex;
      mesh.setColorAt(i, col.set(hex));
      mesh.instanceColor!.needsUpdate = true;
    },
  };
}
