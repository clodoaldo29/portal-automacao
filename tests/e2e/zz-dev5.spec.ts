import { test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const SP = process.env.SP!;
test('intellifix colisão e fotos', async ({ page }) => {
  test.setTimeout(3_600_000);
  const out: string[] = [];
  page.on('pageerror', e => out.push('ERRO ' + e.message));
  for (const id of (process.env.MODELS ?? 'TL052M,32V35RS,TL056,TL059,55Q6QV,65Q6QV,75Q6QV').split(',')) {
    await page.goto(`/projetos/intellifix-ai/?model=${id}`);
    await page.waitForFunction(() => (window as any).__if);
    const r: any = await page.evaluate((sec) => {
      const I = (window as any).__if, worst = new Map<string, number>();
      I.run.setPlay(false);
      for (let i = 0; i < 30 * sec; i++) { I.step(1 / 30); if (i % 2 === 0) I.sim.measure(worst); }
      return [...worst].sort((a, b) => a[1] - b[1]).slice(0, 6).map(([k, v]) => `${Math.round(v * 1000)} mm · ${k}`);
    }, Number(process.env.SEC ?? 30));
    out.push(`== ${id}`, ...r.map((s: string) => '   ' + s));
    if (process.env.FOTO) for (let k = 0; k < 4; k++) {
      await page.evaluate((k) => {
        const I = (window as any).__if;
        for (let i = 0; i < 30 * 1.9; i++) I.step(1 / 30);
        const v = [[1.6, 2.0, 2.2], [1.6, 2.0, -2.2], [1.6, 2.0, 2.2], [1.6, 2.0, -2.2]][k];
        I.stage.camera.position.set(v[0], v[1], v[2]); I.stage.controls.target.set(0, 1.0, 0); I.stage.controls.update();
      }, k);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SP}/if-${id}-${k}.png`, clip: { x: 0, y: 96, width: 960, height: 704 } });
    }
  }
  writeFileSync(SP + '/if-colisao.txt', out.join('\n'));
});
