// Shared industrial palette: aluminium profiles, cabinets, cobot colours, safety yellow.
import { std } from './kit';

export function createMaterials() {
  return {
    alu: std(0xcfd4da, 0.75, 0.3),
    aluDark: std(0x9aa1a9, 0.7, 0.35),
    dark: std(0x2a2d33, 0.3, 0.55),
    black: std(0x15171b, 0.2, 0.45),
    white: std(0xf2f3f5, 0.05, 0.45),
    yellow: std(0xf2c230, 0.1, 0.45),
    blue: std(0x1f5fd6, 0.2, 0.4),
    cabinet: std(0xdfe3e7, 0.25, 0.45),
    cobot: std(0xd9dde2, 0.25, 0.32),
    cobotCap: std(0x8fb6d8, 0.2, 0.35),
    cobotLink: std(0xc3c9d0, 0.75, 0.25),
    tvBody: std(0x101216, 0.35, 0.4),
    rubber: std(0x223a5e, 0.0, 0.7),
    jig: std(0xb9c0c8, 0.5, 0.4),
    cardboard: std(0xb58a5a, 0.0, 0.85),
    wood: std(0x9c7a52, 0.0, 0.85),
    red: std(0xd23b3b, 0.05, 0.5),
  };
}

export type Materials = ReturnType<typeof createMaterials>;
