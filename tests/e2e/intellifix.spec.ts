import { expect, test } from '@playwright/test';

// Intellifix AI: the page opens without errors and fills the panel; the measured pallet cycle matches the plan from
// balance.ts (capacity test, pallets as fast as the cell takes them), every model meets its cadence, the two arms
// never come close to each other or touch the cell, and they reach every screw (IK error under 1 cm). In the
// integrated flow the Transfer Flow moves the TVs the cell hands over.

type Bench = { model: string; tvs: number; uph: number; cycle: number; planCycle: number; perRobot: number[]; minArmArm: number; minClear: number; minClearAt: string; maxIkErr: number; tfMoved: number | null; ms: number };
const bench = async (page: import('@playwright/test').Page, q: string) => {
  await page.goto(`/projetos/intellifix-ai/?${q}`);
  return (await page.waitForFunction(() => (window as unknown as { __ifBench?: Bench }).__ifBench, null, { timeout: 200_000 }).then(h => h.jsonValue())) as Bench;
};
const run = (page: import('@playwright/test').Page, seconds: number) =>
  page.evaluate(s => { const w = (window as unknown as { __if: { step: (dt: number) => void; panel: () => void } }).__if; for (let i = 0; i < 30 * s; i++) w.step(1 / 30); w.panel(); }, seconds);

// required pallet cycle (s) per model: 3600 / UPH × TVs per pallet
const MODELS: [string, number][] = [['TL052M', 31.3], ['32V35RS', 31.3], ['TL056', 32.7], ['TL059', 31.3], ['55Q6QV', 32.7], ['65Q6QV', 40], ['75Q6QV', 48]];

test.describe('Intellifix AI', () => {
  test('opens without errors and fills the panel', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/projetos/intellifix-ai/');
    await expect(page.locator('#stage canvas')).toBeVisible();
    await run(page, 300);
    await expect(page.locator('#k-uph')).not.toHaveText('—');
    await expect(page.locator('#cyc-rows tr')).toHaveCount(7);
    await expect(page.locator('#rob-rows tr')).toHaveCount(2);
    await expect(page.locator('#cls-rows tr')).toHaveCount(5);
    expect(await page.locator('#log-rows tr').count()).toBeGreaterThan(0);
    expect(await page.locator('#pts-rows tr').count()).toBe(9); // TL056: 9 screws on the last TV
    await expect(page.locator('#b-fluxo')).toHaveText('Fluxo integrado');
    expect(errors).toEqual([]);
  });

  for (const [model, required] of MODELS) {
    test(`${model}: measured cycle = plan, cadence met, no collision, every screw reached`, async ({ page }) => {
      const r = await bench(page, `bench=6&feed=max&model=${model}`);
      console.log(`intellifix ${model}: ${r.tvs} TVs, ${r.uph} TV/h, ciclo ${r.cycle} s (plano ${r.planCycle} s), parafusos por robô ${r.perRobot.join('/')}, folga entre braços ${r.minArmArm} m, folga ${r.minClear} m (${r.minClearAt}), IK ${r.maxIkErr} m (${r.ms} ms)`);
      expect(Math.abs(r.cycle - r.planCycle) / r.planCycle, 'ciclo medido = ciclo do plano').toBeLessThan(0.01);
      expect(r.cycle, 'atende a cadência').toBeLessThanOrEqual(required);
      // metade para cada robô: no máximo 1 parafuso de diferença por TV (número ímpar de parafusos), mais a TV em curso
      expect(Math.abs(r.perRobot[0] - r.perRobot[1]), 'mesma carga nos dois robôs').toBeLessThanOrEqual(r.tvs + 2);
      expect(r.minArmArm, 'os braços não se aproximam').toBeGreaterThan(0.05);
      expect(r.minClear, 'os braços não encostam na célula').toBeGreaterThan(0);
      expect(r.maxIkErr, 'alcançam todos os parafusos').toBeLessThan(0.01);
    });
  }

  test('integrated flow: the Transfer Flow moves the TVs the cell hands over', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const r = await bench(page, 'fluxo=integrado&bench=10');
    console.log(`intellifix integrado: ${r.tvs} TVs parafusadas, ${r.tfMoved} transferidas pelo Transfer Flow (${r.ms} ms)`);
    expect(r.tfMoved).toBeGreaterThan(0);
    expect(Math.abs(r.tfMoved! - r.tvs), 'o Transfer Flow acompanha a célula').toBeLessThanOrEqual(8);
    await expect(page.locator('#b-fluxo')).toHaveText('Só a célula');
    expect(errors).toEqual([]);
  });
});
