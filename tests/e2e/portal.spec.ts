import { expect, test } from '@playwright/test';

type P = { name: string; client: string };
const json = (page: import('@playwright/test').Page) => page.evaluate(() => fetch('/projetos.json').then(r => r.json())) as Promise<P[]>;

// Cards in a row always have the same size, with the "Abrir simulação 3D" button at the same height.
for (const width of [1280, 800]) {
  test(`portal cards keep the same size (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?cliente=adata');
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

test('the portal opens on the client cards: by their first project in projetos.json, then the clients with no project yet', async ({ page }) => {
  await page.goto('/');
  const names = await page.locator('a.client-card h2').allTextContents();
  const list = await json(page);
  const known = await page.evaluate(() => fetch('/clientes.json').then(r => r.json())) as { name: string }[];
  const withProjects = [...new Set(list.map(p => p.client))];
  expect(names).toEqual([...withProjects, ...known.map(c => c.name).filter(n => !withProjects.includes(n))]);
  expect(names[0]).toBe('Grupo Multilaser');
  expect(names).toContain('Denso');
  // every logo of clientes.json loads
  await page.waitForLoadState('networkidle');
  const broken = await page.locator('a.client-card .logo img').evaluateAll(imgs => imgs.filter(i => !(i as HTMLImageElement).naturalWidth).length);
  expect(broken).toBe(0);
  await expect(page.locator('article.card')).toHaveCount(0);
  if (process.env.MF_SHOTS) await page.screenshot({ path: `${process.env.MF_SHOTS}/portal-clientes.png`, fullPage: true });
});

test('a client card opens its projects in the order of projetos.json, and "back" returns to the clients', async ({ page }) => {
  await page.goto('/');
  await page.locator('a.client-card', { hasText: 'Grupo Multilaser' }).click();
  await expect(page).toHaveURL(/\?cliente=multilaser$/);
  const names = await page.locator('article.card h2').allTextContents();
  const list = await json(page);
  expect(names).toEqual(list.filter(p => p.client === 'Grupo Multilaser').map(p => p.name));
  expect(names[0]).toBe('Transfer Flow 3D');
  await page.goBack();
  await expect(page.locator('a.client-card', { hasText: 'Grupo Multilaser' })).toBeVisible();
  await expect(page.locator('article.card')).toHaveCount(0);
  await page.goForward();
  await expect(page.locator('article.card')).toHaveCount(names.length);
  await page.locator('.crumb .back').click();
  await expect(page.locator('a.client-card').first()).toBeVisible();
});

test('a client with no project yet opens an empty client area', async ({ page }) => {
  await page.goto('/');
  await page.locator('a.client-card', { hasText: 'Denso' }).click();
  await expect(page).toHaveURL(/\?cliente=denso$/);
  await expect(page.locator('.state h2')).toHaveText('Nenhum projeto de Denso publicado ainda');
  if (process.env.MF_SHOTS) await page.screenshot({ path: `${process.env.MF_SHOTS}/portal-denso.png` });
});

test('the search on the client cards looks in every client\'s projects', async ({ page }) => {
  await page.goto('/');
  await page.locator('#q').fill('AMR');
  const names = await page.locator('article.card h2').allTextContents();
  expect(names).toContain('Movimentação Interna com AMR');
  await page.locator('#q').fill('');
  await expect(page.locator('a.client-card').first()).toBeVisible();
});
