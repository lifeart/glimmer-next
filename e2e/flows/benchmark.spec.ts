import { test, expect } from '@playwright/test';

// Coverage disabled for this test due to Chromium crash with canvas
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

  // Create 1000 rows
  await page.click('#run');

  // Wait for rows to appear
  await expect(page.locator('tbody tr')).toHaveCount(1000, { timeout: 10000 });

  // Empty state should be hidden
  await expect(page.getByText('No rows yet')).not.toBeVisible();

  // Check first row exists with ID 1
  await expect(page.locator('tbody tr').first().locator('td').first()).toContainText('1');

  // Clear all rows
  await page.click('#clear');

  // Should show empty state again
  await expect(page.getByText('No rows yet')).toBeVisible({ timeout: 5000 });
});
