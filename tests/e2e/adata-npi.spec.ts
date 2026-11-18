import { expect, test } from '@playwright/test';

// NPI prototype: the whole release flow of the sample product that is still at the recipes stage.
test.describe('Adata 04 · plataforma NPI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/projetos/adata-npi/');
    await page.evaluate(() => localStorage.removeItem('adata04.npi.v1'));
    await page.reload();
  });

  test('opens without errors and shows the three sample products', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.reload();
    await expect(page.locator('#products li')).toHaveCount(3);
    await expect(page.locator('#stepper li')).toHaveCount(7);
    await expect(page.locator('#release')).toContainText('Liberado no MES');
    await expect(page.locator('#cmp tbody tr')).toHaveCount(5);
    expect(errors).toEqual([]);
  });

  test('a recipe change opens a new version and the product can be released only after every approval', async ({ page }) => {
    // eMMC: two draft recipes, one draft instruction, pilot lot pending
    await page.locator('#products button').nth(2).click();
    await expect(page.locator('#b-release')).toBeDisabled();
    await page.click('#t-receitas');
    await page.locator('.recipes .list button', { hasText: 'Wire bonding' }).click();
    await page.getByRole('button', { name: 'Enviar para aprovação' }).click();
    await page.locator('.recipes .list button', { hasText: 'Moldagem' }).click();
    await page.getByRole('button', { name: 'Enviar para aprovação' }).click();
    // Quality approves both recipes and the instruction
    await page.selectOption('#role', 'qual');
    for (const step of ['Wire bonding', 'Moldagem']) {
      await page.locator('.recipes .list button', { hasText: step }).click();
      await page.getByRole('button', { name: 'Aprovar', exact: true }).click();
    }
    await page.click('#t-instrucoes');
    await page.getByRole('button', { name: 'Aprovar instrução' }).click();
    // Production closes the pilot lot
    await page.selectOption('#role', 'prod');
    await page.click('#t-piloto');
    // each check re-renders the list: always take the first one still open
    const open = page.locator('.checks input:not(:checked)');
    while (await open.count()) await open.first().click();
    await page.getByRole('button', { name: 'Registrar rendimento do piloto' }).click();
    // Quality releases
    await page.selectOption('#role', 'qual');
    await expect(page.locator('#release')).toContainText('Pronto para liberar');
    await page.click('#b-release');
    await expect(page.locator('#release')).toContainText('Liberado no MES');
    await page.click('#t-historico');
    await expect(page.locator('#v-historico')).toContainText('Liberado no MES');
  });

  test('editing an approved recipe keeps the machines on the approved version', async ({ page }) => {
    await page.locator('#products button').nth(1).click();
    await page.click('#t-receitas');
    await page.locator('.recipes .list button', { hasText: 'Wire bonding' }).click();
    const input = page.locator('input.val[data-key="us"]');
    await input.fill('95');
    await input.dispatchEvent('change');
    await expect(page.locator('.recipe-head h3')).toContainText('v2');
    await expect(page.locator('.recipes')).toContainText('Na máquina: v1');
    await expect(page.locator('.diff')).toContainText('90');
    await expect(page.locator('#b-release')).toBeDisabled();
  });
});
