import { expect, test } from '@playwright/test';

// "Projetos" layer of the plant: one pin per portfolio project over the area where it acts; a click opens the project.
/* eslint-disable @typescript-eslint/no-explicit-any */
test.describe('Memory Flow 3D · projetos na planta', () => {
  test('shows a pin per project and the button hides them', async ({ page }) => {
    await page.goto('/projetos/memory-flow-3d/');
    await page.click('#b-quality');
    await expect(page.locator('#legend')).toContainText('Projetos');
    expect(await page.evaluate(() => (window as any).__mfProjects.sprites().length)).toBe(7);
    await page.click('#b-proj');
    expect(await page.evaluate(() => (window as any).__mfProjects.visible)).toBe(false);
    await expect(page.locator('#b-proj')).toHaveAttribute('aria-pressed', 'false');
  });

  test('clicking the pin of a project opens its page', async ({ page }) => {
    await page.goto('/projetos/memory-flow-3d/');
    await page.click('#b-quality');
    // look at the packing area (L05, project 05) and click its pin: it opens the packing cell inside this plant
    const pt = await page.evaluate(() => {
      const s = (window as any).__mf.stage, sprite = (window as any).__mfProjects.sprites()[4];
      s.camera.position.set(-30, 30, 2); s.controls.target.set(-30, 0, -10); s.controls.update();
      s.camera.updateMatrixWorld();
      const v = sprite.position.clone().project(s.camera), c = document.querySelector('#stage canvas')!.getBoundingClientRect();
      return { x: c.left + ((v.x + 1) / 2) * c.width, y: c.top + ((1 - v.y) / 2) * c.height };
    });
    await page.waitForTimeout(500);
    await page.mouse.click(pt.x, pt.y);
    await expect(page).toHaveURL(/\/projetos\/memory-flow-3d\/embalagem\/$/);
  });
});

test('the "Projetos Adata" menu has a shortcut to every project', async ({ page }) => {
  await page.goto('/projetos/memory-flow-3d/');
  await page.click('#b-quality');
  await page.click('#m-proj summary');
  const links = page.locator('#proj-links a');
  await expect(links).toHaveCount(7);
  if (process.env.MF_SHOTS) await page.screenshot({ path: `${process.env.MF_SHOTS}/mf-menu.png` });
  await expect(links.nth(1)).toHaveAttribute('href', '/projetos/memory-flow-3d/substratos/');
  await links.nth(3).click();
  await expect(page).toHaveURL(/\/projetos\/adata-npi\/$/);
});
