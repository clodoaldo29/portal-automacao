import { expect, test } from '@playwright/test';

// Microscope stations reference: 30 simulated minutes from the start, default (provisional) parameters.
// Both benches inspect the same lots; the digital bench must finish more lots and keep an image of every defect.
// When the model or its defaults change on purpose, re-measure and update in the same commit.
const REFERENCE = { minutes: 30, today: { lots: 2, defects: 8, traceable: 7 }, digital: { lots: 4, defects: 14, images: 14 } };

type St = { step: (dt: number) => void };
const run = (page: import('@playwright/test').Page, seconds: number) =>
  page.evaluate(s => { const x = (window as unknown as { __a01: { st: St } }).__a01.st; for (let i = 0; i < 30 * s; i++) x.step(1 / 30); (window as unknown as { __a01: { panel: () => void } }).__a01.panel(); }, seconds);

test.describe('Adata 01 · microscopia digital', () => {
  test('opens without errors, compares the benches and fills the image gallery', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/projetos/adata-microscopia/');
    await expect(page.locator('#stage canvas')).toBeVisible();
    await page.click('#b-quality');
    await run(page, 900);
    await expect(page.locator('#cmp thead th')).toHaveText(['', 'Hoje', 'Digital']);
    await expect(page.locator('#cmp tbody tr').first().locator('td').nth(2)).not.toHaveText('—');
    await expect(page.locator('#gallery figure').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('results match the reference', async ({ page }) => {
    await page.goto(`/projetos/adata-microscopia/?bench=${REFERENCE.minutes}`);
    const r = await page.waitForFunction(() => window.__a01Bench, null, { timeout: 150_000 }).then(h => h.jsonValue());
    console.log(`microscopia: hoje ${r!.today.lots} lotes, digital ${r!.digital.lots} lotes, ${r!.digital.images} imagens (${r!.ms} ms)`);
    expect({ minutes: r!.minutes, today: r!.today, digital: r!.digital }).toEqual(REFERENCE);
  });
});
