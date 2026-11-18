import { expect, test } from '@playwright/test';

// Smart Solder AI reference: 30 simulated minutes after the warm-up, default (provisional) parameters. Both
// architectures must reach the 350 UPH target, the three robots must solder the same number of blanks (±1), the arms
// must reach every joint (IK error under 1 cm) and never touch anything (positive clearance during the whole run).
// When the line logic or its defaults change on purpose, re-measure and update in the same commit.
const REFERENCE = {
  a: { minutes: 30, boards: 186, blanks: 31, perRobot: [11, 10, 10] },
  b: { minutes: 30, boards: 198, blanks: 33, perRobot: [10, 10, 10] },
};

const run = (page: import('@playwright/test').Page, seconds: number) =>
  page.evaluate(s => { const w = (window as unknown as { __ss: { step: (dt: number) => void; panel: () => void } }).__ss; for (let i = 0; i < 30 * s; i++) w.step(1 / 30); w.panel(); }, seconds);

for (const a of ['a', 'b'] as const) {
  test.describe(`Smart Solder AI · arquitetura ${a.toUpperCase()}`, () => {
    test('opens without errors, produces, and shows the balance of the three robots', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(`/projetos/smart-solder-${a}/`);
      await expect(page.locator('#stage canvas')).toBeVisible();
      await page.click('#b-quality');
      await run(page, 400);
      await expect(page.locator('#k-uph')).not.toHaveText('—');
      await expect(page.locator('#rob-rows tr')).toHaveCount(a === 'a' ? 4 : 3);
      await expect(page.locator('#cmp-rows tr')).toHaveCount(2);
      await expect(page.locator('#st-rows tr')).toHaveCount(5);
      await expect(page.locator('#b-other')).toHaveText(`Ver arquitetura ${a === 'a' ? 'B' : 'A'}`);
      expect(errors).toEqual([]);
    });

    test('throughput matches the reference, the robots share the work equally, reach every joint and touch nothing', async ({ page }) => {
      const ref = REFERENCE[a];
      await page.goto(`/projetos/smart-solder-${a}/?bench=${ref.minutes}`);
      const r = (await page.waitForFunction(() => window.__ssBench, null, { timeout: 200_000 }).then(h => h.jsonValue()))!;
      console.log(`smart solder ${a}: ${r.boards} placas, ${r.blanks} blanks, por robô ${r.perRobot.join('/')}, IK ${r.maxIkErr} m, folga mínima ${r.minClear} m (${r.minClearAt}) (${r.ms} ms)`);
      expect({ minutes: r.minutes, boards: r.boards, blanks: r.blanks, perRobot: r.perRobot }).toEqual(ref);
      expect((r.boards / r.minutes) * 60, 'meta de 350 UPH').toBeGreaterThanOrEqual(350);
      expect(Math.max(...r.perRobot) - Math.min(...r.perRobot), 'mesma carga nos três robôs').toBeLessThanOrEqual(1);
      expect(r.maxIkErr).toBeLessThan(0.01);
      expect(r.minClear, `o robô encostou em: ${r.minClearAt}`).toBeGreaterThan(0);
    });
  });
}

test('Smart Solder AI · NOK blanks go to the NOK rack, never to the magazine', async ({ page }) => {
  await page.goto('/projetos/smart-solder-b/');
  await page.click('#b-quality');
  await page.click('#b-nok');
  const r = await page.evaluate(() => {
    type B = { result: string | null };
    const w = (window as unknown as { __ss: { step: (dt: number) => void; line: { outs: { b: B; state: string }[]; magazine: { fill: number } | null; stats: { okBlanks: number; nokBlanks: number; incBlanks: number; magazines: number } } } }).__ss;
    let wrong = 0;
    for (let i = 0; i < 30 * 1200; i++) {
      w.step(1 / 30);
      for (const o of w.line.outs) if (o.state === 'push' && o.b.result !== 'ok') wrong++;
    }
    const s = w.line.stats;
    return { wrong, nok: s.nokBlanks + s.incBlanks, ok: s.okBlanks };
  });
  expect(r.nok).toBeGreaterThan(0);
  expect(r.wrong).toBe(0);
  await page.evaluate(() => (window as unknown as { __ss: { panel: () => void } }).__ss.panel());
  await expect(page.locator('#q-seg')).not.toHaveText('0');
});
