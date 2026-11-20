import { expect, test } from '@playwright/test';

// Throughput reference: 10 simulated minutes per model, both arms, automatic work split, no NG.
// Re-measured when the jig became the Intellifix AI "base colchão" (32"/43" pair across the belt, near TV first).
// When the line logic is changed on purpose, re-measure and update these numbers in the same commit.
const REFERENCE = [
  { inch: 32, moved: 91, perRobot: [46, 45] },
  { inch: 43, moved: 90, perRobot: [45, 45] },
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
    test(`${ref.inch}": throughput matches the reference with no losses`, async ({ page }) => {
      await page.goto(`/projetos/transfer-flow-3d/?bench=10&model=${ref.inch}`);
      const result = await page.waitForFunction(() => window.__bench, null, { timeout: 200_000 }).then(h => h.jsonValue());
      console.log(`${ref.inch}": ${result!.moved} TVs (${result!.perRobot.join(' / ')}) in ${result!.ms} ms`);
      expect(result!.inch).toBe(ref.inch);
      expect(result!.moved).toBe(ref.moved);
      expect(result!.perRobot).toEqual(ref.perRobot);
      expect(result!.losses).toEqual({ tv: 0, emptyPallet: 0 });
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
