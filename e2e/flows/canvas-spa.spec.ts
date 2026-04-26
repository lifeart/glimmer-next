import { test, expect } from '@playwright/test';

/**
 * Regression test for the CanvasRenderer crash on SPA navigation back to /renderers
 * after the inner Tres/Canvas root provideContext reset fastRenderingContext to null.
 *
 * The crash mode (pre-fix): once any renderer (TresCanvas / CanvasRenderer / PdfViewer)
 * called `provideContext(innerRoot, RENDERING_CONTEXT, ...)` on a non-document root,
 * the module-level `fastRenderingContext` got nulled. On a subsequent SPA mount of
 * `<CanvasRenderer>`, its constructor body's `$_tag('canvas', ..., this)` would call
 * `initDOM(this)`. With fastRenderingContext null and `this[RENDERING_CONTEXT_PROPERTY]`
 * undefined, `getContext` walked the PARENT chain. That walk could hit a node whose
 * PARENT entry was missing (because the prior render's slot/inner-root cleanup
 * deleted it), and the walk returned null. `_DOM` then crashed on `api.element(...)`.
 *
 * Fix: a `rootRenderingContext` fallback in `src/core/context.ts` mirrors the most
 * recent root-level (document-having) rendering context, surviving nested
 * non-Root provideContext calls. `getContext` uses it as a last-resort fallback
 * for RENDERING_CONTEXT.
 */
test('canvas renderer survives SPA navigation back after Tres reset fastRenderingContext', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });

  // 1. Initial navigation to /pageOne (sets fastRenderingContext = htmlApi via renderComponent).
  await page.goto('/pageOne');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);

  // 2. SPA-click into /renderers. The TresDemo lazy-mounts its WebGL canvas
  //    and calls provideContext(innerRoot, RENDERING_CONTEXT, tresApi) — which
  //    sets fastRenderingContext = null (since innerRoot has no `document`).
  //    The CanvasRenderer below it does the same.
  await page.click('a[href="/renderers"]');
  await page.waitForSelector('canvas', { state: 'visible' });
  // Allow lazy chunks to fully resolve and inner provideContexts to fire.
  await page.waitForTimeout(2500);

  // 3. SPA-back to /pageOne via history. fastRenderingContext stays null
  //    after the Tres/Canvas teardown — the destructors only null it,
  //    they don't restore the document-level api.
  await page.evaluate(() => {
    history.pushState({}, '', '/pageOne');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForTimeout(500);

  // 4. SPA-forward to /renderers again. With fastRenderingContext null and
  //    no rootRenderingContext fallback, CanvasRenderer's `$_tag` would
  //    crash here. With the fix, it resolves the htmlApi via the fallback.
  await page.evaluate(() => {
    history.pushState({}, '', '/renderers');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForTimeout(2500);

  // 5. Asserts: no pageerrors mentioning the rendering-context Symbol or
  //    the downstream `api.element(null)` failure mode, and CanvasRenderer
  //    rendered its <canvas>.
  const fatalErrors = errors.filter((e) =>
    e.includes('rendering-context') ||
    e.includes("'element'") ||
    e.includes('CanvasRenderer'),
  );
  expect(fatalErrors).toEqual([]);

  // The page should still have at least one visible canvas (Tres + CanvasDemo
  // both render <canvas>; either being visible proves the second mount
  // didn't crash mid-render).
  const canvasCount = await page.locator('canvas').count();
  expect(canvasCount).toBeGreaterThan(0);
});
