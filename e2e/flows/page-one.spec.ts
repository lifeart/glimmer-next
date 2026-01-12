import { test, expect } from '@playwright/test';

// Coverage disabled for this test due to Chromium crash with canvas + navigation
// import { captureCoverage } from './../utils/index.ts';
// captureCoverage(test);

test('page-one', async ({ page }) => {
  await page.goto('http://localhost:5174/pageOne');

  await expect(page.locator('table')).toHaveCount(1);

  // we able to go to page two

  await page.click('a[href="/pageTwo"]');

  await expect(page).toHaveURL(/pageTwo/);
});
