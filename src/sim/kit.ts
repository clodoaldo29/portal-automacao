// Small three.js helpers shared by every simulation (real scale: 1 unit = 1 metre).
import * as THREE from 'three';

export type ColorLike = THREE.Color | string | number;

export const std = (color: ColorLike, metalness = 0.1, roughness = 0.5, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial(Object.assign({ color, metalness, roughness }, extra));

export const box = (w: number, h: number, d: number, mat: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

export const cyl = (rt: number, rb: number, h: number, mat: THREE.Material, seg = 24) =>
  new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);

/** Cylinder of radius r lying along the given axis. */
export const cylA = (r: number, h: number, mat: THREE.Material, axis: 'x' | 'y' | 'z', seg = 24) => {
  const m = cyl(r, r, h, mat, seg);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  else if (axis === 'x') m.rotation.z = Math.PI / 2;
  return m;
};

export const at = <T extends THREE.Object3D>(obj: T, x: number, y: number, z: number): T => {
  obj.position.set(x, y, z);
  return obj;
};

/** Every mesh under `o` casts and receives shadows, except those flagged userData.noShadow. */
export const shadowify = <T extends THREE.Object3D>(o: T): T => {
  o.traverse(m => {
    if ((m as THREE.Mesh).isMesh && !m.userData.noShadow) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return o;
};

export const canvasTex = (c: HTMLCanvasElement, srgb = true) => {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.encoding = THREE.sRGBEncoding;
  t.anisotropy = 4;
  return t;
};

export const mk = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
};

let glowTex: THREE.Texture | null = null;
/** Soft additive glow sprite (lamps, LEDs). */
export const glow = (color: ColorLike, size: number) => {
  if (!glowTex) {
    const [c, g] = mk(64, 64);
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    glowTex = canvasTex(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.set(size, size, 1);
  return s;
};

/** Drop a light's shadow map so it is rebuilt at the new mapSize on the next render. */
export const resetShadowMap = (light: THREE.DirectionalLight) => {
  const sh = light.shadow as unknown as { map: THREE.WebGLRenderTarget | null };
  if (sh.map) { sh.map.dispose(); sh.map = null; }
};
