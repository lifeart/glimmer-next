import { test, expect } from '@playwright/test';

import { captureCoverage } from './../utils/index.ts';

captureCoverage(test);

test('page-two', async ({ page }) => {
  await page.goto('/pageTwo');

  await expect(page).toHaveURL(/pageTwo/);

  // Check page header
  await expect(page.getByRole('heading', { name: 'Project Goals' })).toBeVisible();

  // Check goal cards (using headings to be specific)
  await expect(page.getByRole('heading', { name: 'Modern Compiler Technology' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Backward Compatibility' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Community-Driven Development' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Future-Ready Platform' })).toBeVisible();

  // Check key objectives section
  await expect(page.getByRole('heading', { name: 'Key Objectives' })).toBeVisible();

  // Check live clock demo section
  await expect(page.getByRole('heading', { name: 'Live Reactivity Demo' })).toBeVisible();

  // Check navigation buttons exist
  await expect(page.locator('a[href="/pageOne"]')).toBeVisible();
  await expect(page.locator('a[href="/renderers"]')).toBeVisible();
  await expect(page.locator('a[href="/benchmark"]')).toBeVisible();

  // Navigation to renderers disabled due to Chromium crash with canvas
});
