/**
 * Ember (compat and native), EMBER_ARG_LABELS: a helper or modifier call site
 * whose arguments include a path passes the source text of those paths to the
 * host, as a trailing labels argument.
 *
 * Glimmer labels a path reference with its path (`this.foo`), and the
 * assertions of its built-ins name the argument by that label:
 * `{{on "click" this.foo}}` with `foo` undefined throws "You must pass a
 * function as the second argument to the `on` modifier; you passed undefined.
 * While rendering:⏎⏎this.foo". gxt passed the host the argument values (or
 * thunks) only, so the Ember build labelled every argument reference with a
 * constant (`modifier-arg`).
 *
 * The labels are `{ positional: [...], named: {...} }`, after the render
 * context and the call-site index (`undefined` where the call has none). The
 * runtime hands them to the host helper / modifier manager. Without the flag,
 * or without a path argument, a call keeps its shape; standalone gxt is
 * unchanged.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { compile } from '../../plugins/compiler/compile';
import { $_MANAGERS } from './manager-integration';
import { $_maybeHelper, $_maybeModifier } from './dom';

const COMPAT = {
  IS_GLIMMER_COMPAT_MODE: true,
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
};
const NATIVE = { ...COMPAT, EMBER_NATIVE: true, EMBER_SELF: true, EMBER_PROPERTY_TAGS: true };
const LABELS = { EMBER_ARG_LABELS: true };

function code(tpl: string, flags: object, bindings: string[] = []) {
  const result = compile(tpl, { flags: flags as never, bindings: new Set(bindings) });
  expect(result.errors).toHaveLength(0);
  return result.code.split('/*#__PURE__*/').join('');
}

describe('EMBER_ARG_LABELS: compat emission', () => {
  const flags = { ...COMPAT, ...LABELS };

  test('a modifier by name: the path argument is labelled, after the context compat does not pass', () => {
    expect(code(`<button {{on-ext 'click' this.foo}}>x</button>`, flags)).toContain(
      `$_maybeModifier("on-ext", $n, ["click", this.foo], {}, undefined, { positional: [null, "this.foo"] })`,
    );
  });

  test('a modifier binding, with a named argument', () => {
    expect(code(`<button {{on 'click' this.foo once=this.once}}>x</button>`, flags, ['on'])).toContain(
      `{ once: () => this.once }, undefined, { positional: [null, "this.foo"], named: { once: "this.once" } })`,
    );
  });

  test('a helper binding: this-paths and an argument', () => {
    expect(code('{{fn this.myFunc this.arg1 @a}}', flags, ['fn'])).toContain(
      `$_maybeHelper(fn, [() => this.myFunc, () => this.arg1, () => $a.a], {}, undefined, undefined, { positional: ["this.myFunc", "this.arg1", "@a"] })`,
    );
  });

  test('a block param path, and a literal', () => {
    expect(code('{{#let this.x as |y|}}{{fn y.z "lit"}}{{/let}}', flags, ['fn'])).toContain(
      `{}, undefined, undefined, { positional: ["y.z", null] })`,
    );
  });

  test('a helper by name keeps its context, before the labels', () => {
    expect(code('{{my-helper this.a b=this.b}}', flags)).toContain(
      `$_maybeHelper("my-helper", [() => this.a], { b: () => this.b }, this, undefined, { positional: ["this.a"], named: { b: "this.b" } })`,
    );
  });

  test('a dynamic modifier', () => {
    expect(code('<div {{(if this.c this.m) this.x}}></div>', flags)).toContain(
      `$n, [this.x], () => ({}), undefined, { positional: ["this.x"] })`,
    );
  });

  test('literal arguments only: no labels (guard)', () => {
    expect(code('{{concat "a" "b"}}', flags, ['concat'])).toContain('$_maybeHelper(concat, ["a", "b"], {})');
  });

  test('flag off: no labels (guard)', () => {
    expect(code('{{fn this.myFunc @a}}', COMPAT, ['fn'])).toContain(
      '$_maybeHelper(fn, [() => this.myFunc, () => $a.a], {})]',
    );
    expect(code(`<button {{on-ext 'click' this.foo}}>x</button>`, COMPAT)).toContain(
      '$_maybeModifier("on-ext", $n, ["click", this.foo], {})]',
    );
  });
});

describe('EMBER_ARG_LABELS: native emission', () => {
  const flags = { ...NATIVE, ...LABELS };

  test('a modifier: the labels follow the render context', () => {
    expect(code(`<button {{on 'click' this.foo}}>x</button>`, flags, ['on'])).toContain(
      `["click", () => $__tag($s, "foo")], {}, this, { positional: [null, "this.foo"] })`,
    );
  });

  test('a helper: the labels follow the call-site index', () => {
    expect(code('{{fn this.myFunc @a}}', flags, ['fn'])).toContain(
      `{}, this, 0, { positional: ["this.myFunc", "@a"] })`,
    );
  });

  test('flag off: no labels (guard)', () => {
    expect(code('{{fn this.myFunc @a}}', NATIVE, ['fn'])).toContain('{}, this, 0)]');
  });
});

test('standalone gxt is unchanged (guard)', () => {
  const standalone = { IS_GLIMMER_COMPAT_MODE: true, ...LABELS };
  expect(code('{{my-helper this.a}}', standalone)).toBe(code('{{my-helper this.a}}', { IS_GLIMMER_COMPAT_MODE: true }));
});

describe('EMBER_ARG_LABELS: the runtime hands the labels to the host managers', () => {
  type RuntimeConstants = { EMBER_NATIVE: boolean; WITH_EMBER_INTEGRATION: boolean };
  const runtime = globalThis as unknown as RuntimeConstants;
  let saved: RuntimeConstants;
  let savedHelper: typeof $_MANAGERS.helper;
  let savedModifier: typeof $_MANAGERS.modifier;
  beforeEach(() => {
    saved = { EMBER_NATIVE: runtime.EMBER_NATIVE, WITH_EMBER_INTEGRATION: runtime.WITH_EMBER_INTEGRATION };
    savedHelper = $_MANAGERS.helper;
    savedModifier = $_MANAGERS.modifier;
  });
  afterEach(() => {
    runtime.EMBER_NATIVE = saved.EMBER_NATIVE;
    runtime.WITH_EMBER_INTEGRATION = saved.WITH_EMBER_INTEGRATION;
    $_MANAGERS.helper = savedHelper;
    $_MANAGERS.modifier = savedModifier;
  });
  const labels = { positional: [null, 'this.foo'] };

  test('native: the helper manager gets them', () => {
    runtime.EMBER_NATIVE = true;
    runtime.WITH_EMBER_INTEGRATION = true;
    const seen: unknown[] = [];
    $_MANAGERS.helper = {
      canHandle: () => true,
      handle: (...args: unknown[]) => {
        seen.push(args[5]);
        return 'value';
      },
    } as never;
    const ctx = {};
    expect($_maybeHelper({}, ['click', () => undefined], {}, ctx, 3, labels)).toBe('value');
    expect(seen).toEqual([labels]);
  });

  test('compat and native: the modifier manager gets them', () => {
    runtime.EMBER_NATIVE = false;
    runtime.WITH_EMBER_INTEGRATION = true;
    const seen: unknown[] = [];
    $_MANAGERS.modifier = {
      canHandle: () => true,
      handle: (...args: unknown[]) => {
        seen.push(args[5]);
        return undefined;
      },
    } as never;
    const element = {} as HTMLElement;
    $_maybeModifier('on-ext', element, ['click', undefined], (() => ({})) as never, undefined, labels);
    expect(seen).toEqual([labels]);
  });
});
