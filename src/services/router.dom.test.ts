/**
 * @vitest-environment happy-dom
 *
 * The positive branch of the #141 fix: when a document IS present (browser),
 * preloadCss appends the expected <link rel=preload>.
 */
import 'decorator-transforms/globals';
import { test, expect, afterEach } from 'vitest';
import { preloadCss } from './router';

afterEach(() => {
  document.head.querySelectorAll('link[rel="preload"]').forEach((l) => l.remove());
});

test('preloadCss appends a preload link when a document exists', () => {
  preloadCss('/x.css');
  const link = document.head.querySelector('link[rel="preload"]') as HTMLLinkElement;
  expect(link).not.toBeNull();
  expect(link.getAttribute('href')).toBe('/x.css');
  expect(link.getAttribute('as')).toBe('style');
});
