import { describe, test, expect } from 'vitest';
import { $_qStr } from './quoted-str';

/**
 * Coercion-table parity guard for the Ember-dialect quoted-attribute concat
 * helper. The contract MUST match the Ember bridge's inlined `__qaNorm` /
 * `__gxtQuotedAttr` (packages/@ember/-internals/gxt-backend/compile.ts):
 *
 *   __qaNorm(v):
 *     null|undefined              -> ''
 *     typeof v.toString !== 'fn'  -> ''   (e.g. Object.create(null))
 *     else                        -> String(v), '' if it throws
 *
 *   __gxtQuotedAttr(parts):
 *     non-array          -> __qaNorm(parts)
 *     length 1 & nullish -> null
 *     all parts nullish  -> null
 *     else               -> parts.map(__qaNorm).join('')
 */
describe('$_qStr — Ember quoted-attribute concat coercion', () => {
  describe('per-part coercion (__qaNorm parity)', () => {
    test('plain string parts concatenate', () => {
      expect($_qStr(['base ', 'active', ' end'])).toBe('base active end');
    });

    test('nullish parts contribute empty string when mixed with real parts', () => {
      expect($_qStr(['a', null, 'b'])).toBe('ab');
      expect($_qStr(['a', undefined, 'b'])).toBe('ab');
    });

    test('numbers coerce via String()', () => {
      expect($_qStr(['x', 0, 'y'])).toBe('x0y');
      expect($_qStr(['v', 42])).toBe('v42');
    });

    test('boolean coerces via String()', () => {
      expect($_qStr(['a', true, 'b', false])).toBe('atruebfalse');
    });

    test('Symbol coerces via String() (implicit concat would throw)', () => {
      const sym = Symbol('tok');
      // `'' + sym` throws a TypeError; String(sym) does not.
      expect($_qStr(['id-', sym])).toBe('id-' + String(sym));
      expect($_qStr(['id-', sym])).toBe('id-Symbol(tok)');
    });

    test('Object.create(null) (no toString) → empty string', () => {
      const bare = Object.create(null) as object;
      expect($_qStr(['a', bare, 'b'])).toBe('ab');
    });

    test('object with a normal toString coerces', () => {
      const o = { toString: () => 'OBJ' };
      expect($_qStr(['a', o])).toBe('aOBJ');
    });

    test('object whose toString throws normalizes to empty string', () => {
      const bad = {
        toString() {
          throw new Error('boom');
        },
      };
      expect($_qStr(['a', bad, 'b'])).toBe('ab');
    });
  });

  describe('all-nullish → null (attribute-removal contract)', () => {
    test('single nullish part returns null (not "" or "undefined")', () => {
      expect($_qStr([null])).toBe(null);
      expect($_qStr([undefined])).toBe(null);
    });

    test('every dynamic part nullish returns null', () => {
      expect($_qStr([null, undefined, null])).toBe(null);
    });

    test('a single non-nullish part is NOT null', () => {
      expect($_qStr(['x'])).toBe('x');
      // empty string is a real (non-nullish) value → keep, do not drop
      expect($_qStr([''])).toBe('');
    });

    test('any non-nullish part disables the null return', () => {
      expect($_qStr(['prefix-', null])).toBe('prefix-');
      expect($_qStr([null, 'suffix'])).toBe('suffix');
      // a numeric 0 is non-nullish → not dropped
      expect($_qStr([0, null])).toBe('0');
    });
  });

  describe('non-array argument (bridge parity)', () => {
    test('a bare non-array value normalizes directly', () => {
      // __gxtQuotedAttr(parts): if (!Array.isArray(parts)) return __qaNorm(parts)
      expect($_qStr('hello' as unknown as unknown[])).toBe('hello');
      expect($_qStr(5 as unknown as unknown[])).toBe('5');
      // NOTE: a bare nullish (non-array) normalizes to '' via __qaNorm — the
      // null return only applies to the array path (matches the bridge).
      expect($_qStr(null as unknown as unknown[])).toBe('');
    });
  });
});
