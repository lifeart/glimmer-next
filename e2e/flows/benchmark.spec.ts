import { test, expect } from '@playwright/test';

// Coverage disabled for this test due to Chromium crash
// import { captureCoverage } from './../utils/index.ts';
// captureCoverage(test);

test.describe('Benchmark page', () => {
  // Run this test serially to avoid conflicts with other tests accessing the benchmark page
  test.describe.configure({ mode: 'serial' });

  test('benchmark', async ({ page }) => {
    test.setTimeout(180000); // 3 minutes for automated benchmark

    // Start waiting for the render completion log before navigating
    const renderCompletePromise = page.waitForEvent('console', {
      predicate: msg => msg.text().startsWith('render:'),
      timeout: 120000
    });

    await page.goto('/benchmark', { waitUntil: 'networkidle' });

    await expect(page).toHaveURL(/benchmark/);

    // Wait for the automated benchmark to complete
    await renderCompletePromise;
    await page.waitForSelector('text=No rows yet', { timeout: 5000 });

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

    // Row creation tests
    await page.click('#run');
    await expect(page.locator('tbody tr')).toHaveCount(1000, { timeout: 30000 });

    // Select first row
    await page.locator('tbody tr').first().locator('[data-test-select]').click();

    // Clear all
    await page.click('#clear');
    await expect(page.getByText('No rows yet')).toBeVisible({ timeout: 10000 });

    // Navigate away to avoid browser crash on teardown
    await page.goto('about:blank').catch(() => {});
  });
});
