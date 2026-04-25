import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { $__log } from './log';

describe('$__log helper', () => {
  // Using `any` here keeps the type compatible with vitest's MockInstance generic
  // parameters across versions; the test bodies only rely on toHaveBeenCalled* matchers.
  let logSpy: any;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('forwards plain args to console.log', () => {
    $__log('hello', 'world');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('hello', 'world');
  });

  test('returns empty string', () => {
    expect($__log('x')).toBe('');
  });

  // PR https://github.com/lifeart/glimmer-next/pull/212 — Integration | Helper |
  // log >> {{log}} calls console.log and renders empty string. The compile-time
  // transform in IS_GLIMMER_COMPAT_MODE prepends a stable `__logSite:N` id so
  // re-evaluations of the same site can be deduped. That id is an internal
  // detail and must NEVER reach console.log — otherwise tests asserting
  // `console.log` was called with the user-provided args would observe the
  // synthetic site id as a leading argument and fail.
  test('strips compile-time __logSite: prefix from console.log args', () => {
    $__log('__logSite:0', 'hello', 'world');
    expect(logSpy).toHaveBeenCalledTimes(1);
    // The site id must NOT appear in the args forwarded to console.log.
    expect(logSpy).toHaveBeenCalledWith('hello', 'world');
  });

  test('strips site id with single primitive value', () => {
    // Integration | Helper | log >> {{log}} with single primitive value.
    $__log('__logSite:42', 42);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(42);
  });

  test('dedupes identical re-evaluations of the same site', () => {
    // Ember semantics: {{log}} fires once. Re-rendering the same site
    // with the same values must not spam the console.
    $__log('__logSite:dedup-a', 'value');
    $__log('__logSite:dedup-a', 'value');
    $__log('__logSite:dedup-a', 'value');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('value');
  });

  test('re-logs when same site receives different values', () => {
    $__log('__logSite:dedup-b', 1);
    $__log('__logSite:dedup-b', 2);
    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenNthCalledWith(1, 1);
    expect(logSpy).toHaveBeenNthCalledWith(2, 2);
  });

  test('different sites are tracked independently', () => {
    $__log('__logSite:site-c1', 'x');
    $__log('__logSite:site-c2', 'x');
    // Each site fires once even with identical values.
    expect(logSpy).toHaveBeenCalledTimes(2);
  });

  test('unwraps getter args before logging (compat mode)', () => {
    // The compile-time transform may pass argument expressions through the
    // standard reactive-getter wrapping (`() => value`); $__log unwraps via
    // ./_private#unwrap so the user-visible value reaches console.log.
    const getter = () => 'unwrapped';
    $__log('__logSite:getter', getter);
    expect(logSpy).toHaveBeenCalledWith('unwrapped');
  });

  test('non-compat (no site id) path always logs', () => {
    $__log('a');
    $__log('a');
    expect(logSpy).toHaveBeenCalledTimes(2);
  });
});
