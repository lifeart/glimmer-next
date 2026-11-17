// @vitest-environment happy-dom
/**
 * The named arguments of a helper call and of a loose-mode append reach an
 * args object (`$_args`) with their getters branded (`$_argThunk`): under
 * WITH_EMBER_INTEGRATION that object invokes only branded getters and hands
 * any other function out as the argument's value, and the compiler does not
 * brand these getters (only a component invocation's). Without the brand the
 * helper / component read the getter itself instead of the argument.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { $_maybeHelper, $_looseAppend, isArgThunk } from './dom';
import { HOST_HOOKS } from './host-hooks';
import { $_MANAGERS } from './manager-integration';

type RuntimeConstants = { EMBER_NATIVE: boolean; WITH_EMBER_INTEGRATION: boolean };
const runtime = globalThis as unknown as RuntimeConstants;

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

  test('an Ember-style class helper reads a named argument through its getter (compat dialect)', () => {
    let seen: Record<string, unknown> = {};
    class Greeting {
      static helperType = 'ember';
      compute(_positional: unknown[], hash: Record<string, unknown>) {
        seen = { name: hash.name, action: hash.action, count: hash.count };
        return 'ok';
      }
    }
    function action() {}
    const getter = () => 'Zoey';
    const invoke = $_maybeHelper(Greeting, [], { name: getter, action, count: 2 });
    expect((invoke as () => unknown)()).toBe('ok');
    // the getter is read; a function with a prototype is a value; a literal stays
    expect(seen).toEqual({ name: 'Zoey', action, count: 2 });
    // the compiler's getter is not branded in place
    expect(isArgThunk(getter)).toBe(false);
  });

  test("a host functional helper reads a named argument through its getter (compat dialect)", () => {
    let seen: unknown;
    const format = (_positional: unknown[], hash: Record<string, unknown>) => {
      seen = hash.unit;
      return 'formatted';
    };
    HOST_HOOKS.isFunctionalHelper = (fn: unknown) => fn === format;
    const invoke = $_maybeHelper(format, [], { unit: () => 'kg' });
    expect((invoke as () => unknown)()).toBe('formatted');
    expect(seen).toBe('kg');
  });

  test('under EMBER_NATIVE every function of the named arguments is a getter (literal-or-thunk)', () => {
    runtime.EMBER_NATIVE = true;
    let seen: unknown;
    const format = (_positional: unknown[], hash: Record<string, unknown>) => {
      seen = hash.unit;
      return 'formatted';
    };
    HOST_HOOKS.isFunctionalHelper = (fn: unknown) => fn === format;
    const invoke = $_maybeHelper(format, [], {
      unit: function unitGetter() {
        return 'kg';
      },
    });
    (invoke as () => unknown)();
    expect(seen).toBe('kg');
  });

  test('a loose-mode append of a component hands it the values of its named arguments', () => {
    runtime.EMBER_NATIVE = true;
    HOST_HOOKS.resolveComponentOrHelper = () => 'component';
    let seen: Record<string, unknown> = {};
    $_MANAGERS.component = {
      canHandle: () => true,
      handle: (_definition: unknown, args: unknown) => {
        const named = args as Record<string, unknown>;
        seen = { title: named.title, size: named.size };
        return () => [];
      },
    };
    $_looseAppend('my-card', [], { title: () => 'Hello', size: 3 }, {} as never, 0, false);
    expect(seen).toEqual({ title: 'Hello', size: 3 });
  });
});
