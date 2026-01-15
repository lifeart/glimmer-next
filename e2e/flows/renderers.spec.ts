import { test, expect } from '@playwright/test';

import { captureCoverage } from './../utils/index.ts';
captureCoverage(test);

test('renderers', async ({ page }) => {
  await page.goto('/renderers');

  await expect(page).toHaveURL(/renderers/);

  // Check page header
  await expect(page.getByRole('heading', { name: 'Custom Renderers' })).toBeVisible();

  // Check Canvas Demo section
  await expect(page.getByRole('heading', { name: 'Canvas Renderer' })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();

  // Check SVG Demo section
  await expect(page.getByRole('heading', { name: 'SVG Renderer' })).toBeVisible();

  // Check MathML Demo section
  await expect(page.getByRole('heading', { name: 'MathML Renderer' })).toBeVisible();
  await expect(page.locator('math')).toHaveCount(4); // 4 math demos

  // Check PDF Demo section
  await expect(page.getByRole('heading', { name: 'PDF Renderer' })).toBeVisible();
  await expect(page.locator('[data-test-pdf-demo]')).toBeVisible();
  await expect(page.locator('[data-test-pdf-preview]')).toBeVisible();

  // Check PDF demo controls
  await expect(page.locator('[data-test-pdf-title-input]')).toBeVisible();
  await expect(page.locator('[data-test-pdf-heading-input]')).toBeVisible();

  // Check interactive controls exist
  await expect(page.locator('input[type="range"]').first()).toBeVisible();
  await expect(page.locator('input[type="color"]').first()).toBeVisible();
  await expect(page.locator('input[type="number"]').first()).toBeVisible();

  // Check navigation link exists
  await expect(page.locator('a[href="/pageOne"]')).toBeVisible();

  // Navigate away to avoid browser crash on teardown
  await page.goto('about:blank').catch(() => {});
});

test('pdf renderer interactivity', async ({ page }) => {
  await page.goto('/renderers');

  // Scroll to PDF demo section
  await page.locator('[data-test-pdf-demo]').scrollIntoViewIfNeeded();

  // Verify PDF demo section is visible
  await expect(page.locator('[data-test-pdf-demo]')).toBeVisible();

  // Verify the preview container is visible
  await expect(page.locator('[data-test-pdf-preview]')).toBeVisible();

  // Verify the preview contains an iframe (PDF is rendered there)
  await expect(page.locator('[data-test-pdf-preview] iframe')).toBeVisible();

  // Test input fields are functional
  const titleInput = page.locator('[data-test-pdf-title-input]');
  await expect(titleInput).toBeVisible();
  await titleInput.fill('Test PDF Title');
  await expect(titleInput).toHaveValue('Test PDF Title');

  const headingInput = page.locator('[data-test-pdf-heading-input]');
  await expect(headingInput).toBeVisible();
  await headingInput.fill('Custom Heading');
  await expect(headingInput).toHaveValue('Custom Heading');

  // Verify download button is present
  await expect(page.locator('[data-test-pdf-download]')).toBeVisible();

  // Navigate away to avoid browser crash on teardown
  await page.goto('about:blank').catch(() => {});
});
