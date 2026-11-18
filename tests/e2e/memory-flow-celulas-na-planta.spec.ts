import { expect, test } from '@playwright/test';

// Project cells running inside the Memory Flow plant, at their place (like the post-dicing cell in P01C).
/* eslint-disable @typescript-eslint/no-explicit-any */
const PAGES = [
  { slug: 'microscopia', area: 'Q01', global: '__a01', sim: 'st', kpi: '#cmp tbody tr:nth-child(7) td:nth-child(3)' }, // images in the bank, digital bench
  { slug: 'substratos', area: 'P01D', global: '__a02', sim: 'cell', kpi: '#k-strips' },
  { slug: 'retrabalho', area: 'P02B', global: '__a03', sim: 'cell', kpi: '#k-ics' },
  { slug: 'embalagem', area: 'L05', global: '__a05', sim: 'cell', kpi: '#k-bags' },
];

for (const p of PAGES) {
  test(`${p.slug}: works inside the plant like the post-dicing cell`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`/projetos/memory-flow-3d/${p.slug}/`);
    await expect(page.locator('#stage canvas')).toBeVisible();
    // like the post-dicing cell: a Memory Flow page, open on the cell, with "Na planta" and the way back to the plant
    await expect(page.locator('.plaque h1')).toHaveText('MEMORY FLOW');
    await expect(page.locator('#v-planta')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.dock a.dock-link[href="../"]')).toBeVisible();
    await page.click('#b-quality');
    // the plant was built around the cell, in its area
    await expect(page.locator('body')).toHaveAttribute('data-plant-built', p.area);
    await page.evaluate(([g, s]) => { const x = (window as any)[g][s]; for (let i = 0; i < 30 * 400; i++) x.step(1 / 30); (window as any)[g].panel(); }, [p.global, p.sim]);
    await expect(page.locator(p.kpi).first()).not.toHaveText(/^(0|—)$/);
    if (process.env.MF_SHOTS) { await page.click('#v-planta'); await page.waitForTimeout(3000); await page.screenshot({ path: `${process.env.MF_SHOTS}/np-${p.slug}.png` }); }
    expect(errors).toEqual([]);
  });
}

test('inside a project the projects menu and the way back to the plant stay in the bar', async ({ page }) => {
  await page.goto('/projetos/memory-flow-3d/embalagem/');
  await expect(page.locator('.dock a.dock-link[href="../"]')).toBeVisible();
  await page.click('#m-proj summary');
  await expect(page.locator('#proj-links a')).toHaveCount(7);
  await expect(page.locator('#proj-links a[aria-current="page"]')).toContainText('Embalagem final');
  await page.locator('#proj-links a', { hasText: 'Inspeção pós-corte' }).click();
  await expect(page).toHaveURL(/\/projetos\/memory-flow-3d\/inspecao\/$/);
  await expect(page.locator('#m-proj summary')).toBeVisible();
  await expect(page.locator('.dock a.dock-link[href="../"]')).toBeVisible();
});

for (const [slug, current] of [['movimentacao', 'Movimentação com AMR'], ['npi', 'Plataforma NPI']]) {
  test(`${slug}: same pattern as the other projects (Memory Flow bar, Planta, projects menu)`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`/projetos/memory-flow-3d/${slug}/`);
    await expect(page.locator('.plaque h1')).toHaveText('MEMORY FLOW');
    await expect(page.locator('a.dock-link[href="../"]')).toBeVisible();
    await page.click('#m-proj summary');
    await expect(page.locator('#proj-links a')).toHaveCount(7);
    await expect(page.locator('#proj-links a[aria-current="page"]')).toContainText(current);
    await page.locator('a.dock-link[href="../"]').click({ force: true });
    await expect(page).toHaveURL(/\/projetos\/memory-flow-3d\/$/);
    expect(errors).toEqual([]);
  });
}
