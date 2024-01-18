import { test, expect } from '@playwright/test';

import { captureCoverage } from './../utils/index.ts';

captureCoverage(test);

test('page-two', async ({ page }) => {
  await page.goto('http://localhost:5174/pageTwo');

  await expect(page).toHaveURL(/pageTwo/);
  await expect(page.locator('a')).toHaveCount(1);
});
