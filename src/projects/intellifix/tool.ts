// Intellifix AI · screwdriver on the UR10e flange: electric spindle with torque/angle transducer, blow-fed nose
// (the screw arrives through the hose while the previous one is driven), and an inspection camera with a ring light.
import * as THREE from 'three';
import { at, box, cyl, glow, shadowify, std } from '../../sim/kit';
import type { Materials } from '../../sim/materials';

/** Flange → nose tip along the tool axis (local −y). */
export const TIP = 0.34;

export function screwdriver(mount: THREE.Object3D, M: Materials) {
  const g = new THREE.Group();
  mount.add(g);
  const motor = std(0x2b3440, 0.35, 0.4), steel = std(0xb8c0c8, 0.85, 0.25), blue = std(0x1f5fd6, 0.2, 0.45);
  g.add(at(cyl(0.045, 0.045, 0.02, M.aluDark, 24), 0, -0.01, 0)); // flange adapter
  g.add(at(box(0.07, 0.04, 0.07, M.alu), 0, -0.04, 0));
  g.add(at(cyl(0.032, 0.032, 0.14, motor, 24), 0, -0.13, 0)); // motor
  g.add(at(cyl(0.036, 0.036, 0.03, blue, 24), 0, -0.215, 0)); // torque / angle transducer
  g.add(at(cyl(0.02, 0.024, 0.07, steel, 20), 0, -0.265, 0)); // spindle housing
  g.add(at(cyl(0.011, 0.016, 0.04, steel, 16), 0, -0.32, 0)); // blow-feed nose
  // hose port on the nose (the feed hose is drawn by the cell, from the feeder to this port)
  const port = at(new THREE.Object3D(), 0.024, -0.3, 0);
  g.add(at(cyl(0.007, 0.007, 0.03, M.dark, 10), 0.02, -0.3, 0).rotateZ(-0.9));
  g.add(port);
  // bit, spinning while it drives
  const bit = new THREE.Group();
  bit.position.y = -TIP;
  g.add(bit);
  bit.add(at(cyl(0.0025, 0.0025, 0.02, std(0x50555c, 0.9, 0.3), 8), 0, 0.01, 0));
  bit.add(at(box(0.006, 0.006, 0.0012, std(0x50555c, 0.9, 0.3)), 0, 0.001, 0));
  // inspection camera with ring light, beside the spindle
  g.add(at(box(0.05, 0.06, 0.045, M.black), -0.07, -0.2, 0));
  g.add(at(box(0.03, 0.02, 0.03, M.alu), -0.045, -0.18, 0));
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xdfe8f5, emissive: 0xbfe1ff, emissiveIntensity: 0.1, roughness: 0.3 });
  g.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 8, 24), ringMat), -0.07, -0.232, 0).rotateX(Math.PI / 2));
  const flashGl = glow(0xcfe7ff, 0.18);
  flashGl.position.set(-0.07, -0.24, 0);
  flashGl.visible = false;
  g.add(flashGl);
  shadowify(g);
  return {
    g, port,
    /** Spin the bit (drive on). */
    spin(dt: number, on: boolean) { if (on) bit.rotation.y += dt * 60; },
    /** Ring light flash (image capture). */
    flash(on: boolean) { ringMat.emissiveIntensity = on ? 2.4 : 0.1; flashGl.visible = on; },
  };
}
export type Screwdriver = ReturnType<typeof screwdriver>;
