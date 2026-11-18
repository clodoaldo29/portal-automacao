import { expect, test } from '@playwright/test';

// The post-dicing inspection cell on its own page (no plant around it). Same cell and same reference as the page
// inside the plant (tests/e2e/memory-flow-cell.spec.ts).
const REFERENCE = { minutes: 45, wafers: 28, lots: 1, ng: 1 };

test.describe('Inspeção pós-corte com IA · página própria', () => {
  test('opens without errors, without the plant, and inspects wafers', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/projetos/adata-inspecao-pos-corte/');
    await expect(page.locator('#stage canvas')).toBeVisible();
    await expect(page.locator('#v-planta')).toHaveCount(0);
    await expect(page.locator('.dock a.dock-link')).toHaveCount(0);
    await page.click('#b-quality');
    await page.evaluate(() => { const c = (window as unknown as { __cell: { cell: { step: (dt: number) => void } } }).__cell.cell; for (let i = 0; i < 30 * 300; i++) c.step(1 / 30); });
    await expect(page.locator('#k-wafers')).not.toHaveText('0');
    expect(errors).toEqual([]);
  });

  test('same throughput as in the plant, and the arm touches nothing', async ({ page }) => {
    await page.goto(`/projetos/adata-inspecao-pos-corte/?bench=${REFERENCE.minutes}`);
    const r = await page.waitForFunction(() => window.__cellBench, null, { timeout: 200_000 }).then(h => h.jsonValue());
    expect({ minutes: r!.minutes, wafers: r!.wafers, lots: r!.lots, ng: r!.ng }).toEqual(REFERENCE);
    expect(r!.minClear).toBeGreaterThan(0);
  });
});
