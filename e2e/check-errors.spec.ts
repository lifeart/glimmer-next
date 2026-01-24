import { test, expect } from '@playwright/test';

test('Check for console errors on tests page', async ({ page }) => {
  const errors: string[] = [];

  // Capture all console messages for debugging
  page.on('console', (msg) => {
    const loc = msg.location();
    const text = msg.text();
    if (msg.type() === 'error') {
      errors.push(`${text} at ${loc.url}:${loc.lineNumber}:${loc.columnNumber}`);
    }
  });

  // Capture page errors (uncaught exceptions)
  page.on('pageerror', (error) => {
    errors.push(`PageError: ${error.message}\nStack: ${error.stack}`);
  });

  // Capture response errors (500, etc)
  page.on('response', (response) => {
    if (response.status() >= 400) {
      console.log(`Response error: ${response.url()} - ${response.status()}`);
    }
  });

  // Navigate to tests page
  await page.goto('http://localhost:5174/tests.html', {
    waitUntil: 'domcontentloaded',
  });

  // Wait a moment for any async errors
  await page.waitForTimeout(3000);

  // Log all errors found
  if (errors.length > 0) {
    console.log('\n=== CONSOLE ERRORS FOUND ===');
    errors.forEach((err, i) => console.log(`${i + 1}. ${err}`));
    console.log('=== END ERRORS ===\n');
  } else {
    console.log('\n=== NO CONSOLE ERRORS ===\n');
  }

  // Fail the test if there are errors
  expect(errors.length, `Found ${errors.length} console errors`).toBe(0);
});
