// @vitest-environment happy-dom
/**
 * The named arguments of a helper call and of a loose-mode append reach an
 * args object (`$_args`): under WITH_EMBER_INTEGRATION it invokes only the
 * getters branded `$_argThunk` and hands any other function out as the
 * argument's value. The compiler brands the getters it emits for these
 * arguments where it builds them (serializers/value.ts `brandArgGetter`), so
 * a getter is read and a function value — an action, a `(fn)` result — is
 * passed as it is, whatever its shape.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { $_maybeHelper, $_looseAppend, $_argThunk, $_unwrapHelperArg } from './dom';
import { $__hash } from './helpers/hash';
import { $__fn } from './helpers/fn';
import { HOST_HOOKS } from './host-hooks';
import { $_MANAGERS } from './manager-integration';
import { compile } from '../../plugins/compiler/compile';

type RuntimeConstants = { EMBER_NATIVE: boolean; WITH_EMBER_INTEGRATION: boolean };
const runtime = globalThis as unknown as RuntimeConstants;

const COMPAT = {
  IS_GLIMMER_COMPAT_MODE: true,
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
} as const;
const NATIVE = { ...COMPAT, EMBER_NATIVE: true, EMBER_SELF: true, EMBER_PROPERTY_TAGS: true } as const;

function code(tpl: string, flags: object, bindings: string[] = []) {
  const result = compile(tpl, { flags: flags as never, bindings: new Set(bindings) });
  expect(result.errors).toHaveLength(0);
  return result.code.split('/*#__PURE__*/').join('');
}

