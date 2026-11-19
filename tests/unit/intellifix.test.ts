import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMING, moveS, plan, split } from '../../src/projects/intellifix/balance';
import { CELL, MODELS, SCREW_LIMITS, inZone, requiredCycleS, ringPoints, screwPoints, tvSize, tvsPerPallet } from '../../src/projects/intellifix/model';

const key = (p: { x: number; z: number }) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`;
const ALL_N = Array.from({ length: SCREW_LIMITS[1] - SCREW_LIMITS[0] + 1 }, (_, i) => SCREW_LIMITS[0] + i);

describe('Intellifix AI · produtos e pontos', () => {
  it('tem os 7 modelos do PUR, com 2 TVs por pallet até 43"', () => {
    expect(MODELS.map(m => m.id)).toEqual(['TL052M', '32V35RS', 'TL056', 'TL059', '55Q6QV', '65Q6QV', '75Q6QV']);
    for (const m of MODELS) expect(tvsPerPallet(m.inch)).toBe(m.inch <= 43 ? 2 : 1);
    expect(requiredCycleS(MODELS[2])).toBeCloseTo(32.73, 1); // TL056: 2 TVs a 220 UPH
    expect(requiredCycleS(MODELS[6])).toBeCloseTo(48, 1); // 75": 1 TV a 75 UPH
  });

  it('distribui n parafusos distintos dentro da tampa de cada TV', () => {
    for (const m of MODELS) for (const n of ALL_N) {
      const pts = screwPoints(m, n), { w, h } = tvSize(m.inch);
      expect(pts).toHaveLength(n * tvsPerPallet(m.inch));
      expect(new Set(pts.map(key)).size).toBe(pts.length);
      for (const p of ringPoints(w, h, n)) expect(Math.abs(p.x) < w / 2 && Math.abs(p.z) < h / 2).toBe(true);
    }
  });

  it('marca os parafusos autoatarraxantes só nos modelos que têm', () => {
    for (const m of MODELS) {
      const perTv = screwPoints(m).filter(p => p.tv === 0 && p.selfTap).length;
      expect(perTv).toBe(m.selfTap);
    }
  });
});

describe('Intellifix AI · divisão entre os robôs', () => {
  it('cada parafuso vai para exatamente um robô', () => {
    for (const m of MODELS) for (const n of ALL_N) {
      const pts = screwPoints(m, n), [a, b] = split(m, pts);
      expect(a.length + b.length).toBe(pts.length);
      expect(new Set([...a, ...b].map(key)).size).toBe(pts.length);
    }
  });

  it('32" e 43": cada robô parafusa a sua TV', () => {
    for (const m of MODELS.filter(m => m.inch <= 43)) {
      const [a, b] = split(m, screwPoints(m));
      expect(a.every(p => p.tv === 0) && b.every(p => p.tv === 1)).toBe(true);
    }
  });

  it('50" ou mais: metade para cada robô (diferença de no máximo 1)', () => {
    for (const m of MODELS.filter(m => m.inch >= 50)) for (const n of ALL_N) {
      const [a, b] = split(m, screwPoints(m, n));
      expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(1);
    }
  });

  it('todos os pontos ficam ao alcance do UR10e com a parafusadeira', () => {
    for (const m of MODELS) for (const n of ALL_N) expect(plan(m, DEFAULT_TIMING, n).maxReach).toBeLessThanOrEqual(CELL.reach);
  });

  it('os dois robôs nunca estão juntos na faixa central (sem colisão)', () => {
    for (const m of MODELS) for (const n of ALL_N) {
      const { robots: [r1, r2] } = plan(m, DEFAULT_TIMING, n);
      if (r1.zone && r2.zone) expect(r2.zone[0]).toBeGreaterThanOrEqual(r1.zone[1] - 1e-9);
      // fora da janela de zona, nenhum ponto da faixa central
      for (const r of [r1, r2]) for (const t of r.tasks) if (inZone(t.p) && r.zone) expect(t.moveStart).toBeGreaterThanOrEqual(r.zone[0] - 1e-9);
    }
  });
});

describe('Intellifix AI · tempos de ciclo', () => {
  it('movimento: mais longe leva mais tempo, e um passo curto é rápido', () => {
    expect(moveS(0)).toBe(0);
    expect(moveS(0.3)).toBeGreaterThan(0.5);
    expect(moveS(0.3)).toBeLessThan(1.0);
    expect(moveS(1)).toBeGreaterThan(moveS(0.5));
  });

  it('com os valores padrão, os 7 modelos atendem a cadência', () => {
    for (const m of MODELS) expect(plan(m).ok).toBe(true);
  });

  it('TL056 é o caso crítico: entre 80% e 95% do ciclo', () => {
    const loads = MODELS.map(m => plan(m).load), tl056 = plan(MODELS[2]).load;
    expect(tl056).toBe(Math.max(...loads));
    expect(tl056).toBeGreaterThan(0.8);
    expect(tl056).toBeLessThan(0.95);
  });

  it('se o robô busca o parafuso no alimentador, o TL056 não fecha', () => {
    expect(plan(MODELS[2], { ...DEFAULT_TIMING, feed: 'pick' }).ok).toBe(false);
  });

  it('mais parafusos, ciclo maior', () => {
    for (const m of MODELS) expect(plan(m, DEFAULT_TIMING, m.screws + 2).cycleS).toBeGreaterThan(plan(m).cycleS);
  });
});
