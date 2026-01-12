import { test, expect } from '@playwright/test';

// Coverage disabled for this test due to Chromium crash
// import { captureCoverage } from './../utils/index.ts';
// captureCoverage(test);

test('benchmark', async ({ page }) => {
  await page.goto('/benchmark');

  await expect(page).toHaveURL(/benchmark/);

  // Check page header
  await expect(page.getByRole('heading', { name: 'Performance Benchmark' })).toBeVisible();

  // Check action buttons
  await expect(page.locator('#run')).toBeVisible();
  await expect(page.locator('#runlots')).toBeVisible();
  await expect(page.locator('#add')).toBeVisible();
  await expect(page.locator('#update')).toBeVisible();
  await expect(page.locator('#swaprows')).toBeVisible();
  await expect(page.locator('#clear')).toBeVisible();

  // Check empty state
  await expect(page.getByText('No rows yet')).toBeVisible();

  // Check table headers
  await expect(page.locator('th').filter({ hasText: '#' })).toBeVisible();
  await expect(page.locator('th').filter({ hasText: 'Label' })).toBeVisible();
  await expect(page.locator('th').filter({ hasText: 'Action' })).toBeVisible();

  // Row creation tests disabled due to Chromium crash
});
