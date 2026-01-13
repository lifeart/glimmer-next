import { test, expect } from '@playwright/test';

test('tres renderer console errors check', async ({ page }) => {
  const errors: string[] = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', err => {
    errors.push(err.message);
  });

  await page.goto('/renderers');
  await page.waitForTimeout(3000);

  // Take a screenshot for visual verification
  await page.screenshot({ path: 'test-results/tres-renderer.png', fullPage: true });

  // Print all errors
  console.log('Total errors found:', errors.length);
  errors.forEach((e, i) => console.log(`Error ${i+1}: ${e}`));

  // Assert no errors
  expect(errors).toHaveLength(0);

  // Navigate away
  await page.goto('about:blank').catch(() => {});
});
