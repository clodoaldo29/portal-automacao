// Smart Solder AI · soldering tool shared by the articulated arms (B) and the cartesian robots (A).
import * as THREE from 'three';
import { at, box, cyl, cylA, glow, shadowify, std } from '../../sim/kit';
import type { Materials } from '../../sim/materials';

/** Flange → iron tip along the tool axis (local −y). */
export const TIP = 0.3;

/**
 * Soldering iron pointing down from `mount`: bracket, handle, heater and tip, wire feeder with its tube, and a small
 * camera for the fiducials. `body` is everything except the heater and the tip (the parts that touch the joint are
 * left out of the collision check). `heat(on)` lights the tip.
 */
export function solderIron(mount: THREE.Object3D, M: Materials, tipLen = TIP) {
  const g = new THREE.Group(), body = new THREE.Group(), hot = new THREE.Group();
  mount.add(g);
  g.add(body, hot);
  const handle = std(0x1f5fd6, 0.2, 0.45), steel = std(0xb8c0c8, 0.85, 0.25);
  const top = tipLen - 0.3; // extra length of the bracket for a longer tool
  body.add(at(cyl(0.04, 0.04, 0.02, M.aluDark, 20), 0, -0.01, 0));
  body.add(at(box(0.05, 0.03 + top, 0.05, M.alu), 0, -0.035 - top / 2, 0));
  body.add(at(cyl(0.014, 0.012, 0.15, handle, 16), 0, -0.125 - top, 0));
  body.add(at(cyl(0.017, 0.017, 0.02, M.black, 16), 0, -0.2 - top, 0));
  // wire feeder on the side, tube down to the tip
  body.add(at(box(0.05, 0.06, 0.045, M.dark), 0.05, -0.06 - top, 0));
  body.add(at(cylA(0.022, 0.012, std(0x9aa3ad, 0.6, 0.3), 'z', 16), 0.05, -0.06 - top, 0.03));
  const tube = at(cyl(0.003, 0.003, 0.2, std(0xf2c230, 0.1, 0.5), 6), 0.035, -0.17 - top, 0);
  tube.rotation.z = 0.12;
  body.add(tube);
  // fiducial camera
  body.add(at(box(0.04, 0.035, 0.035, M.black), -0.045, -0.07 - top, 0));
  hot.add(at(cyl(0.006, 0.007, 0.07, steel, 12), 0, -0.245 - top, 0));
  hot.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.0045, 0.02, 12), std(0x6b7280, 0.7, 0.35)), 0, -0.29 - top, 0).rotateX(Math.PI));
  const tipMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.6, roughness: 0.35, emissive: 0xff6a00, emissiveIntensity: 0 });
  hot.add(at(cyl(0.0012, 0.003, 0.012, tipMat, 10), 0, -tipLen + 0.006, 0));
  const spark = glow(0xffa040, 0.08);
  spark.position.y = -tipLen;
  spark.visible = false;
  hot.add(spark);
  const fume = glow(0xd4d8dc, 0.05);
  fume.position.y = -tipLen + 0.03;
  fume.visible = false;
  hot.add(fume);
  shadowify(g);
  let t = 0;
  return {
    g, body,
    heat(on: boolean, dt = 0) {
      t += dt;
      tipMat.emissiveIntensity = on ? 1.6 : 0.15;
      spark.visible = on;
      fume.visible = on;
      if (on) { fume.position.y = -tipLen + 0.03 + ((t * 0.08) % 0.06); (fume.material as THREE.SpriteMaterial).opacity = 0.6 - ((t * 0.08) % 0.06) * 8; }
    },
  };
}
export type SolderIron = ReturnType<typeof solderIron>;

/** Floor sign plate painted with a cell name. */
export function cellSign(text: string, font: string) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b3a6b'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#fff'; g.font = `700 50px ${font}`; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText(text, 256, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.15), new THREE.MeshBasicMaterial({ map: tex }));
  return m;
}
