import { test, expect } from '@playwright/test';

import { captureCoverage } from './../utils/index.ts';

captureCoverage(test);

type QUnitTestResults = {
  failed: number;
  passed: number;
  runtime: number;
  total: number;
};

type QUnitTestDone = {
  name: string;
  module: string;
  skipped: boolean;
  todo: boolean;
  failed: number;
  passed: number;
  total: number;
  runtime: number;
  assertions: { result: boolean; message?: string }[];
  testId: string;
  // generating stack trace is expensive, so using a getter will help defer this until we need it
  source: string;
};

test('QUnit', async ({ page }) => {
  const maxQunitTestTime = 1000 * 60 * 2; // 2 minutes should be enough

  test.setTimeout(maxQunitTestTime);

  // Capture all console messages
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    const location = msg.location();
    if (msg.type() === 'error') {
      console.log(`[BROWSER ERROR] ${text}`);
      console.log(`[BROWSER ERROR LOCATION] ${location.url}:${location.lineNumber}:${location.columnNumber}`);
      consoleErrors.push(`${text} at ${location.url}:${location.lineNumber}:${location.columnNumber}`);
    }
  });

  // Capture page errors (uncaught exceptions)
  page.on('pageerror', (error) => {
    console.log(`[PAGE ERROR] ${error.message}`);
    console.log(`[PAGE ERROR STACK] ${error.stack}`);
    consoleErrors.push(`PageError: ${error.message}\n${error.stack}`);
  });

  // Log all JS/TS file requests to identify failing files
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('.gts') || url.includes('.ts') || url.includes('.js') || url.includes('?import')) {
      if (!url.includes('node_modules') && !url.includes('@vite')) {
        console.log(`[RESPONSE] ${url} - Status: ${response.status()}`);
      }
    }
  });

  page.on('requestfailed', (request) => {
    console.log(`[REQUEST FAILED] ${request.url()} - ${request.failure()?.errorText}`);
  });

  let resolveTestResults: (value: unknown) => void;
  const testDonePromise = new Promise((resolve) => {
    resolveTestResults = resolve;
  });
  const testsDoneResults: QUnitTestDone[] = [];

  let testCount = 0;
  await Promise.all([
    page.exposeFunction('onQunitDone', (values: QUnitTestResults) => {
      console.log(`QUnit done: ${values.passed} passed, ${values.failed} failed, ${values.total} total`);
      resolveTestResults(values);
    }),
    page.exposeFunction('onQunitTestDone', (values: QUnitTestDone) => {
      testCount++;
      if (testCount % 50 === 0) {
        console.log(`QUnit progress: ${testCount} tests completed`);
      }
      testsDoneResults.push(values);
    }),
  ]);

  await page.goto('/tests.html', {
    waitUntil: 'domcontentloaded',
  });

  // Log any console errors collected so far
  if (consoleErrors.length > 0) {
    console.log(`\n=== BROWSER CONSOLE ERRORS (${consoleErrors.length}) ===`);
    consoleErrors.forEach((err, idx) => {
      console.log(`${idx + 1}. ${err}`);
    });
    console.log('=== END BROWSER CONSOLE ERRORS ===\n');
  }

  const testResults: QUnitTestResults =
    await (testDonePromise as Promise<QUnitTestResults>);

  const failedTests = testsDoneResults.filter((tInfo) => tInfo.failed > 0);

  // Log all failed tests for debugging
  if (failedTests.length > 0) {
    console.log(`\n=== FAILED TESTS (${failedTests.length} total) ===`);
    failedTests.forEach((tInfo, idx) => {
      console.log(`${idx + 1}. ${tInfo.module} >> ${tInfo.name}`);
      const failedAssertion = tInfo.assertions.find((a) => !a.result);
      if (failedAssertion) {
        console.log(`   Message: ${failedAssertion.message}`);
      }
    });
    console.log('=== END FAILED TESTS ===\n');
  }

  failedTests.forEach((tInfo) => {
    expect(() => {
      const error = new Error(`${tInfo.module} | ${tInfo.name}`);
      error.stack = tInfo.source;
      error.message =
        tInfo.assertions.find((a) => !a.result)?.message ?? tInfo.source;
      throw error;
    }, `${tInfo.module} >> ${tInfo.name}`).not.toThrowError();
  });

  testsDoneResults.forEach((tInfo) => {
    test.info().annotations.push({
      type: `${tInfo.module} >> ${tInfo.name}`,
      description: tInfo.assertions.map((a) => a.message).join('\n'),
    });
    // we need this asserts for better reporting
    expect(tInfo.assertions.length, `${tInfo.module} >> ${tInfo.name}`).toBe(
      tInfo.assertions.length,
    );
  });

  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
  });

  await test
    .info()
    .attach('qUnit report', { body: pdf, contentType: 'application/pdf' });

  await expect(testResults.failed, 'No failed tests').toBe(0);
  await expect(testResults.passed, 'All tests passed').toBe(testResults.passed);
});