describe('the compiler brands the getters among a helper\'s named arguments', () => {
  test('compat: a path is a branded getter, a sub-expression a value', () => {
    const out = code('{{my-helper this.x save=(fn this.save 1) action=this.act n=1}}', COMPAT);
    expect(out).toContain('$_maybeHelper("my-helper"');
    expect(out).toContain('action: $_argThunk(() => this.act)');
    expect(out).toContain('n: 1');
    expect(out).toContain('save: $__fn(');
  });

  test("compat: a curried helper's named arguments too", () => {
    const out = code('{{yield (helper "x" foo=this.y)}}', COMPAT);
    expect(out).toContain('{ foo: $_argThunk(() => this.y) }');
  });

  test('native: every getter of the literal-or-thunk arguments, a loose-mode append included', () => {
    const helper = code('{{fmt other=this.b n=1}}', NATIVE, ['fmt']);
    expect(helper).toContain('{ other: $_argThunk(() => $__tag($s, "b")), n: 1 }');
  });

  test('positional getters and (hash) member getters are branded too', () => {
    const compat = code('{{my-helper this.x (fn this.save 1) 2}}', COMPAT);
    expect(compat).toContain(
      '$_maybeHelper("my-helper", [$_argThunk(() => this.x), $__fn(() => this.save, 1), 2]',
    );
    const native = code('{{fmt this.b}}', NATIVE, ['fmt']);
    expect(native).toContain('$_maybeHelper(fmt, [$_argThunk(() => $__tag($s, "b"))]');
    for (const flags of [COMPAT, NATIVE]) {
      const hash = code('{{yield (hash a=this.a b=(fn this.save 1))}}', flags);
      expect(hash).toMatch(/\$__hash\(\{ a: \$_argThunk\(\(\) => /);
      expect(hash).toMatch(/b: \$_argThunk\(\(\) => \$__fn\(/);
    }
  });

  test('standalone: no brand', () => {
    expect(code('{{my-helper a=this.b}}', { IS_GLIMMER_COMPAT_MODE: true })).not.toContain(
      '$_argThunk',
    );
    expect(
      code('{{my-helper this.x (hash a=this.a)}}', { IS_GLIMMER_COMPAT_MODE: true }),
    ).not.toContain('$_argThunk');
  });
});

describe('named argument getters of helper calls and loose-mode appends', () => {
  let saved: RuntimeConstants;
  let savedManagers: { component: typeof $_MANAGERS.component; helper: typeof $_MANAGERS.helper };
  beforeEach(() => {
    saved = {
      EMBER_NATIVE: runtime.EMBER_NATIVE,
      WITH_EMBER_INTEGRATION: runtime.WITH_EMBER_INTEGRATION,
    };
    savedManagers = { component: $_MANAGERS.component, helper: $_MANAGERS.helper };
    runtime.WITH_EMBER_INTEGRATION = true;
    runtime.EMBER_NATIVE = false;
  });
  afterEach(() => {
    runtime.EMBER_NATIVE = saved.EMBER_NATIVE;
    runtime.WITH_EMBER_INTEGRATION = saved.WITH_EMBER_INTEGRATION;
    $_MANAGERS.component = savedManagers.component;
    $_MANAGERS.helper = savedManagers.helper;
    delete (HOST_HOOKS as Record<string, unknown>).isFunctionalHelper;
    delete (HOST_HOOKS as Record<string, unknown>).resolveComponentOrHelper;
  });

  test('an Ember-style class helper reads a branded getter and gets function values as they are', () => {
    let seen: Record<string, unknown> = {};
    let calls = 0;
    class Greeting {
      static helperType = 'ember';
      compute(_positional: unknown[], hash: Record<string, unknown>) {
        seen = { name: hash.name, action: hash.action, bound: hash.bound, count: hash.count };
        return 'ok';
      }
    }
    function action() {
      calls++;
    }
    // an arrow function value, as a `(fn)` result is
    const bound = () => {
      calls++;
    };
    const invoke = $_maybeHelper(Greeting, [], {
      name: $_argThunk(() => 'Zoey'),
      action,
      bound,
      count: 2,
    });
    expect((invoke as () => unknown)()).toBe('ok');
    expect(seen).toEqual({ name: 'Zoey', action, bound, count: 2 });
    expect(calls).toBe(0);
  });

  test('a host functional helper reads a branded getter and gets an arrow value as it is', () => {
    let seen: Record<string, unknown> = {};
    const format = (_positional: unknown[], hash: Record<string, unknown>) => {
      seen = { unit: hash.unit, onChange: hash.onChange };
      return 'formatted';
    };
    const onChange = () => 'changed';
    HOST_HOOKS.isFunctionalHelper = (fn: unknown) => fn === format;
    const invoke = $_maybeHelper(format, [], { unit: $_argThunk(() => 'kg'), onChange });
    expect((invoke as () => unknown)()).toBe('formatted');
    expect(seen).toEqual({ unit: 'kg', onChange });
  });

  test('a loose-mode append of a component hands it the values of its named arguments', () => {
    runtime.EMBER_NATIVE = true;
    HOST_HOOKS.resolveComponentOrHelper = () => 'component';
    let seen: Record<string, unknown> = {};
    $_MANAGERS.component = {
      canHandle: () => true,
      handle: (_definition: unknown, args: unknown) => {
        const named = args as Record<string, unknown>;
        seen = { title: named.title, size: named.size, onClose: named.onClose };
        return () => [];
      },
    };
    const onClose = () => 'closed';
    $_looseAppend(
      'my-card',
      [],
      { title: $_argThunk(() => 'Hello'), size: 3, onClose },
      {} as never,
      0,
      false,
    );
    expect(seen).toEqual({ title: 'Hello', size: 3, onClose });
  });
});

describe('positional helper arguments and (hash) members', () => {
  let saved: boolean;
  beforeEach(() => {
    saved = runtime.WITH_EMBER_INTEGRATION;
  });
  afterEach(() => {
    runtime.WITH_EMBER_INTEGRATION = saved;
  });

  test('Ember dialect: only a branded getter is read; any other function is the value', () => {
    runtime.WITH_EMBER_INTEGRATION = true;
    const action = () => 'called';
    expect($_unwrapHelperArg($_argThunk(() => 5))).toBe(5);
    expect($_unwrapHelperArg(action)).toBe(action);
    const hash = $__hash({ a: $_argThunk(() => 1), onClick: action }) as Record<string, unknown>;
    expect(hash.a).toBe(1);
    expect(hash.onClick).toBe(action);
  });

  test('standalone: a getter is any function without a prototype; a (fn) result has one', () => {
    runtime.WITH_EMBER_INTEGRATION = false;
    let calls = 0;
    const save = () => {
      calls++;
    };
    expect($_unwrapHelperArg(() => 5)).toBe(5);
    const bound = $__fn(save, 1);
    expect($_unwrapHelperArg(bound)).toBe(bound);
    expect(calls).toBe(0);
    const hash = $__hash({ a: () => 1 }) as Record<string, unknown>;
    expect(hash.a).toBe(1);
    // A bound function passed to another (fn) reaches it as the value.
    const outer = $__fn((received: unknown) => received, bound) as () => unknown;
    expect(outer()).toBe(bound);
    expect(calls).toBe(0);
  });
});

