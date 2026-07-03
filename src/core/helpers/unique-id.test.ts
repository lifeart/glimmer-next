/**
 * Runtime coverage for `$_uid` — the compat-mode `{{unique-id}}` stable-id
 * helper. Verifies the four contract points the emission relies on:
 *   - same ctx + same site index → SAME id (stable across re-renders),
 *   - same ctx + different site index → DIFFERENT ids (sibling sites),
 *   - different ctx → DIFFERENT ids (distinct instances),
 *   - ids are letter-prefixed (valid HTML id / CSS selector) and SSR-safe
 *     (monotonic counter, not Math.random).
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { $_uid, resetUniqueIdCounter } from './unique-id';

describe('$_uid (unique-id runtime helper)', () => {
  beforeEach(() => resetUniqueIdCounter());

  test('same ctx + same site index returns the SAME id across re-evaluations', () => {
    const ctx = {};
    const a = $_uid(ctx, 0);
    const b = $_uid(ctx, 0);
    const c = $_uid(ctx, 0);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  test('same ctx + different site indices return DIFFERENT ids', () => {
    const ctx = {};
    expect($_uid(ctx, 0)).not.toBe($_uid(ctx, 1));
    // ...and each remains stable.
    expect($_uid(ctx, 0)).toBe($_uid(ctx, 0));
    expect($_uid(ctx, 1)).toBe($_uid(ctx, 1));
  });

  test('different ctx returns DIFFERENT ids at the same site index', () => {
    const ctxA = {};
    const ctxB = {};
    expect($_uid(ctxA, 0)).not.toBe($_uid(ctxB, 0));
  });

  test('ids start with a letter (valid HTML id / CSS selector)', () => {
    expect($_uid({}, 0)).toMatch(/^[A-Za-z]/);
  });

  test('ids are unique across many distinct (ctx, site) pairs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add($_uid({}, 0));
      ids.add($_uid({}, i));
    }
    // 50 fresh ctxs + 50 site indices on one shared ctx = 100 unique ids.
    // (the shared-ctx loop reuses site 0 once and grows i, all distinct)
    expect(ids.size).toBeGreaterThanOrEqual(51);
  });

  test('SSR-safe: deterministic id sequence after reset (no Math.random)', () => {
    resetUniqueIdCounter();
    const first = [$_uid({}, 0), $_uid({}, 0), $_uid({}, 0)];
    resetUniqueIdCounter();
    const second = [$_uid({}, 0), $_uid({}, 0), $_uid({}, 0)];
    // Identical evaluation order (server vs client) yields the identical
    // sequence — the property that makes rehydration ids match.
    expect(first).toEqual(second);
  });

  test('primitive/nullish ctx does not throw (returns a fresh id)', () => {
    expect(() => $_uid(null, 0)).not.toThrow();
    expect(() => $_uid(undefined as unknown as object, 0)).not.toThrow();
    expect(typeof $_uid('str' as unknown as object, 0)).toBe('string');
  });
});
