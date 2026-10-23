/**
 * Seam test for the argument-thunk marker ($_argThunk).
 *
 * In the Ember dialect (WITH_EMBER_INTEGRATION) a component's named args are
 * emitted by `buildArgsObject` as `$_args({ key: <thunk> }, …)`, where a
 * reactive value is a zero-arg getter (`() => this.x`) the arg-access layer
 * (`ArgProxyHandler` / the DEV `$_args` getter) must INVOKE on read. A host also
 * forwards bare FUNCTION VALUES (actions, `{{fn}}`/helper bound results) as args;
 * those must NOT be invoked. The compiler brands the thunks it emits with
 * `$_argThunk` so the arg layer invokes only branded functions and passes every
 * other function value through unchanged (ember.js#21340 C38).
 *
 * This pins the compiler→runtime seam: branding is emitted for the reactive arg
 * getters, NOT for literals or eagerly-evaluated values, and only in the Ember
 * dialect (standalone gxt keeps byte-identical codegen + invoke-every-getter).
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';
import { $_argThunk, isArgThunk } from '../../../src/core/dom';

const COMPAT = {
  IS_GLIMMER_COMPAT_MODE: true,
  WITH_EMBER_INTEGRATION: true,
} as const;

function code(tpl: string, flags: Record<string, unknown>, bindings: string[] = []) {
  const result = compile(tpl, { flags: flags as never, bindings: new Set(bindings) });
  expect(result.errors).toHaveLength(0);
  return result.code;
}

describe('arg-thunk marker emission ($_argThunk)', () => {
  test('a reactive path arg getter is branded', () => {
    const c = code('<Foo @a={{this.x}} />', COMPAT, ['Foo']);
    expect(c).toContain('a: $_argThunk(() => this.x)');
  });

  test('a literal arg is NOT branded (not a thunk)', () => {
    const c = code('<Foo @a="hi" @n={{42}} />', COMPAT, ['Foo']);
    expect(c).toContain('a: "hi"');
    expect(c).toContain('n: 42');
    expect(c).not.toContain('$_argThunk("hi")');
    expect(c).not.toContain('$_argThunk(42)');
  });

  test('standalone gxt (no Ember integration) does NOT brand', () => {
    // Only the Ember dialect forwards bare function values into args, so the
    // branding — and the brand-only invocation it pairs with — is gated off for
    // standalone gxt, keeping its codegen byte-identical.
    const c = code('<Foo @a={{this.x}} />', { IS_GLIMMER_COMPAT_MODE: true }, ['Foo']);
    expect(c).toContain('a: () => this.x');
    expect(c).not.toContain('$_argThunk');
  });
});

describe('arg-thunk marker runtime ($_argThunk / isArgThunk)', () => {
  test('$_argThunk brands a function and isArgThunk detects it', () => {
    const thunk = $_argThunk(() => 'a()'); // minified-like body (no $_* substrings)
    expect(isArgThunk(thunk)).toBe(true);
    expect(thunk()).toBe('a()');
  });

  test('a plain function value is NOT an arg thunk', () => {
    const action = () => 'should not be invoked by the arg layer';
    expect(isArgThunk(action)).toBe(false);
  });

  test('$_argThunk is a no-op (identity) on non-functions', () => {
    expect($_argThunk(42)).toBe(42);
    expect($_argThunk('x')).toBe('x');
    expect(isArgThunk(42)).toBe(false);
    expect(isArgThunk('x')).toBe(false);
    expect(isArgThunk(undefined)).toBe(false);
    expect(isArgThunk(null)).toBe(false);
  });
});
