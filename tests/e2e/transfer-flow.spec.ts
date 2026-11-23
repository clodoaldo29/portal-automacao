import { expect, test } from '@playwright/test';

// Throughput reference: 10 simulated minutes per model, both arms, automatic work split, no NG — and nothing may
// touch: the bench measures the smallest clearance over the whole run (arms, gripper and the TV they carry against
// their own arm, the TVs on the jigs and pallets, jigs, pallets, belts, lifts and the other robot).
// Re-measured with the transfers 12.5 cm toward the test belt, cups 18 cm off the bracket and the grip point scaled to
// the TV (collision-free in every model). When the line logic is changed on purpose, re-measure and update in the
// same commit.
const REFERENCE = [
  { inch: 32, moved: 91, perRobot: [46, 45] },
  { inch: 43, moved: 91, perRobot: [46, 45] },
  { inch: 50, moved: 106, perRobot: [54, 52] },
  { inch: 55, moved: 106, perRobot: [54, 52] },
  { inch: 65, moved: 106, perRobot: [54, 52] },
  { inch: 75, moved: 106, perRobot: [54, 52] },
];

test.describe('Transfer Flow 3D', () => {
  test('opens without errors and draws the scene', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/projetos/transfer-flow-3d/');
    await expect(page.locator('#stage canvas')).toBeVisible();
    await expect(page.locator('#k-prod')).not.toHaveText('');
    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
  });

  for (const ref of REFERENCE) {
    test(`${ref.inch}": throughput matches the reference, no losses, nothing touches`, async ({ page }) => {
      await page.goto(`/projetos/transfer-flow-3d/?bench=10&model=${ref.inch}`);
      const result = await page.waitForFunction(() => window.__bench, null, { timeout: 300_000 }).then(h => h.jsonValue());
      console.log(`${ref.inch}": ${result!.moved} TVs (${result!.perRobot.join(' / ')}), folga mínima ${result!.minClear} m (${result!.minClearAt}) in ${result!.ms} ms`);
      expect(result!.inch).toBe(ref.inch);
      expect(result!.moved).toBe(ref.moved);
      expect(result!.perRobot).toEqual(ref.perRobot);
      expect(result!.losses).toEqual({ tv: 0, emptyPallet: 0 });
      expect(result!.minClear, `nada pode encostar: ${result!.minClearAt}`).toBeGreaterThan(0.005);
    });
  }
});

test('portal lists the projects and links to the simulation', async ({ page }) => {
  await page.goto('/');
  // cards are sorted by update date: find this project's card by name
  const card = page.locator('article.card', { has: page.locator('h2', { hasText: 'Transfer Flow 3D' }) });
  await expect(card.locator('h2')).toHaveText('Transfer Flow 3D');
  await expect(card.locator('a.open-sim')).toHaveAttribute('href', 'projetos/transfer-flow-3d/');
  await card.locator('a.open-sim').click();
  await expect(page).toHaveURL(/\/projetos\/transfer-flow-3d\/$/);
});
