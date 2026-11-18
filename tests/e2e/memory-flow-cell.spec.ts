import { expect, test } from '@playwright/test';

// Inspection cell reference: 45 simulated minutes from the start, default (provisional) parameters, normal blade.
// Covers one cassette swap by the AMR. The robot must reach every point: IK error under 5 mm.
// When the cell logic or its defaults change on purpose, re-measure and update in the same commit.
const REFERENCE = { minutes: 45, wafers: 28, lots: 1, ng: 1 };

test.describe('Memory Flow 3D · inspection cell', () => {
  test('opens without errors and inspects wafers', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/projetos/memory-flow-3d/inspecao/');
    await expect(page.locator('#stage canvas')).toBeVisible();
    await page.click('#b-quality');
    // five simulated minutes at once, then the panel must show output and a wafer map
    await page.evaluate(() => { const c = (window as unknown as { __cell: { cell: { step: (dt: number) => void } } }).__cell.cell; for (let i = 0; i < 30 * 300; i++) c.step(1 / 30); });
    await expect(page.locator('#k-wafers')).not.toHaveText('0');
    await expect(page.locator('#k-wph')).not.toHaveText('—');
    await expect(page.locator('#wafer-legend li').first()).toHaveText(/Aprovado|Reprovado|Analisando/);
    expect(errors).toEqual([]);
  });

  test('throughput matches the reference and the robot reaches every point', async ({ page }) => {
    await page.goto(`/projetos/memory-flow-3d/inspecao/?bench=${REFERENCE.minutes}`);
    const r = await page.waitForFunction(() => window.__cellBench, null, { timeout: 200_000 }).then(h => h.jsonValue());
    console.log(`célula: ${r!.wafers} wafers, ${r!.lots} lote, ${r!.ng} reprovado, IK ${r!.maxIkErr} m (${r!.ms} ms)`);
    expect({ minutes: r!.minutes, wafers: r!.wafers, lots: r!.lots, ng: r!.ng }).toEqual(REFERENCE);
    expect(r!.maxIkErr).toBeLessThan(0.005);
    // the arm links never touch the enclosure, the stage, the camera bridge or the cassettes
    expect(r!.minClear, `o braço encostou em: ${r!.minClearAt}`).toBeGreaterThan(0);
  });

  test('the plant links to the cell and back', async ({ page }) => {
    await page.goto('/projetos/memory-flow-3d/');
    await page.click('#l-cell');
    await expect(page).toHaveURL(/\/projetos\/memory-flow-3d\/inspecao\/$/);
    await expect(page.locator('.plaque p')).toContainText('inspeção pós-corte');
    await page.locator('.dock a.dock-link').click();
    await expect(page).toHaveURL(/\/projetos\/memory-flow-3d\/$/);
  });
});
