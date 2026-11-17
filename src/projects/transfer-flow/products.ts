// TVs, assembly jigs and test pallets.
import * as THREE from 'three';
import { at, box, canvasTex, mk, shadowify } from '../../sim/kit';
import type { Materials } from '../../sim/materials';
import { JIG_L, PAL_D, PAL_W, SIZES, TV_T, type Inch } from './config';

export interface TV { obj: THREE.Group; inch: Inch; screen: THREE.Mesh }
export type ScreenPattern = 'bars' | 'red' | 'green' | 'blue' | 'white' | 'swoosh';

const screenOff = new THREE.MeshStandardMaterial({ color: 0x06080b, metalness: 0.35, roughness: 0.06 });
let screenMats: Record<ScreenPattern, THREE.MeshBasicMaterial> | null = null;

function swooshTex() {
  const [c, g] = mk(512, 288);
  const bg = g.createLinearGradient(0, 0, 512, 288);
  bg.addColorStop(0, '#04122e'); bg.addColorStop(0.55, '#0a3fa8'); bg.addColorStop(1, '#1d8bff');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 288);
  for (let i = 0; i < 4; i++) {
    g.strokeStyle = `rgba(190,225,255,${0.55 - i * 0.12})`; g.lineWidth = 10 - i * 2;
    g.beginPath(); g.moveTo(-20, 230 - i * 14); g.bezierCurveTo(160, 120 - i * 10, 330, 150 - i * 8, 540, 40 + i * 10); g.stroke();
  }
  return canvasTex(c);
}
function barsTex() {
  const [c, g] = mk(448, 252);
  ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'].forEach((col, i) => { g.fillStyle = col; g.fillRect(i * 64, 0, 64, 180); });
  const gr = g.createLinearGradient(0, 0, 448, 0); gr.addColorStop(0, '#000'); gr.addColorStop(1, '#fff');
  g.fillStyle = gr; g.fillRect(0, 180, 448, 72);
  return canvasTex(c);
}
const solid = (col: string) => { const [c, g] = mk(8, 8); g.fillStyle = col; g.fillRect(0, 0, 8, 8); return canvasTex(c); };

function getScreenMats() {
  if (!screenMats) {
    const basic = (map: THREE.Texture) => new THREE.MeshBasicMaterial({ map, toneMapped: false });
    screenMats = { bars: basic(barsTex()), red: basic(solid('#e02020')), green: basic(solid('#20c040')), blue: basic(solid('#2050f0')), white: basic(solid('#f4f4f4')), swoosh: basic(swooshTex()) };
  }
  return screenMats;
}

/** TV centred on its own middle: screen on local +y, back cover (with the electronics bump) on local -y. */
export function makeTV(M: Materials, inch: Inch): TV {
  const [w, d] = SIZES[inch];
  const g = new THREE.Group();
  g.add(box(w, TV_T, d, M.tvBody));
  g.add(at(box(w * 0.56, 0.03, d * 0.56, M.dark), 0, -0.045, 0));
  g.add(at(box(w * 0.18, 0.01, d * 0.1, M.aluDark), w * 0.12, -0.065, -d * 0.12));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.02, d - 0.02), screenOff);
  scr.rotation.x = -Math.PI / 2;
  at(scr, 0, TV_T / 2 + 0.0015, 0);
  scr.userData.noShadow = true;
  g.add(scr);
  shadowify(g);
  return { obj: g, inch, screen: scr };
}

export const tvPower = (tv: TV, pat: ScreenPattern | null) => { tv.screen.material = pat ? getScreenMats()[pat] : screenOff; };

/** Standard jig for every model: 2.3 × 1.1 m. Its LED shows the inspection result. */
export function makeJig(M: Materials) {
  const g = new THREE.Group();
  g.add(at(box(JIG_L, 0.08, 1.1, M.jig), 0, 0.04, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(box(0.08, 0.1, 0.08, M.white), sx * 1.1, 0.13, sz * 0.5));
  g.add(at(box(0.03, 0.05, 0.6, M.white), 0, 0.105, 0)); // centre divider between the two 32"/43" seats
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x000000 });
  g.add(at(box(0.08, 0.03, 0.04, ledMat), 0.95, 0.095, -0.53));
  shadowify(g);
  return { g, ledMat };
}

/**
 * Standard test pallet (all models, one TV): 1.9 × 0.55 m. The TV stands in a grooved base rail, screen toward +z
 * (robots / viewer), back toward -z on a low rest rail. Side guides at ±0.90 m leave ~4.5 cm per side for the 75",
 * with chamfered lead-ins.
 */
export function makePallet(M: Materials) {
  // parts are laid out with the screen side on local -z, then the fixture is turned to face +z
  const g0 = new THREE.Group(), g = new THREE.Group();
  g.rotation.y = Math.PI;
  g0.add(g);
  const W = PAL_W, D = PAL_D, T = 0.06, H = 0.08;
  g.add(at(box(W, H, T, M.blue), 0, H / 2, D / 2 - T / 2)); g.add(at(box(W, H, T, M.blue), 0, H / 2, -D / 2 + T / 2));
  g.add(at(box(T, H, D, M.blue), W / 2 - T / 2, H / 2, 0)); g.add(at(box(T, H, D, M.blue), -W / 2 + T / 2, H / 2, 0));
  for (const x of [-0.6, 0, 0.6]) g.add(at(box(0.05, 0.03, D - 0.1, M.aluDark), x, 0.065, 0));
  g.add(at(box(W - 0.2, 0.05, 0.16, M.dark), 0, 0.105, 0)); // grooved base rail (seat at 0.13)
  g.add(at(box(W - 0.2, 0.06, 0.02, M.alu), 0, 0.16, -0.08)); // front lip (screen side)
  g.add(at(box(W - 0.2, 0.03, 0.03, M.alu), 0, 0.165, 0.09)); // back rest rail (robot side)
  g.add(at(box(W - 0.2, 0.02, 0.01, M.rubber), 0, 0.165, 0.07)); // rubber pad
  for (const x of [-0.75, 0, 0.75]) g.add(at(box(0.03, 0.07, 0.03, M.alu), x, 0.125, 0.09));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(at(box(0.03, 0.3, 0.03, M.alu), sx * 0.905, 0.23, sz * 0.06)); // side guides (30 cm)
    const lead = at(box(0.03, 0.08, 0.03, M.yellow), sx * 0.915, 0.4, sz * 0.06);
    lead.rotation.z = sx * 0.35;
    g.add(lead); // chamfered lead-in
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(box(0.1, 0.1, 0.1, M.white), sx * (W / 2 - 0.05), 0.05, sz * (D / 2 - 0.05)));
  g.add(at(box(0.08, 0.07, 0.15, M.yellow), -W / 2 + 0.15, 0.12, 0.17));
  shadowify(g0);
  return g0;
}
