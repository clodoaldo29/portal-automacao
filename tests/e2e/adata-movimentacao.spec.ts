import { expect, test } from '@playwright/test';

// Project 06 runs on the Memory Flow plant engine: with the default parameters and AMRs it must give exactly the
// plant's AMR reference (tests/e2e/memory-flow.spec.ts).
const REFERENCE = { lotsOut: 187, leadTimeH: 64.3, bottleneck: 'INS' };

test.describe('Adata 06 · movimentação com AMR', () => {
  test('opens without errors, shows the fleet and compares manual × AMR', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/projetos/adata-movimentacao/');
    await expect(page.locator('#stage canvas')).toBeVisible();
    await expect(page.locator('#k-moves')).not.toHaveText('—');
    await expect(page.locator('#fleet-rows tr')).toHaveCount(3);
    await expect(page.locator('#cmp thead th')).toHaveText(['', 'Manual', 'AMR']);
    await page.click('#b-quality');
    const shots = process.env.MF_SHOTS;
    if (shots) {
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${shots}/a06-geral.png` });
      await page.click('#v-seguir');
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${shots}/a06-seguir.png` });
    }
    expect(errors).toEqual([]);
  });

  test('sizes the fleet and recommends a number of AMRs', async ({ page }) => {
    await page.goto('/projetos/adata-movimentacao/');
    await page.click('#b-quality');
    await page.click('#tab-dim');
    await page.click('#d-run');
    await expect(page.locator('#d-out table.cmp')).toHaveCount(2, { timeout: 60_000 });
    await expect(page.locator('#d-out table.cmp').first().locator('tbody tr')).toHaveCount(6);
    await expect(page.locator('#d-out table.cmp').first()).toContainText('recomendado');
    if (process.env.MF_SHOTS) await page.screenshot({ path: `${process.env.MF_SHOTS}/a06-dim.png` });
  });

  test('changing the fleet changes the result and switching to manual shows operators', async ({ page }) => {
    await page.goto('/projetos/adata-movimentacao/');
    await page.click('#b-quality');
    await page.click('#tab-par');
    await page.fill('#p-amrs', '1');
    await page.click('#p-apply');
    await expect(page.locator('#p-status')).toContainText('AMR: espera');
    await expect(page.locator('#fleet-rows tr')).toHaveCount(1);
    await page.click('#p-reset');
    await page.selectOption('#scenario', 'atual');
    await expect(page.locator('#fleet-title')).toContainText('operadores');
  });

  test('flow matches the plant reference', async ({ page }) => {
    await page.goto('/projetos/adata-movimentacao/?bench=14');
    const r = await page.waitForFunction(() => window.__a06Bench, null, { timeout: 60_000 }).then(h => h.jsonValue());
    expect({ lotsOut: r!.lotsOut, leadTimeH: r!.leadTimeH, bottleneck: r!.bottleneck }).toEqual(REFERENCE);
  });
});
