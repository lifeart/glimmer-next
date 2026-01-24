import { describe, test, expect, vi } from 'vitest';
import {
  $_maybeHelper,
  $_unwrapHelperArg,
  $_unwrapArgs,
  $_componentHelper,
  $_helperHelper,
  $_modifierHelper,
} from './dom';
import { cell } from '@/core/reactive';

describe('$_unwrapHelperArg()', () => {
  describe('primitives', () => {
    test('returns numbers as-is', () => {
      expect($_unwrapHelperArg(42)).toBe(42);
      expect($_unwrapHelperArg(0)).toBe(0);
      expect($_unwrapHelperArg(-1)).toBe(-1);
      expect($_unwrapHelperArg(NaN)).toBeNaN();
    });

    test('returns strings as-is', () => {
      expect($_unwrapHelperArg('hello')).toBe('hello');
      expect($_unwrapHelperArg('')).toBe('');
    });

    test('returns booleans as-is', () => {
      expect($_unwrapHelperArg(true)).toBe(true);
      expect($_unwrapHelperArg(false)).toBe(false);
    });

    test('returns null/undefined as-is', () => {
      expect($_unwrapHelperArg(null)).toBe(null);
      expect($_unwrapHelperArg(undefined)).toBe(undefined);
    });

    test('returns objects as-is', () => {
      const obj = { name: 'test' };
      expect($_unwrapHelperArg(obj)).toBe(obj);
    });

    test('returns arrays as-is', () => {
      const arr = [1, 2, 3];
      expect($_unwrapHelperArg(arr)).toBe(arr);
    });
  });

  describe('getter functions', () => {
    test('unwraps getter returning primitive', () => {
      expect($_unwrapHelperArg(() => 42)).toBe(42);
      expect($_unwrapHelperArg(() => 'hello')).toBe('hello');
      expect($_unwrapHelperArg(() => true)).toBe(true);
      expect($_unwrapHelperArg(() => null)).toBe(null);
      expect($_unwrapHelperArg(() => undefined)).toBe(undefined);
    });

    test('unwraps getter returning object', () => {
      const obj = { name: 'test' };
      expect($_unwrapHelperArg(() => obj)).toBe(obj);
    });

    test('calls getter only once', () => {
      let callCount = 0;
      const getter = () => {
        callCount++;
        return 42;
      };
      $_unwrapHelperArg(getter);
      expect(callCount).toBe(1);
    });

    test('does NOT call functions with prototypes (user callbacks)', () => {
      let called = false;
      function userCallback() {
        called = true;
        return 'should not be called';
      }
      const result = $_unwrapHelperArg(userCallback);
      expect(called).toBe(false);
      expect(result).toBe(userCallback); // Returns the function itself
    });
  });

  describe('reactive cells', () => {
    test('unwraps cell value', () => {
      const c = cell(42);
      expect($_unwrapHelperArg(c)).toBe(42);
    });

    test('unwraps cell with object value', () => {
      const obj = { name: 'test' };
      const c = cell(obj);
      expect($_unwrapHelperArg(c)).toBe(obj);
    });

    test('unwraps getter returning cell (both levels)', () => {
      const c = cell(42);
      // Unwraps the getter -> gets cell -> unwraps cell -> gets 42
      expect($_unwrapHelperArg(() => c)).toBe(42);
    });
  });
});

