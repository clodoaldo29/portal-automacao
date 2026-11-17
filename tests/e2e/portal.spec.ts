import { expect, test } from '@playwright/test';

// Cards in a row always have the same size, with the "Abrir simulação 3D" button at the same height.
for (const width of [1280, 800]) {
  test(`portal cards keep the same size (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const cards = page.locator('article.card');
    await expect(cards).toHaveCount(2);
    await page.locator('article.card img').first().evaluate(img => (img as HTMLImageElement).decode?.().catch(() => {}));
    const boxes = await cards.evaluateAll(els => els.map(e => e.getBoundingClientRect()).map(r => ({ top: Math.round(r.top), h: Math.round(r.height) })));
    const buttons = await page.locator('article.card a.open-sim').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
    if (process.env.MF_SHOTS) await page.screenshot({ path: `${process.env.MF_SHOTS}/portal-${width}.png`, fullPage: true });
    // same row (same top): same height and the button at the same place
    if (boxes[0].top === boxes[1].top) {
      expect(boxes[0].h).toBe(boxes[1].h);
      expect(buttons[0]).toBe(buttons[1]);
    }
  });
}
