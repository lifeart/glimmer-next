import { expect, test, describe } from 'vitest';
import { hbs, scope } from './template';
import { SYMBOLS } from '../../plugins/symbols';

describe('template package', () => {
  describe('hbs', () => {
    test('it works', () => {
      expect(hbs`123`).toEqual({
        [SYMBOLS.$nodes]: [],
        [SYMBOLS.$slotsProp]: {},
        index: 0,
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
