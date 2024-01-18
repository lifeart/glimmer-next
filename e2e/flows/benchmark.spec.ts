import { test, expect, type ConsoleMessage } from '@playwright/test';

import { captureCoverage } from './../utils/index.ts';

captureCoverage(test);

test('benchmark', async ({ page }) => {
  await page.goto('http://localhost:5174/benchmark');

  try {
    await page.waitForEvent('console', {
      predicate: async (consoleMessage: ConsoleMessage) => {
        return consoleMessage.text().startsWith('render:');
      },
      timeout: 30000,
    });
  } catch (e) {
    throw new Error(
      `error waiting for message 'render end message' Cause: ${e}`,
    );
  }

  await expect(page).toHaveURL(/benchmark/);
});
