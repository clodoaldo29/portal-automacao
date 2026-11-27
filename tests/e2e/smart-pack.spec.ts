import { expect, test } from '@playwright/test';

// Smart Pack reference: 10 simulated minutes of a 55" lot at the line cadence (110 TV/h), default (provisional)
// parameters. Every TV taken from the test line is bagged, set in a base and covered; the robot reaches every point and
// nothing touches at station 1 (its arm, the hook and the TV it carries against its own arm, the test pallets and their
// TVs, the belts, the bagger cabin): the clearance must stay over 5 mm, as on the Transfer Flow. The joints stay within
// the programmed share of the Zu 50 rated speeds and the payload within its load curve.
// When the line logic or its defaults change on purpose, re-measure and update in the same commit.
const REFERENCE = { inch: 55, minutes: 10, picked: 18, packed: 19 };

test.describe('Smart Pack', () => {
  test('opens without errors and packs TVs', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/projetos/smart-pack/');
    await expect(page.locator('#stage canvas')).toBeVisible();
    await page.click('#b-quality');
    await page.evaluate(() => { const sp = (window as unknown as { __sp: { step: (dt: number) => void; panel: () => void } }).__sp; for (let i = 0; i < 30 * 150; i++) sp.step(1 / 30); sp.panel(); });
    await expect(page.locator('#k-rate')).not.toHaveText('—');
    await expect(page.locator('#st-rows tr')).toHaveCount(4);
    expect(errors).toEqual([]);
  });

  test('55": throughput matches the reference, the robot reaches every point and touches nothing', async ({ page }) => {
    await page.goto(`/projetos/smart-pack/?bench=${REFERENCE.minutes}&model=${REFERENCE.inch}`);
    const r = await page.waitForFunction(() => window.__spBench, null, { timeout: 240_000 }).then(h => h.jsonValue());
    console.log(`smart pack ${r!.inch}": ${r!.picked} retiradas, ${r!.packed} cobertas, IK ${r!.maxIkErr}, folga mínima ${r!.minClear} m (${r!.minClearAt}) (${r!.ms} ms)`);
    expect({ inch: r!.inch, minutes: r!.minutes, picked: r!.picked, packed: r!.packed }).toEqual(REFERENCE);
    expect(r!.maxIkErr).toBeLessThan(0.01);
    // JAKA Zu 50 manual: joints programmed to 80 % of the rated speed (a frame of control lag allowed), payload under the
    // load curve at its centre-of-gravity distance (TV masses are provisional estimates)
    expect(Math.max(...r!.jointPct), `juntas (% da nominal): ${r!.jointPct}`).toBeLessThanOrEqual(88);
    expect(r!.loadKg).toBeLessThanOrEqual(r!.loadCapKg);
    expect(r!.minClear, `nada pode encostar: ${r!.minClearAt}`).toBeGreaterThan(0.005);
  });
});
