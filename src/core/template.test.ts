import { expect, test, describe } from 'vitest';
import { hbs, scope } from './template';

// Use indirect reference to avoid compiler transformation
// The compiler looks for /hbs\s*`/ pattern and transforms it
const hbsRuntime = hbs;

describe('template package', () => {
  describe('hbs', () => {
    test('throws error when called at runtime (not compiled)', () => {
      // hbs is a build-time marker that gets transformed by the Vite plugin.
      // If called at runtime, it means the template wasn't compiled.
      // Using hbsRuntime to avoid compile-time transformation
      expect(() => hbsRuntime`123`).toThrow('hbs template was not compiled');
    });

    test('error message mentions Vite plugin configuration', () => {
      expect(() => hbsRuntime`test`).toThrow('Vite plugin');
    });
  });
  describe('scope', () => {
    test('it works for objects', () => {
      expect(() => scope({ foo: 'bar' })).not.toThrow();
    });
    test('it throws for non-objects', () => {
      expect(() => scope(null as unknown as Record<string, unknown>)).toThrow();
      expect(() =>
        scope(false as unknown as Record<string, unknown>),
      ).toThrow();
      expect(() => scope(true as unknown as Record<string, unknown>)).toThrow();
    });
  });
});
