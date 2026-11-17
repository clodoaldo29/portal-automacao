import { expect, test } from '@playwright/test';

// 3D inspection reference: 10 simulated minutes from the start, default (provisional) parameters, normal rework.
// When the machine logic, the measurement model or its defaults change on purpose, re-measure and update in the
// same commit (the unit tests in tests/unit/adata-retrabalho.test.ts cover the measurement model).
const REFERENCE = { minutes: 10, ics: 552, rejected: 22, trays: 3 };

type Cell = { step: (dt: number) => void };
const run = (page: import('@playwright/test').Page, seconds: number) =>
  page.evaluate(s => { const c = (window as unknown as { __a03: { cell: Cell } }).__a03.cell; for (let i = 0; i < 30 * s; i++) c.step(1 / 30); }, seconds);

test.describe('Adata 03 · ICs retrabalhados', () => {
  test('opens without errors, measures packages and maps the tray', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/projetos/adata-retrabalho/');
    await expect(page.locator('#stage canvas')).toBeVisible();
    await page.click('#b-quality');
    await run(page, 200);
    await expect(page.locator('#k-iph')).not.toHaveText('—');
    await expect(page.locator('#ic-data li').first()).toHaveText(/Aprovado|Reprovado|Medindo/);
    await expect(page.locator('#def-rows tr')).toHaveCount(5);
    expect(errors).toEqual([]);
  });

  test('a poor rework batch raises the rejects', async ({ page }) => {
    await page.goto('/projetos/adata-retrabalho/');
    await page.click('#b-quality');
    await page.click('#b-bad');
    await run(page, 200);
    // read the simulation itself (the panel refreshes 4 times a second)
    const share = await page.evaluate(() => { const s = (window as unknown as { __a03: { cell: { stats: { ics: number; rejected: number } } } }).__a03.cell.stats; return s.ics ? s.rejected / s.ics : 0; });
    expect(share).toBeGreaterThan(0.08);
    await expect(page.locator('#k-rej')).not.toHaveText('0');
  });

  test('throughput matches the reference', async ({ page }) => {
    await page.goto(`/projetos/adata-retrabalho/?bench=${REFERENCE.minutes}`);
    const r = await page.waitForFunction(() => window.__a03Bench, null, { timeout: 120_000 }).then(h => h.jsonValue());
    console.log(`retrabalho: ${r!.ics} ICs, ${r!.rejected} reprovados, ${r!.trays} bandejas (${r!.ms} ms)`);
    expect({ minutes: r!.minutes, ics: r!.ics, rejected: r!.rejected, trays: r!.trays }).toEqual(REFERENCE);
  });
});
