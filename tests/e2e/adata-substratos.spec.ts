import { expect, test } from '@playwright/test';

// Substrate inspection reference: 10 simulated minutes from the start, default (provisional) parameters, normal lot.
// When the machine logic, the strip model or its defaults change on purpose, re-measure and update in the same
// commit (tests/unit/adata-substratos.test.ts covers the strip model).
const REFERENCE = { minutes: 10, strips: 94, ng: 0, xouts: 188 };

type Cell = { step: (dt: number) => void; stats: { strips: number; ng: number } };
const run = (page: import('@playwright/test').Page, seconds: number) =>
  page.evaluate(s => { const c = (window as unknown as { __a02: { cell: Cell } }).__a02.cell; for (let i = 0; i < 30 * s; i++) c.step(1 / 30); }, seconds);

test.describe('Adata 02 · substratos', () => {
  test('opens without errors and inspects strips', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/projetos/adata-substratos/');
    await expect(page.locator('#stage canvas')).toBeVisible();
    await page.click('#b-quality');
    await run(page, 150);
    await expect(page.locator('#k-sph')).not.toHaveText('—');
    await expect(page.locator('#strip-note')).toContainText('Tira');
    await expect(page.locator('#def-rows tr')).toHaveCount(5);
    expect(errors).toEqual([]);
  });

  test('an oxidised lot sends strips to the NG magazine', async ({ page }) => {
    await page.goto('/projetos/adata-substratos/');
    await page.click('#b-quality');
    await page.click('#b-ox');
    await run(page, 150);
    const s = await page.evaluate(() => (window as unknown as { __a02: { cell: Cell } }).__a02.cell.stats);
    expect(s.ng / s.strips).toBeGreaterThan(0.5);
    await expect(page.locator('#k-ng')).not.toHaveText('0');
  });

  test('throughput matches the reference', async ({ page }) => {
    await page.goto(`/projetos/adata-substratos/?bench=${REFERENCE.minutes}`);
    const r = await page.waitForFunction(() => window.__a02Bench, null, { timeout: 120_000 }).then(h => h.jsonValue());
    console.log(`substratos: ${r!.strips} tiras, ${r!.ng} NG, ${r!.xouts} X-out (${r!.ms} ms)`);
    expect({ minutes: r!.minutes, strips: r!.strips, ng: r!.ng, xouts: r!.xouts }).toEqual(REFERENCE);
  });
});
