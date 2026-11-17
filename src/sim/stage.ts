// The 3D stage every simulation starts from: renderer, camera with orbit controls, a procedural factory-hall
// environment map, sun with a fitted shadow frustum, and a reflective concrete floor.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { at, canvasTex, mk, resetShadowMap } from './kit';

export interface StageOptions {
  /** Shadow camera bounds fitted to the cell (sharper shadows than covering the whole hall). */
  shadowFrustum: { left: number; right: number; top: number; bottom: number; near: number; far: number };
  fogColor?: number;
  /** Fog start and end distances (default 45 and 120 m, sized for one cell). */
  fog?: { near: number; far: number };
  /** Floor and reflection size in metres (default 140 × 100). */
  floor?: { w: number; d: number };
  /** Camera far plane and the furthest the orbit camera may zoom out (defaults 300 and 90 m). */
  cameraFar?: number;
  maxDistance?: number;
}

export type Stage = ReturnType<typeof createStage>;

function floorTex(fw: number, fd: number) {
  const [c, g] = mk(512, 512);
  g.fillStyle = '#b4bac0';
  g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(80,88,96,0.35)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 510, 510);
  const t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(fw / 6, fd / 6);
  return t;
}

export function createStage(container: HTMLElement, opts: StageOptions) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const fog = opts.fogColor ?? 0xd5dbe1;
  scene.background = new THREE.Color(fog);
  scene.fog = new THREE.Fog(fog, opts.fog?.near ?? 45, opts.fog?.far ?? 120);
  const fw = opts.floor?.w ?? 140, fd = opts.floor?.d ?? 100;

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, opts.cameraFar ?? 300);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 1;
  controls.maxDistance = opts.maxDistance ?? 90;

  // environment map: a procedural factory hall (overridden by a real HDRI when one is loaded)
  {
    const env = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(120, 16, 80), new THREE.MeshBasicMaterial({ color: 0x8d949c, side: THREE.BackSide }));
    room.position.y = 8;
    env.add(room);
    const floorE = new THREE.Mesh(new THREE.PlaneGeometry(120, 80), new THREE.MeshBasicMaterial({ color: 0x5d636a }));
    floorE.rotation.x = -Math.PI / 2;
    floorE.position.y = 0.05;
    env.add(floorE);
    const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 7, 7) });
    for (let x = -48; x <= 48; x += 8) for (let z = -30; z <= 30; z += 6) env.add(at(new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 0.4), lamp), x, 15.5, z));
    const win = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.7, 1.8) });
    for (let x = -50; x <= 50; x += 10) {
      env.add(at(new THREE.Mesh(new THREE.BoxGeometry(7, 2, 0.1), win), x, 12, -39.8));
      env.add(at(new THREE.Mesh(new THREE.BoxGeometry(7, 2, 0.1), win), x, 12, 39.8));
    }
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, 0.03).texture;
    pm.dispose();
  }

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a929b, 0.35));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(6, 30, 12);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, opts.shadowFrustum);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex(fw, fd), roughness: 0.2, metalness: 0.0, envMapIntensity: 0.9 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.003;
  floor.receiveShadow = true;
  floor.userData.noShadow = true;
  scene.add(floor);
  const mirror = new Reflector(new THREE.PlaneGeometry(fw, fd), { textureWidth: 1024, textureHeight: 1024, color: new THREE.Color(0x8a939c), clipBias: 0.003 });
  mirror.rotation.x = -Math.PI / 2;
  mirror.userData.noShadow = true;
  scene.add(mirror);

  /** Objects hidden while the floor reflection is rendered (labels, overlays). */
  const hiddenInReflection: { objects: () => THREE.Object3D[]; restore: () => void } = { objects: () => [], restore: () => {} };
  const ob = mirror.onBeforeRender;
  mirror.onBeforeRender = function (r, s, c, ...rest: unknown[]) {
    floor.visible = false;
    hiddenInReflection.objects().forEach(o => (o.visible = false));
    (ob as (...a: unknown[]) => void).call(this, r, s, c, ...rest);
    floor.visible = true;
    hiddenInReflection.restore();
  };

  const state = { high: !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) };

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    mirror.getRenderTarget().setSize(Math.round(w * pr * 0.6), Math.round(h * pr * 0.6));
  }

  /** High quality: device pixel ratio up to 2, 3072 px shadows and the floor reflection; light: 1×, 1536 px, no reflection. */
  function applyQuality() {
    const high = state.high;
    renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    const sz = high ? 3072 : 1536;
    sun.shadow.mapSize.set(sz, sz);
    resetShadowMap(sun);
    mirror.visible = high;
    floorMat.transparent = high;
    floorMat.opacity = high ? 0.84 : 1;
    floorMat.needsUpdate = true;
    resize();
  }

  /** After the scene is built: every opaque static mesh casts and receives shadows. */
  function finalizeShadows() {
    scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !o.userData.noShadow && !(o as THREE.InstancedMesh).isInstancedMesh && o !== floor && !(m.material && (m.material as THREE.Material).transparent)) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  return { renderer, scene, camera, controls, sun, floor, floorMat, mirror, state, resize, applyQuality, finalizeShadows, hiddenInReflection };
}
