import { test, expect } from '@playwright/test';

// Coverage disabled for this test due to Chromium crash
// import { captureCoverage } from './../utils/index.ts';
// captureCoverage(test);

test.describe('Benchmark page', () => {
  // Run this test serially to avoid conflicts with other tests accessing the benchmark page
  test.describe.configure({ mode: 'serial' });

  test('page structure and buttons', async ({ page }) => {
    test.setTimeout(180000);

    // Wait for automated benchmark to complete
    const renderCompletePromise = page.waitForEvent('console', {
      predicate: msg => msg.text().startsWith('render:'),
      timeout: 120000
    });

    await page.goto('/benchmark', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/benchmark/);
    await renderCompletePromise;
    await page.waitForSelector('text=No rows yet', { timeout: 5000 });

    // Check page header
    await expect(page.getByRole('heading', { name: 'Performance Benchmark' })).toBeVisible();

    // Check all action buttons
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

    await page.goto('about:blank').catch(() => {});
  });

  test('create 1000 rows', async ({ page }) => {
    test.setTimeout(180000);

    const renderCompletePromise = page.waitForEvent('console', {
      predicate: msg => msg.text().startsWith('render:'),
      timeout: 120000
    });

    await page.goto('/benchmark', { waitUntil: 'networkidle' });
    await renderCompletePromise;
    await page.waitForSelector('text=No rows yet', { timeout: 5000 });

    // Create 1000 rows
    await page.click('#run');
    await expect(page.locator('tbody tr')).toHaveCount(1000, { timeout: 30000 });

    // Verify first row has an ID and label
    const firstRowId = await page.locator('tbody tr').first().locator('td').first().textContent();
    expect(Number(firstRowId)).toBeGreaterThan(0);

    const firstRowLabel = await page.locator('tbody tr').first().locator('[data-test-select]').textContent();
    expect(firstRowLabel).toMatch(/\w+ \w+ \w+/); // "adjective color noun" pattern

    // Clear for next test
    await page.click('#clear');
    await expect(page.getByText('No rows yet')).toBeVisible({ timeout: 10000 });

    await page.goto('about:blank').catch(() => {});
  });

  test('append 1000 rows', async ({ page }) => {
    test.setTimeout(180000);

    const renderCompletePromise = page.waitForEvent('console', {
      predicate: msg => msg.text().startsWith('render:'),
      timeout: 120000
    });

    await page.goto('/benchmark', { waitUntil: 'networkidle' });
    await renderCompletePromise;
    await page.waitForSelector('text=No rows yet', { timeout: 5000 });

    // Create initial 1000 rows
    await page.click('#run');
    await expect(page.locator('tbody tr')).toHaveCount(1000, { timeout: 30000 });

    // Get the last row ID before append
    const lastRowIdBefore = await page.locator('tbody tr').last().locator('td').first().textContent();

    // Append 1000 more rows
    await page.click('#add');
    await expect(page.locator('tbody tr')).toHaveCount(2000, { timeout: 30000 });

    // Verify last row ID increased (new rows were appended)
    const lastRowIdAfter = await page.locator('tbody tr').last().locator('td').first().textContent();
    expect(Number(lastRowIdAfter)).toBeGreaterThan(Number(lastRowIdBefore));

    await page.click('#clear');
    await expect(page.getByText('No rows yet')).toBeVisible({ timeout: 10000 });

    await page.goto('about:blank').catch(() => {});
  });

  test('update every 10th row', async ({ page }) => {
    test.setTimeout(180000);

    const renderCompletePromise = page.waitForEvent('console', {
      predicate: msg => msg.text().startsWith('render:'),
      timeout: 120000
    });

    await page.goto('/benchmark', { waitUntil: 'networkidle' });
    await renderCompletePromise;
    await page.waitForSelector('text=No rows yet', { timeout: 5000 });

    // Create 1000 rows
    await page.click('#run');
    await expect(page.locator('tbody tr')).toHaveCount(1000, { timeout: 30000 });

    // Get first row label before update (row 0 is updated since it's every 10th starting from 0)
    const firstRowLabelBefore = await page.locator('tbody tr').first().locator('[data-test-select]').textContent();

    // Update every 10th row - appends " !!!" to label
    await page.click('#update');

    // Verify first row label was updated with " !!!"
    const firstRowLabelAfter = await page.locator('tbody tr').first().locator('[data-test-select]').textContent();
    expect(firstRowLabelAfter).toBe(firstRowLabelBefore + ' !!!');

    // Verify row 10 (index 10) was also updated
    const row10Label = await page.locator('tbody tr').nth(10).locator('[data-test-select]').textContent();
    expect(row10Label).toContain(' !!!');

    // Verify row 1 (index 1) was NOT updated
    const row1Label = await page.locator('tbody tr').nth(1).locator('[data-test-select]').textContent();
    expect(row1Label).not.toContain(' !!!');

    await page.click('#clear');
    await expect(page.getByText('No rows yet')).toBeVisible({ timeout: 10000 });

    await page.goto('about:blank').catch(() => {});
  });

  test('swap rows - swaps row 2 with row 999', async ({ page }) => {
    test.setTimeout(180000);

    const renderCompletePromise = page.waitForEvent('console', {
      predicate: msg => msg.text().startsWith('render:'),
      timeout: 120000
    });

    await page.goto('/benchmark', { waitUntil: 'networkidle' });
    await renderCompletePromise;
    await page.waitForSelector('text=No rows yet', { timeout: 5000 });

    // Create 1000 rows
    await page.click('#run');
    await expect(page.locator('tbody tr')).toHaveCount(1000, { timeout: 30000 });

    // Get row at index 1 (second row) and row at index 998 (999th row) before swap
    const row2IdBefore = await page.locator('tbody tr').nth(1).locator('td').first().textContent();
    const row2LabelBefore = await page.locator('tbody tr').nth(1).locator('[data-test-select]').textContent();
    const row999IdBefore = await page.locator('tbody tr').nth(998).locator('td').first().textContent();
    const row999LabelBefore = await page.locator('tbody tr').nth(998).locator('[data-test-select]').textContent();

    // Swap rows (swaps index 1 with index 998)
    await page.click('#swaprows');

    // Verify rows were swapped
    const row2IdAfter = await page.locator('tbody tr').nth(1).locator('td').first().textContent();
    const row2LabelAfter = await page.locator('tbody tr').nth(1).locator('[data-test-select]').textContent();
    const row999IdAfter = await page.locator('tbody tr').nth(998).locator('td').first().textContent();
    const row999LabelAfter = await page.locator('tbody tr').nth(998).locator('[data-test-select]').textContent();

    // Row at position 2 should now have the old row 999's data
    expect(row2IdAfter).toBe(row999IdBefore);
    expect(row2LabelAfter).toBe(row999LabelBefore);

    // Row at position 999 should now have the old row 2's data
    expect(row999IdAfter).toBe(row2IdBefore);
    expect(row999LabelAfter).toBe(row2LabelBefore);

    await page.click('#clear');
    await expect(page.getByText('No rows yet')).toBeVisible({ timeout: 10000 });

    await page.goto('about:blank').catch(() => {});
  });

  test('select and deselect row', async ({ page }) => {
    test.setTimeout(180000);

    const renderCompletePromise = page.waitForEvent('console', {
      predicate: msg => msg.text().startsWith('render:'),
      timeout: 120000
    });

    await page.goto('/benchmark', { waitUntil: 'networkidle' });
    await renderCompletePromise;
    await page.waitForSelector('text=No rows yet', { timeout: 5000 });

    // Create 1000 rows
    await page.click('#run');
    await expect(page.locator('tbody tr')).toHaveCount(1000, { timeout: 30000 });

    // Select first row by clicking its label
    await page.locator('tbody tr').first().locator('[data-test-select]').click();

    // Verify first row is selected (has bg-blue-500/20 class on td)
    const firstRowTd = page.locator('tbody tr').first().locator('td').first();
    await expect(firstRowTd).toHaveClass(/bg-blue-500/);

    // Select second row - should deselect first and select second
    await page.locator('tbody tr').nth(1).locator('[data-test-select]').click();

    // Verify first row is no longer selected
    await expect(firstRowTd).not.toHaveClass(/bg-blue-500/);

    // Verify second row is selected
    const secondRowTd = page.locator('tbody tr').nth(1).locator('td').first();
    await expect(secondRowTd).toHaveClass(/bg-blue-500/);

    // Click second row again to deselect
    await page.locator('tbody tr').nth(1).locator('[data-test-select]').click();

    // Verify second row is no longer selected
    await expect(secondRowTd).not.toHaveClass(/bg-blue-500/);

    await page.click('#clear');
    await expect(page.getByText('No rows yet')).toBeVisible({ timeout: 10000 });

    await page.goto('about:blank').catch(() => {});
  });

  test('remove row', async ({ page }) => {
    test.setTimeout(180000);

    const renderCompletePromise = page.waitForEvent('console', {
      predicate: msg => msg.text().startsWith('render:'),
      timeout: 120000
    });

    await page.goto('/benchmark', { waitUntil: 'networkidle' });
    await renderCompletePromise;
    await page.waitForSelector('text=No rows yet', { timeout: 5000 });

    // Create 1000 rows
    await page.click('#run');
    await expect(page.locator('tbody tr')).toHaveCount(1000, { timeout: 30000 });

    // Get first row ID before removal
    const firstRowIdBefore = await page.locator('tbody tr').first().locator('td').first().textContent();
    const secondRowIdBefore = await page.locator('tbody tr').nth(1).locator('td').first().textContent();

    // Remove first row
    await page.locator('tbody tr').first().locator('[data-test-remove]').click();

    // Wait for animation and removal (animation takes 500-800ms)
    await expect(page.locator('tbody tr')).toHaveCount(999, { timeout: 5000 });

    // Verify the old second row is now first
    const newFirstRowId = await page.locator('tbody tr').first().locator('td').first().textContent();
    expect(newFirstRowId).toBe(secondRowIdBefore);

    // The removed row's ID should no longer exist
    const allRowIds = await page.locator('tbody tr td:first-child').allTextContents();
    expect(allRowIds).not.toContain(firstRowIdBefore);

    await page.click('#clear');
    await expect(page.getByText('No rows yet')).toBeVisible({ timeout: 10000 });

    await page.goto('about:blank').catch(() => {});
  });

  test('clear all rows', async ({ page }) => {
    test.setTimeout(180000);

    const renderCompletePromise = page.waitForEvent('console', {
      predicate: msg => msg.text().startsWith('render:'),
      timeout: 120000
    });

    await page.goto('/benchmark', { waitUntil: 'networkidle' });
    await renderCompletePromise;
    await page.waitForSelector('text=No rows yet', { timeout: 5000 });

    // Create 1000 rows
    await page.click('#run');
    await expect(page.locator('tbody tr')).toHaveCount(1000, { timeout: 30000 });

    // Clear all rows
    await page.click('#clear');

    // Verify empty state
    await expect(page.locator('tbody tr')).toHaveCount(0, { timeout: 10000 });
    await expect(page.getByText('No rows yet')).toBeVisible();

    await page.goto('about:blank').catch(() => {});
  });
});
