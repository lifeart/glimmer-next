import { test, expect } from '@playwright/test';

// Coverage disabled for this test due to potential Chromium crash with canvas
// import { captureCoverage } from './../utils/index.ts';
// captureCoverage(test);

test('renderers', async ({ page }) => {
  await page.goto('/renderers');

  await expect(page).toHaveURL(/renderers/);

  // Check page header
  await expect(page.getByRole('heading', { name: 'Custom Renderers' })).toBeVisible();

  // Check Canvas Demo section
  await expect(page.getByRole('heading', { name: 'Canvas Renderer' })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();

  // Check SVG Demo section
  await expect(page.getByRole('heading', { name: 'SVG Renderer' })).toBeVisible();

  // Check MathML Demo section
  await expect(page.getByRole('heading', { name: 'MathML Renderer' })).toBeVisible();
  await expect(page.locator('math')).toHaveCount(4); // 4 math demos

  // Check interactive controls exist
  await expect(page.locator('input[type="range"]').first()).toBeVisible();
  await expect(page.locator('input[type="color"]').first()).toBeVisible();
  await expect(page.locator('input[type="number"]').first()).toBeVisible();

  // Check navigation link
  await expect(page.locator('a[href="/pageOne"]')).toBeVisible();

  // Navigate back to page one
  await page.click('a[href="/pageOne"]');
  await expect(page).toHaveURL(/pageOne/);
});
