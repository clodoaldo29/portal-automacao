import { expect, test } from '@playwright/test';

// Flow reference: 14 simulated days after a 7-day warm-up, default (provisional) parameters, seed 1.
// Same table as tests/unit/memory-flow.test.ts (the page must run the very same engine).
// When the model or the default parameters change on purpose, re-measure and update both tables in the same commit.
const REFERENCE = [
  { scenario: 'atual', lotsOut: 189, leadTimeH: 67.9, bottleneck: 'INS' },
  { scenario: 'amr', lotsOut: 187, leadTimeH: 64.3, bottleneck: 'INS' },
  { scenario: 'amr-ia', lotsOut: 190, leadTimeH: 62.1, bottleneck: 'DAB' },
];

test.describe('Memory Flow 3D', () => {
  test('opens without errors, draws the plant and fills the panel', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/projetos/memory-flow-3d/');
    await expect(page.locator('#stage canvas')).toBeVisible();
    await expect(page.locator('#k-lots')).not.toHaveText('—');
    await expect(page.locator('#k-bott')).toContainText('%');
    await expect(page.locator('#stage-rows tr')).toHaveCount(8);
    await page.waitForTimeout(1500);
    // optional screenshots of every camera, for visual review: MF_SHOTS=<folder>
    const shots = process.env.MF_SHOTS;
    if (shots) {
      await page.click('#b-quality');
      for (const v of ['planta', 'limpa', 'testes', 'utilidades', 'logistica', 'cima']) {
        await page.click(`#v-${v}`);
        await page.waitForTimeout(3500);
        await page.screenshot({ path: `${shots}/mf-${v}.png` });
      }
    }
    expect(errors).toEqual([]);
  });

  test('compares the three scenarios and restarts with new parameters', async ({ page }) => {
    await page.goto('/projetos/memory-flow-3d/');
    await page.click('#b-quality'); // lighter rendering on the software GPU
    await page.click('#tab-cmp');
    await expect(page.locator('#c-out table.cmp')).toHaveCount(2, { timeout: 60_000 });
    await expect(page.locator('#c-out table.cmp').first().locator('thead th')).toHaveText(['', 'Atual', 'AMR', 'AMR + IA']);
    await page.click('#tab-par');
    await page.fill('#p-release', '16');
    await page.click('#p-apply');
    await expect(page.locator('#p-status')).toContainText('reiniciada');
    const release = await page.evaluate(() => (window as unknown as { __mf: { engine: { params: { release: number } } } }).__mf.engine.params.release);
    expect(release).toBe(16);
    await page.click('#p-reset');
  });

  test('clicking a machine opens its card', async ({ page }) => {
    await page.goto('/projetos/memory-flow-3d/');
    await page.click('#b-quality');
    // look straight down at DIC02 (plan x 34.0, z 66.8) and click the centre of the canvas
    await page.evaluate(() => {
      const s = (window as unknown as { __mf: { stage: { camera: { position: { set: (...a: number[]) => void } }; controls: { target: { set: (...a: number[]) => void }; update: () => void } } } }).__mf.stage;
      s.camera.position.set(-26, 14, 21.9); s.controls.target.set(-26, 0, 21.8); s.controls.update();
    });
    await page.waitForTimeout(1500);
    const box = (await page.locator('#stage canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('#info')).toBeVisible();
    await expect(page.locator('#info-title')).toHaveText('P01C · DIC02');
    await expect(page.locator('#info-dl')).toContainText('Corte (laser ou disco)');
  });

  for (const ref of REFERENCE) {
    test(`${ref.scenario}: flow matches the reference`, async ({ page }) => {
      await page.goto(`/projetos/memory-flow-3d/?bench=14&cenario=${ref.scenario}`);
      const r = await page.waitForFunction(() => window.__mfBench, null, { timeout: 60_000 }).then(h => h.jsonValue());
      console.log(`${ref.scenario}: ${r!.lotsOut} lotes, lead time ${r!.leadTimeH} h, gargalo ${r!.bottleneck} (${r!.ms} ms)`);
      expect({ scenario: r!.scenario, lotsOut: r!.lotsOut, leadTimeH: r!.leadTimeH, bottleneck: r!.bottleneck }).toEqual(ref);
    });
  }
});

test('portal lists Memory Flow 3D with its cover and link', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('article.card', { has: page.locator('h2', { hasText: 'Memory Flow 3D' }) });
  await expect(card.locator('.client')).toHaveText('Adata Technology');
  await expect(card.locator('.metric span').first()).toHaveText('Capacidade');
  await expect(card.locator('a.open-sim')).toHaveAttribute('href', 'projetos/memory-flow-3d/');
});
