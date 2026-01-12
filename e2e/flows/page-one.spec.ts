import { test, expect } from '@playwright/test';

// Coverage disabled for this test due to Chromium crash with canvas + navigation
// import { captureCoverage } from './../utils/index.ts';
// captureCoverage(test);

test('page-one', async ({ page }) => {
  await page.goto('/pageOne');

  // Check page header with gradient text
  await expect(page.getByRole('heading', { name: 'Compilers are the New Frameworks' })).toBeVisible();
  await expect(page.getByText('Tom Dale')).toBeVisible();

  // Check benchmark table exists
  await expect(page.locator('table')).toHaveCount(1);

  // Check table headers
  await expect(page.locator('th').filter({ hasText: 'Benchmark' })).toBeVisible();
  await expect(page.locator('th').filter({ hasText: 'GXT' })).toBeVisible();

  // Check feature cards section
  await expect(page.getByRole('heading', { name: 'Why GXT?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Blazing Fast Performance' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Optimized Memory' })).toBeVisible();

  // Check CTA buttons
  await expect(page.locator('a[href="/pageTwo"]')).toBeVisible();
  await expect(page.locator('a[href="/renderers"]')).toBeVisible();
  await expect(page.locator('a[href="/benchmark"]')).toBeVisible();

  // Navigate to page two
  await page.click('a[href="/pageTwo"]');
  await expect(page).toHaveURL(/pageTwo/);
});
