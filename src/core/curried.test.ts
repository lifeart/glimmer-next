import { describe, test, expect } from 'vitest';
import {
  $_curry,
  getCurried,
  isCurried,
  resolveCurried,
  CURRIED_COMPONENT,
  CURRIED_HELPER,
  CURRIED_MODIFIER,
} from './curried';
import { $_unwrapHelperArg } from './dom';
import { cell, formula } from './reactive';
import { $_MANAGERS } from './manager-integration';

describe('curried values (G9)', () => {
  test('a curried value carries kind, definition and LAZY args', () => {
    const def = function Cmp() {};
    let reads = 0;
    const thunk = () => {
      reads++;
      return 'x';
    };
    const c = $_curry(CURRIED_COMPONENT, [() => def, thunk], { a: thunk, b: 1 });
    const state = getCurried(c)!;
    expect(state.kind).toBe(CURRIED_COMPONENT);
    expect(state.definition).toBe(def);
    expect(state.positional).toEqual([thunk]);
    expect(state.named).toEqual({ a: thunk, b: 1 });
    expect(reads).toBe(0); // argument thunks are not read at curry time
  });

  test('the definition thunk is read at curry time (a reading formula tracks it)', () => {
    const A = function A() {};
    const B = function B() {};
    const which = cell<unknown>(A);
    const f = formula(() => getCurried($_curry(CURRIED_HELPER, [() => which.value], {}))!.definition);
    expect(f.value).toBe(A);
    which.update(B);
    expect(f.value).toBe(B);
  });

  test('a literal (string) definition is kept as-is', () => {
    expect(getCurried($_curry(CURRIED_COMPONENT, ['my-comp'], {}))!.definition).toBe('my-comp');
  });

  test('a nullish definition curries to itself (renders / installs nothing)', () => {
    expect($_curry(CURRIED_COMPONENT, [() => null], {})).toBe(null);
    expect($_curry(CURRIED_MODIFIER, [() => undefined], {})).toBe(undefined);
  });

  test('curried values are branded functions: not callable, never unwrapped as getters', () => {
    const c = $_curry(CURRIED_MODIFIER, [() => function m() {}], {});
    expect(typeof c).toBe('function');
    expect(() => (c as () => void)()).toThrow(/curried modifier cannot be called directly/);
    // has a prototype → the compat arrow-getter heuristic leaves it alone
    expect($_unwrapHelperArg(c)).toBe(c);
    expect(isCurried(c)).toBe(true);
    expect(isCurried(c, CURRIED_MODIFIER)).toBe(true);
    expect(isCurried(c, CURRIED_COMPONENT)).toBe(false);
    expect(isCurried(function plain() {})).toBe(false);
    expect(getCurried({})).toBe(undefined);
  });

  test('a curried helper called with no arguments is invoked through the host helper manager', () => {
    const saved = $_MANAGERS.helper;
    try {
      const calls: unknown[][] = [];
      $_MANAGERS.helper = {
        canHandle: () => true,
        handle: (...args: unknown[]) => {
          calls.push(args);
          return 'value';
        },
      };
      const h = $_curry(CURRIED_HELPER, [() => function hlp() {}, 1], {});
      expect((h as () => unknown)()).toBe('value');
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe(h);
      expect(calls[0][1]).toEqual([]);
      // a curried component is still not callable
      const c = $_curry(CURRIED_COMPONENT, [() => function cmp() {}], {});
      expect(() => (c as () => unknown)()).toThrow(/curried component/);
    } finally {
      $_MANAGERS.helper = saved;
    }
  });

  test('resolveCurried: positional inner-most first, named layered inner → outer', () => {
    const def = function Def() {};
    const inner = $_curry(CURRIED_COMPONENT, [() => def, 'i1', 'i2'], { a: 'inner', b: 'inner' });
    const outer = $_curry(CURRIED_COMPONENT, [() => inner, 'o1'], { b: 'outer', c: 'outer' });
    const resolved = resolveCurried(outer);
    expect(resolved.definition).toBe(def);
    expect(resolved.positional).toEqual(['i1', 'i2', 'o1']);
    expect(resolved.named).toEqual([
      { a: 'inner', b: 'inner' },
      { b: 'outer', c: 'outer' },
    ]);
    // Glimmer precedence: a later layer overrides an earlier one
    expect(Object.assign({}, ...resolved.named)).toEqual({ a: 'inner', b: 'outer', c: 'outer' });
  });

  test('resolveCurried of a non-curried value is the value itself', () => {
    const def = function Def() {};
    expect(resolveCurried(def)).toEqual({ definition: def, positional: [], named: [] });
  });
});
