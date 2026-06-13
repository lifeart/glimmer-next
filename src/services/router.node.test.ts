/**
 * @vitest-environment node
 *
 * Regression for #141 (ReferenceError: document is not defined — glimmer router).
 * In a genuine non-browser environment (no DOM globals at all), importing the
 * router and exercising its CSS-preload path must NOT throw. Before the fix the
 * preload guard keyed on the build-time `import.meta.env.SSR` flag, which is
 * absent here, so `document.createElement` ran and threw.
 */
import 'decorator-transforms/globals';
import { test, expect } from 'vitest';
import { preloadCss, createRouter } from './router';

test('preloadCss is a safe no-op when no document exists (Node/SSR)', () => {
  expect(typeof document).toBe('undefined'); // sanity: truly no DOM here
  expect(() => preloadCss('/whatever.css')).not.toThrow();
});

test('router constructs and mounts in Node without touching the DOM', async () => {
  const router = createRouter();
  // explicit path + ssr=true: must not reach any document/location access
  await expect(router.mount('/', true)).resolves.not.toThrow?.();
  router.unmount();
});
