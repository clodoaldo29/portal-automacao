import { test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const SP = process.env.SP!;
test('tf relatório do programa', async ({ page }) => {
  test.setTimeout(900_000);
  const out: string[] = [];
  page.on('pageerror', e => out.push('ERRO ' + e.message));
  page.on('console', m => { if (m.type() === 'warning' && !/GL Driver/.test(m.text())) out.push('aviso ' + m.text().slice(0, 140)); });
  for (const inch of (process.env.INCHES ?? '32,43,50,55,65,75').split(',')) {
    await page.goto(`/projetos/transfer-flow-3d/?model=${inch}`);
    await page.waitForFunction(() => (window as any).__tf);
    await page.getByRole('button', { name: 'Pausar' }).click();
    const r: string[] = await page.evaluate(() => (window as any).__tf.report());
    out.push(`== ${inch}"`, ...r.filter(s => process.env.ALL || !/ mm/.test(s) || Number(s.match(/(-?\d+) mm/)![1]) < 25).map(s => '  ' + s));
  }
  writeFileSync(SP + '/tf-relatorio.txt', out.join('\n'));
});
