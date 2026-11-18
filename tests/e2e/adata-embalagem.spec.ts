import { expect, test } from '@playwright/test';

// Packing cell reference: 10 simulated minutes from the start, default (provisional) parameters, continuous feed,
// no wrong labels. The robot must reach every point (IK error under 1 cm) and never touch anything: the collision
// check (src/sim/robots/collision.ts) must report a positive clearance to every machine during the whole run.
// When the cell logic or its defaults change on purpose, re-measure and update in the same commit.
const REFERENCE = { minutes: 10, bags: 33, cartons: 8, ng: 0 };

type Cell = { step: (dt: number) => void; params: { wrongLabel: boolean } };
const run = (page: import('@playwright/test').Page, seconds: number) =>
  page.evaluate(s => { const c = (window as unknown as { __a05: { cell: Cell } }).__a05.cell; for (let i = 0; i < 30 * s; i++) c.step(1 / 30); (window as unknown as { __a05: { panel: () => void } }).__a05.panel(); }, seconds);

test.describe('Adata 05 · embalagem final', () => {
  test('opens without errors and packs bags', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/projetos/adata-embalagem/');
    await expect(page.locator('#stage canvas')).toBeVisible();
    await page.click('#b-quality');
    await run(page, 180);
    await expect(page.locator('#k-bph')).not.toHaveText('—');
    await expect(page.locator('#cap-rows tr').nth(2)).toContainText('%');
    await expect(page.locator('#use-rows tr')).toHaveCount(4);
    expect(errors).toEqual([]);
  });

  test('wrong labels are caught by the verification and never reach a carton', async ({ page }) => {
    await page.goto('/projetos/adata-embalagem/');
    await page.click('#b-quality');
    await page.click('#b-wrong');
    await run(page, 900); // ~8% wrong labels: about 6 expected in this time
    await expect(page.locator('#k-ng')).not.toHaveText('0');
    await expect(page.locator('#k-escape')).toHaveText('0');
  });

  test('throughput matches the reference; the robot reaches every point and touches nothing', async ({ page }) => {
    await page.goto(`/projetos/adata-embalagem/?bench=${REFERENCE.minutes}`);
    const r = await page.waitForFunction(() => window.__a05Bench, null, { timeout: 120_000 }).then(h => h.jsonValue());
    console.log(`embalagem: ${r!.bags} sacos, ${r!.cartons} caixas, IK ${r!.maxIkErr} m, folga mínima ${r!.minClear} m (${r!.minClearAt}) (${r!.ms} ms)`);
    expect({ minutes: r!.minutes, bags: r!.bags, cartons: r!.cartons, ng: r!.ng }).toEqual(REFERENCE);
    expect(r!.maxIkErr).toBeLessThan(0.01);
    expect(r!.minClear, `o robô encostou em: ${r!.minClearAt}`).toBeGreaterThan(0);
  });
});
