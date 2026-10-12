/**
 * `$_looseAppend` (G11, EMBER_LOOSE_COMPONENTS): a content-position `{{name …}}`
 * in a loose template asks the host (`resolveComponentOrHelper`) what `name`
 * is, once per render of the call site. The component branch goes through the
 * host component manager (`WITH_EMBER_INTEGRATION`, exercised end to end by the
 * Ember native layer); the helper / nothing / no-host branches are covered here.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { $_looseAppend, $_looseBuiltins } from './dom';
import { HOST_HOOKS, registerHostHooks } from './host-hooks';
import { $_MANAGERS } from './manager-integration';

describe('$_looseAppend', () => {
  let saved: typeof HOST_HOOKS.resolveComponentOrHelper;
  let savedHelper: typeof $_MANAGERS.helper;
  const ctx = {};

  beforeEach(() => {
    saved = HOST_HOOKS.resolveComponentOrHelper;
    savedHelper = $_MANAGERS.helper;
  });
  afterEach(() => {
    HOST_HOOKS.resolveComponentOrHelper = saved;
    $_MANAGERS.helper = savedHelper;
  });

  test('without a host resolver it throws (never a silent empty render)', () => {
    HOST_HOOKS.resolveComponentOrHelper = undefined;
    expect(() => $_looseAppend('foo-bar', [], {}, ctx as never, 0, true)).toThrow(
      /`\{\{foo-bar\}\}` in a loose-mode template has no host resolver/,
    );
  });

  test('the host is asked with the name, the render context and `optional`', () => {
    const calls: unknown[][] = [];
    registerHostHooks({
      resolveComponentOrHelper: (...args) => {
        calls.push(args);
        return null;
      },
    });
    expect($_looseAppend('name', [], {}, ctx as never, 3, true)).toBe('');
    expect($_looseAppend('x-y', [1], {}, ctx as never, 4, false)).toBe('');
    expect(calls).toEqual([
      ['name', ctx, true],
      ['x-y', ctx, false],
    ]);
  });

  test("'helper': a reactive binding over the call site's helper invocation", () => {
    registerHostHooks({ resolveComponentOrHelper: () => 'helper' });
    const handled: unknown[][] = [];
    $_MANAGERS.helper = {
      canHandle: () => true,
      handle: (...args: unknown[]) => {
        handled.push(args);
        return 'value';
      },
    };
    const binding = $_looseAppend('fmt', [1], { a: 2 }, ctx as never, 7, false);
    expect(typeof binding).toBe('function');
    expect(handled).toHaveLength(0); // lazy: the binding (a formula) evaluates it
    // the binding calls $_maybeHelper(name, positional, named, ctx, site); with
    // WITH_EMBER_INTEGRATION off (standalone vitest build) it reaches the
    // string-helper fallback, so only the shape is asserted here.
    expect((binding as () => unknown).length).toBe(0);
  });
});

describe('$_looseBuiltins', () => {
  let saved: typeof HOST_HOOKS.looseBuiltins;
  beforeEach(() => {
    saved = HOST_HOOKS.looseBuiltins;
  });
  afterEach(() => {
    HOST_HOOKS.looseBuiltins = saved;
  });

  test('hands the render context and the names to the host hook', () => {
    const calls: unknown[][] = [];
    registerHostHooks({ looseBuiltins: (...args) => void calls.push(args) });
    const ctx = {};
    $_looseBuiltins(ctx, ['array', 'hash']);
    expect(calls).toEqual([[ctx, ['array', 'hash']]]);
  });

  test('a host check that throws propagates (Ember assertion)', () => {
    registerHostHooks({
      looseBuiltins: () => {
        throw new Error('You attempted to overwrite the built-in helper "array"');
      },
    });
    expect(() => $_looseBuiltins({}, ['array'])).toThrow(/overwrite the built-in helper "array"/);
  });

  test('without a host hook it does nothing', () => {
    HOST_HOOKS.looseBuiltins = undefined;
    expect(() => $_looseBuiltins({}, ['array'])).not.toThrow();
  });
});
