import { test } from '@playwright/test';

// Portal cover (1600 × 900) of a simulation, rendered in high quality without the bar, panel and legend.
// Not part of the normal run. Usage:
//   CAPA=memory-flow-3d npx playwright test tests/e2e/capa.spec.ts
// The image is written to public/capas/<id>.png.
const id = process.env.CAPA;

test.describe('portal cover', () => {
  test.skip(!id, 'set CAPA=<project id> to render a cover');
  test.use({ viewport: { width: 1600, height: 900 } });

  test(`cover for ${id}`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto(`/projetos/${id}/`);
    await page.addStyleTag({ content: '.bar, .kpi, .legend, .info { display: none !important; } #app { grid-template-rows: 0 minmax(0, 1fr) !important; }' });
    await page.waitForTimeout(1500);
    // project-specific camera, when the page exposes one
    await page.evaluate(() => {
      const mf = (window as unknown as { __mf?: { stage: { camera: { position: { set: (...a: number[]) => void } }; controls: { target: { set: (...a: number[]) => void }; update: () => void } } } }).__mf;
      if (mf) { mf.stage.camera.position.set(44, 46, 62); mf.stage.controls.target.set(-2, 0, 4); mf.stage.controls.update(); }
      (window as unknown as { __capa?: () => void }).__capa?.(); // a page can offer its own cover camera
    });
    await page.waitForTimeout(8000);
    await page.locator('#stage canvas').screenshot({ path: `public/capas/${id}.png` });
  });
});