describe('$_maybeHelper()', () => {
  describe('function helpers with unwrapped args', () => {
    test('calls function with unwrapped getter args', () => {
      const myHelper = vi.fn((a: number, b: number) => a + b);
      const result = $_maybeHelper(myHelper, [() => 10, () => 5], {});

      expect(myHelper).toHaveBeenCalledWith(10, 5);
      expect(result).toBe(15);
    });

    test('calls function with unwrapped cell args', () => {
      const myHelper = vi.fn((value: number) => value * 2);
      const c = cell(21);
      const result = $_maybeHelper(myHelper, [c], {});

      expect(myHelper).toHaveBeenCalledWith(21);
      expect(result).toBe(42);
    });

    test('passes primitive args through unchanged', () => {
      const myHelper = vi.fn((a: string, b: number) => `${a}-${b}`);
      const result = $_maybeHelper(myHelper, ['hello', 42], {});

      expect(myHelper).toHaveBeenCalledWith('hello', 42);
      expect(result).toBe('hello-42');
    });

    test('handles mixed args: getters, cells, and primitives', () => {
      const myHelper = vi.fn((a: number, b: number, c: string) => `${a + b} ${c}`);
      const cellValue = cell(5);
      const result = $_maybeHelper(myHelper, [() => 10, cellValue, 'items'], {});

      expect(myHelper).toHaveBeenCalledWith(10, 5, 'items');
      expect(result).toBe('15 items');
    });

    test('handles empty args', () => {
      const myHelper = vi.fn(() => 'no args');
      const result = $_maybeHelper(myHelper, [], {});

      expect(myHelper).toHaveBeenCalledWith();
      expect(result).toBe('no args');
    });

    test('handles helper returning undefined', () => {
      const myHelper = vi.fn(() => undefined);
      const result = $_maybeHelper(myHelper, [], {});

      expect(result).toBe(undefined);
    });

    test('handles helper returning null', () => {
      const myHelper = vi.fn(() => null);
      const result = $_maybeHelper(myHelper, [], {});

      expect(result).toBe(null);
    });
  });

  describe('non-function values', () => {
    test('returns primitive values as-is', () => {
      expect($_maybeHelper(42, [], {})).toBe(42);
      expect($_maybeHelper('hello', [], {})).toBe('hello');
      expect($_maybeHelper(true, [], {})).toBe(true);
    });

    test('returns null/undefined as-is', () => {
      expect($_maybeHelper(null, [], {})).toBe(null);
      expect($_maybeHelper(undefined, [], {})).toBe(undefined);
    });
  });

  describe('real-world scenarios', () => {
    test('custom format-currency helper with reactive arg', () => {
      const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`;
      const result = $_maybeHelper(formatCurrency, [() => 99.5], {});

      expect(result).toBe('$99.50');
    });

    test('helper receiving object from getter', () => {
      const myHelper = vi.fn((obj: { name: string }) => obj.name);
      const result = $_maybeHelper(myHelper, [() => ({ name: 'John' })], {});

      expect(myHelper).toHaveBeenCalledWith({ name: 'John' });
      expect(result).toBe('John');
    });

    test('helper with multiple reactive cells', () => {
      const add = (a: number, b: number, c: number) => a + b + c;
      const c1 = cell(1);
      const c2 = cell(2);
      const c3 = cell(3);

      const result = $_maybeHelper(add, [c1, c2, c3], {});
      expect(result).toBe(6);
    });

    test('helper that modifies array arg', () => {
      const sumArray = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
      const result = $_maybeHelper(sumArray, [() => [1, 2, 3, 4]], {});

      expect(result).toBe(10);
    });
  });
});

describe('$_unwrapArgs()', () => {
  test('unwraps array of getters in-place', () => {
    const args = [() => 1, () => 2, () => 3];
    const result = $_unwrapArgs(args);

    expect(result).toBe(args); // Same array reference
    expect(result).toEqual([1, 2, 3]);
  });

  test('unwraps mixed array', () => {
    const c = cell(42);
    const args = [() => 'a', c, 'literal', () => null];
    $_unwrapArgs(args);

    expect(args).toEqual(['a', 42, 'literal', null]);
  });

  test('handles empty array', () => {
    const args: unknown[] = [];
    const result = $_unwrapArgs(args);

    expect(result).toEqual([]);
  });
});

describe('$_componentHelper()', () => {
  test('creates wrapped component with pre-bound hash args', () => {
    const constructorArgs: unknown[] = [];
    class MockComponent {
      constructor(args: Record<string, unknown>) {
        constructorArgs.push(args);
      }
    }
    const wrapped = $_componentHelper([MockComponent], { foo: 'bar' });

    // Call the wrapped component with runtime args
    wrapped({ baz: 'qux' });

    expect(constructorArgs).toHaveLength(1);
    expect(constructorArgs[0]).toEqual({ baz: 'qux', foo: 'bar' });
  });

  test('unwraps component reference from getter', () => {
    let called = false;
    class MockComponent {
      constructor() {
        called = true;
      }
    }
    const wrapped = $_componentHelper([() => MockComponent], {});

    wrapped({});

    expect(called).toBe(true);
  });

  test('unwraps hash values', () => {
    const constructorArgs: unknown[] = [];
    class MockComponent {
      constructor(args: Record<string, unknown>) {
        constructorArgs.push(args);
      }
    }
    const c = cell('cellValue');
    const wrapped = $_componentHelper([MockComponent], {
      fromGetter: () => 'getterValue',
      fromCell: c,
      literal: 'literalValue',
    });

    wrapped({});

    expect(constructorArgs[0]).toEqual({
      fromGetter: 'getterValue',
      fromCell: 'cellValue',
      literal: 'literalValue',
    });
  });
});

describe('$_helperHelper()', () => {
  test('creates wrapped helper with pre-bound args', () => {
    const calls: unknown[][] = [];
    // Use a function with prototype (class or regular function) since arrow functions get unwrapped
    function myHelper(...args: unknown[]) {
      calls.push(args);
      return (args[0] as number) + (args[1] as number);
    }
    // Compiler wraps the helper reference in a getter
    const wrapped = $_helperHelper([() => myHelper, 10], {}) as (params: any[], hash: Record<string, unknown>) => any;

    // Call wrapped helper with additional runtime args
    const result = wrapped([5], {});

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([10, 5]);
    expect(result).toBe(15);
  });

  test('unwraps helper reference from getter', () => {
    let called = false;
    function myHelper() {
      called = true;
      return 'result';
    }
    const wrapped = $_helperHelper([() => myHelper], {}) as (params: any[], hash: Record<string, unknown>) => any;

    wrapped([], {});

    expect(called).toBe(true);
  });

  test('unwraps bound args from getters', () => {
    const calls: unknown[][] = [];
    function myHelper(...args: unknown[]) {
      calls.push(args);
      return 'result';
    }
    const c = cell(42);
    // Compiler wraps both helper ref and bound arg in getters
    const wrapped = $_helperHelper([() => myHelper, () => c], {}) as (params: any[], hash: Record<string, unknown>) => any;

    wrapped([], {});

    // The getter () => c is unwrapped to the cell, then the cell is unwrapped to 42
    expect(calls[0]).toEqual([42]);
  });
});

describe('$_modifierHelper()', () => {
  // Create a mock element for tests
  const createMockElement = () => ({ tagName: 'DIV' } as unknown as HTMLElement);

  test('creates wrapped modifier with pre-bound args', () => {
    const calls: unknown[][] = [];
    // Use function with prototype
    function myModifier(node: HTMLElement, params: unknown[], hash: Record<string, unknown>) {
      calls.push([node, params, hash]);
    }
    // Compiler wraps modifier reference in getter
    const wrapped = $_modifierHelper([() => myModifier, 'boundArg'], {});

    const node = createMockElement();
    wrapped(node, ['runtimeArg'], {});

    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(node);
    expect(calls[0][1]).toEqual(['boundArg', 'runtimeArg']);
    expect(calls[0][2]).toEqual({});
  });

  test('unwraps modifier reference from getter', () => {
    let called = false;
    function myModifier() {
      called = true;
    }
    const wrapped = $_modifierHelper([() => myModifier], {});

    const node = createMockElement();
    wrapped(node, [], {});

    expect(called).toBe(true);
  });

  test('unwraps bound positional args from getters', () => {
    const calls: unknown[][] = [];
    function myModifier(node: HTMLElement, params: unknown[], hash: Record<string, unknown>) {
      calls.push([node, params, hash]);
    }
    const c = cell('cellArg');
    // Compiler wraps modifier ref and bound args in getters
    const wrapped = $_modifierHelper([() => myModifier, () => 'getterArg', c], {});

    const node = createMockElement();
    wrapped(node, [], {});

    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual(['getterArg', 'cellArg']);
  });
});
