import { expect, test } from '@playwright/test';

// Cards in a row always have the same size, with the "Abrir simulação 3D" button at the same height.
for (const width of [1280, 800]) {
  test(`portal cards keep the same size (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const cards = page.locator('article.card');
    await expect(cards.first()).toBeVisible();
    const rows = await cards.evaluateAll(els => els.map(e => {
      const r = e.getBoundingClientRect(), b = e.querySelector('a.open-sim')?.getBoundingClientRect();
      return { top: Math.round(r.top), h: Math.round(r.height), btn: b ? Math.round(b.top) : -1 };
    }));
    if (process.env.MF_SHOTS) await page.screenshot({ path: `${process.env.MF_SHOTS}/portal-${width}.png`, fullPage: true });
    const byRow = new Map<number, typeof rows>();
    rows.forEach(r => byRow.set(r.top, [...(byRow.get(r.top) ?? []), r]));
    for (const row of byRow.values()) {
      expect(new Set(row.map(r => r.h)).size, 'same height in a row').toBe(1);
      expect(new Set(row.map(r => r.btn)).size, 'buttons aligned in a row').toBe(1);
    }
  });
}

test('cards follow the order of projetos.json: the first project stays first, new ones go to the end', async ({ page }) => {
  await page.goto('/');
  const names = await page.locator('article.card h2').allTextContents();
  const json = await page.evaluate(() => fetch('/projetos.json').then(r => r.json()));
  expect(names).toEqual((json as { name: string }[]).map(p => p.name));
  expect(names[0]).toBe('Transfer Flow 3D');
});
