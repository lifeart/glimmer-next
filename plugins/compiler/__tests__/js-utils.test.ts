import { describe, test, expect } from 'vitest';
import { isSafeKey, quoteKey } from '../utils/js-utils';

describe('JS Utils', () => {
  describe('isSafeKey', () => {
    test('valid identifier starting with letter', () => {
      expect(isSafeKey('foo')).toBe(true);
      expect(isSafeKey('Bar')).toBe(true);
      expect(isSafeKey('camelCase')).toBe(true);
      expect(isSafeKey('PascalCase')).toBe(true);
    });

    test('valid identifier starting with underscore', () => {
      expect(isSafeKey('_foo')).toBe(true);
      expect(isSafeKey('_')).toBe(true);
      expect(isSafeKey('__proto')).toBe(true);
    });

    test('valid identifier starting with $', () => {
      expect(isSafeKey('$foo')).toBe(true);
      expect(isSafeKey('$')).toBe(true);
      expect(isSafeKey('$$')).toBe(true);
    });

    test('valid identifier with numbers', () => {
      expect(isSafeKey('foo1')).toBe(true);
      expect(isSafeKey('bar123')).toBe(true);
      expect(isSafeKey('_123')).toBe(true);
    });

    test('invalid - hyphenated names', () => {
      expect(isSafeKey('my-component')).toBe(false);
      expect(isSafeKey('foo-bar-baz')).toBe(false);
      expect(isSafeKey('data-test-id')).toBe(false);
    });

    test('invalid - starting with number', () => {
      expect(isSafeKey('1foo')).toBe(false);
      expect(isSafeKey('123')).toBe(false);
    });

    test('invalid - contains spaces', () => {
      expect(isSafeKey('foo bar')).toBe(false);
      expect(isSafeKey(' foo')).toBe(false);
    });

    test('invalid - contains special characters', () => {
      expect(isSafeKey('foo.bar')).toBe(false);
      expect(isSafeKey('foo@bar')).toBe(false);
      expect(isSafeKey('foo:bar')).toBe(false);
    });

    test('invalid - empty string', () => {
      expect(isSafeKey('')).toBe(false);
    });
  });

  describe('quoteKey', () => {
    test('safe keys are returned unchanged', () => {
      expect(quoteKey('foo')).toBe('foo');
      expect(quoteKey('_bar')).toBe('_bar');
      expect(quoteKey('$baz')).toBe('$baz');
    });

    test('hyphenated keys are quoted', () => {
      expect(quoteKey('my-component')).toBe('"my-component"');
      expect(quoteKey('data-test-id')).toBe('"data-test-id"');
    });

    test('keys with special characters are quoted and escaped', () => {
      expect(quoteKey('foo"bar')).toBe('"foo\\"bar"');
      expect(quoteKey('foo\\bar')).toBe('"foo\\\\bar"');
    });

    test('keys starting with numbers are quoted', () => {
      expect(quoteKey('123')).toBe('"123"');
      expect(quoteKey('1foo')).toBe('"1foo"');
    });
  });
});
