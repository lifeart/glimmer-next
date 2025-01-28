import { expect, test, describe } from 'vitest';
import { hbs, scope } from './template';

describe('template package', () => {
  describe('hbs', () => {
    test('it works', () => {
      expect(hbs`123`).toEqual({
        ctx: null,
        tpl: ['123'],
      });
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
