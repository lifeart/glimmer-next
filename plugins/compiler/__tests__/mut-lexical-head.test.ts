/**
 * R7 (ember.js#21340 C13/C14): `(mut <lexical path>)` must be writable.
 *
 * `(mut this.foo)` / `(mut @bar)` pass the path as a string the host parses,
 * but a LEXICAL JS head (`state.arg1`, where `state` is a block param) cannot
 * be resolved by name at runtime, so the former code dropped it and the host's
 * `mut` asserted "You can only pass a path to mut". A lexical-head mut now
 * lowers to the existing `__mutGet(() => head, "rest")` machinery (a parent
 * getter + key the host writes through with `set(parent, key, v)`). The parent
 * getter is `buildValue`'s own read of the head, so it is the actual parent
 * object whatever the binding's compiled shape.
 *
 * Covers `{{fn (mut state.arg1)}}` (Helpers test: {{fn}} can be used on the
 * result of `mut`).
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

const COMPAT = { IS_GLIMMER_COMPAT_MODE: true } as const;

function code(tpl: string, flags: Record<string, unknown> = COMPAT) {
  const result = compile(tpl, { flags: flags as never, bindings: new Set(['Btn']) });
  expect(result.errors).toHaveLength(0);
  return result.code;
}

// A plain block param (each row) is read as a bare `state`, so the parent
// getter is unambiguously `() => state`.
const wrapEach = (inner: string) =>
  `{{#each this.items as |state|}}${inner}{{/each}}`;

describe('(mut <lexical head>) lowers to __mutGet (R7)', () => {
  // `__mutGet` is not a built-in, so it lowers through `$_maybeHelper`:
  // `$_maybeHelper("__mutGet", [() => state, "arg1"], this, N)`. The positional
  // args are the (parent getter, key) pair the host writes through. Assert the
  // three load-bearing pieces independently (robust to argument-array layout):
  // the __mutGet lowering, the parent getter reading `state`, and the key.
  const expectMutGet = (c: string, key: string) => {
    expect(c).toContain('__mutGet');
    expect(c).toMatch(/=>\s*state\b/); // parent getter: () => state
    expect(c).toContain(`"${key}"`); // key string
  };

  test('subexpression form: {{fn (mut state.arg1)}}', () => {
    expectMutGet(code(wrapEach('<Btn @click={{fn (mut state.arg1)}} />')), 'arg1');
  });

  test('mustache form: @v={{mut state.arg1}}', () => {
    expectMutGet(code(wrapEach('<Btn @v={{mut state.arg1}} />')), 'arg1');
  });

  test('deep lexical tail is passed as a dotted key', () => {
    expectMutGet(code(wrapEach('<Btn @v={{mut state.a.b}} />')), 'a.b');
  });

  test('this./@ heads are unchanged (still the path-string form, not __mutGet)', () => {
    const thisC = code('<Btn @v={{mut this.foo}} />');
    expect(thisC).toContain('"this.foo"');
    expect(thisC).not.toContain('__mutGet');
    const argC = code('<Btn @v={{mut @bar}} />');
    expect(argC).toContain('"@bar"');
    expect(argC).not.toContain('__mutGet');
  });

  test('non-compat mode does not rewrite lexical mut', () => {
    const c = code(wrapEach('<Btn @v={{mut state.arg1}} />'), {
      IS_GLIMMER_COMPAT_MODE: false,
    });
    expect(c).not.toContain('__mutGet');
  });
});
