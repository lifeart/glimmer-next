import { describe, test, expect, afterEach } from 'vitest';
import {
  emberAnd,
  emberOr,
  emberNot,
  emberEq,
  emberIf,
  expectAtLeastTwo,
  expectExactly,
} from './ember-keywords';
import { HOST_HOOKS, registerHostHooks } from '../host-hooks';

// Ember toBool: an empty array is falsy, objects are truthy, the rest is JS.
const emberToBool = (v: unknown) => (Array.isArray(v) ? v.length !== 0 : !!v);

describe('G-kw: Ember keyword-helper semantics', () => {
  afterEach(() => {
    HOST_HOOKS.toBool = undefined;
  });

  test('and returns the deciding VALUE and short-circuits lazily', () => {
    registerHostHooks({ toBool: emberToBool });
    let reads = 0;
    const later = () => {
      reads++;
      return 'never';
    };
    expect(emberAnd([() => 'a', () => [], later])).toEqual([]);
    expect(reads).toBe(0);
    expect(emberAnd([() => 'a', 2])).toBe(2);
  });

  test('or returns the first truthy value (host toBool), else the last', () => {
    registerHostHooks({ toBool: emberToBool });
    expect(emberOr([() => [], () => 'b'])).toBe('b');
    const empty: unknown[] = [];
    expect(emberOr([0, () => empty])).toBe(empty);
  });

  test('not / if use the host toBool ([] is falsy in Ember)', () => {
    registerHostHooks({ toBool: emberToBool });
    expect(emberNot([() => []])).toBe(true);
    expect(emberNot([() => [1]])).toBe(false);
    expect(emberIf(() => [], 'yes', 'no')).toBe('no');
    expect(emberIf(() => [1], () => 'yes', 'no')).toBe('yes');
  });

  test('without a host toBool, JS truthiness applies', () => {
    expect(emberNot([() => []])).toBe(false);
    expect(emberIf(() => [], 'yes', 'no')).toBe('yes');
  });

  test('eq is strict equality of exactly two arguments', () => {
    expect(emberEq([() => 1, 1])).toBe(true);
    expect(emberEq([() => '1', 1])).toBe(false);
  });

  test('arity asserts (Glimmer messages)', () => {
    expect(() => expectAtLeastTwo('and', [1])).toThrow(
      '`and` expects at least two arguments, but received 1.'
    );
    expect(() => expectAtLeastTwo('or', [])).toThrow(
      '`or` expects at least two arguments, but received 0.'
    );
    expect(() => expectExactly('not', [1, 2], 1)).toThrow(
      '`not` expects exactly one argument, but received 2.'
    );
    expect(() => expectExactly('eq', [1, 2, 3], 2)).toThrow(
      '`eq` expects exactly two arguments, but received 3.'
    );
    expect(() => expectExactly('eq', [1, 2], 2)).not.toThrow();
    // the keyword helpers run them in development builds only
    if (IS_DEV_MODE) {
      expect(() => emberAnd([1])).toThrow();
      expect(() => emberNot([1, 2])).toThrow();
    } else {
      expect(emberAnd([1])).toBe(1);
    }
  });
});
