import { describe, test, expect } from 'vitest';
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
      let receivedArgs: unknown[] = [];
      const myHelper = (...args: [number, number]) => {
        receivedArgs = args;
        return args[0] + args[1];
      };
      const result = $_maybeHelper(myHelper, [() => 10, () => 5], {});

      expect(receivedArgs).toEqual([10, 5]);
      expect(result).toBe(15);
    });

    test('calls function with unwrapped cell args', () => {
      let receivedArgs: unknown[] = [];
      const myHelper = (...args: [number]) => {
        receivedArgs = args;
        return args[0] * 2;
      };
      const c = cell(21);
      const result = $_maybeHelper(myHelper, [c], {});

      expect(receivedArgs).toEqual([21]);
      expect(result).toBe(42);
    });

    test('passes primitive args through unchanged', () => {
      let receivedArgs: unknown[] = [];
      const myHelper = (...args: [string, number]) => {
        receivedArgs = args;
        return `${args[0]}-${args[1]}`;
      };
      const result = $_maybeHelper(myHelper, ['hello', 42], {});

      expect(receivedArgs).toEqual(['hello', 42]);
      expect(result).toBe('hello-42');
    });

    test('handles mixed args: getters, cells, and primitives', () => {
      let receivedArgs: unknown[] = [];
      const myHelper = (...args: [number, number, string]) => {
        receivedArgs = args;
        return `${args[0] + args[1]} ${args[2]}`;
      };
      const cellValue = cell(5);
      const result = $_maybeHelper(myHelper, [() => 10, cellValue, 'items'], {});

      expect(receivedArgs).toEqual([10, 5, 'items']);
      expect(result).toBe('15 items');
    });

    test('handles empty args', () => {
      let callCount = 0;
      const myHelper = () => {
        callCount++;
        return 'no args';
      };
      const result = $_maybeHelper(myHelper, [], {});

      expect(callCount).toBe(1);
      expect(result).toBe('no args');
    });

    test('handles helper returning undefined', () => {
      const myHelper = () => undefined;
      const result = $_maybeHelper(myHelper, [], {});

      expect(result).toBe(undefined);
    });

    test('handles helper returning null', () => {
      const myHelper = () => null;
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
      let receivedArgs: unknown[] = [];
      const myHelper = (...args: [{ name: string }]) => {
        receivedArgs = args;
        return args[0].name;
      };
      const result = $_maybeHelper(myHelper, [() => ({ name: 'John' })], {});

      expect(receivedArgs).toEqual([{ name: 'John' }]);
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

describe('$_componentHelper with string component names', () => {
  test('handles string component name', () => {
    const wrapped = $_componentHelper(['my-component'], { foo: 'bar' });

    // Should return a function
    expect(typeof wrapped).toBe('function');

    // Should have the string component name marker
    expect((wrapped as any).__stringComponentName).toBe('my-component');
  });

  test('string component wrapper merges hash args', () => {
    const wrapped = $_componentHelper(['string-comp'], { prebound: 'value' });

    // Call with runtime args
    const args = { runtime: 'arg' };
    wrapped(args);

    // Hash args should be merged into the args
    expect(args).toEqual({ runtime: 'arg', prebound: 'value' });
  });

  test('string component wrapper unwraps hash getters', () => {
    const wrapped = $_componentHelper(['string-comp'], {
      fromGetter: () => 'unwrapped',
      literal: 'direct',
    });

    const args: Record<string, unknown> = {};
    wrapped(args);

    expect(args.fromGetter).toBe('unwrapped');
    expect(args.literal).toBe('direct');
  });
});

describe('$_maybeHelper with string value (eval resolution)', () => {
  test('resolves string value via globalThis.$_eval', () => {
    const prevEval = (globalThis as any).$_eval;
    try {
      (globalThis as any).$_eval = (name: string) => {
        if (name === 'greeting') return 'Hello!';
        throw new ReferenceError(`${name} is not defined`);
      };
      const result = $_maybeHelper('greeting', []);
      expect(result).toBe('Hello!');
    } finally {
      (globalThis as any).$_eval = prevEval;
    }
  });

  test('resolves string value via context.$_eval (3-arg form)', () => {
    const ctx = {
      $_eval: (name: string) => {
        if (name === 'myVar') return 42;
        throw new ReferenceError(`${name} is not defined`);
      },
      $args: {},
    };
    const result = $_maybeHelper('myVar', [], ctx);
    expect(result).toBe(42);
  });

  test('resolves string value via context.$_eval (4-arg form with hash)', () => {
    const ctx = {
      $_eval: (name: string) => {
        if (name === 'helper') return 'resolved';
        throw new ReferenceError(`${name} is not defined`);
      },
      $args: {},
    };
    const hash = { format: () => 'short' };
    const result = $_maybeHelper('helper', [], hash, ctx);
    expect(result).toBe('resolved');
  });

  test('calls resolved function with unwrapped args when eval returns function', () => {
    let callCount = 0;
    const myFn = (...args: any[]) => {
      callCount++;
      return args.join('-');
    };
    const ctx = {
      $_eval: (name: string) => {
        if (name === 'myHelper') return myFn;
        throw new ReferenceError(`${name} is not defined`);
      },
      $args: {},
    };
    const result = $_maybeHelper('myHelper', ['a', 'b'], ctx);
    expect(callCount).toBe(1);
    expect(result).toBe('a-b');
  });

  test('returns undefined when eval throws', () => {
    const ctx = {
      $_eval: () => {
        throw new ReferenceError('not defined');
      },
      $args: {},
    };
    const result = $_maybeHelper('missing', [], ctx);
    expect(result).toBeUndefined();
  });

  test('returns string value as-is when no eval is available (2-arg form)', () => {
    const prevEval = (globalThis as any).$_eval;
    try {
      (globalThis as any).$_eval = undefined;
      const result = $_maybeHelper('unknownBinding', []);
      expect(result).toBe('unknownBinding');
    } finally {
      (globalThis as any).$_eval = prevEval;
    }
  });

  test('context.$_eval takes precedence over globalThis.$_eval', () => {
    const prevEval = (globalThis as any).$_eval;
    try {
      (globalThis as any).$_eval = () => 'global';
      const ctx = {
        $_eval: () => 'context',
        $args: {},
      };
      const result = $_maybeHelper('anyVar', [], ctx);
      expect(result).toBe('context');
    } finally {
      (globalThis as any).$_eval = prevEval;
    }
  });

  test('distinguishes hash from context in 3rd argument', () => {
    // A plain hash object should NOT be treated as context
    const hash = { format: () => 'short', style: () => 'bold' };
    const prevEval = (globalThis as any).$_eval;
    try {
      (globalThis as any).$_eval = undefined;
      // With a plain hash (no $_eval or $args), should return string as-is
      const result = $_maybeHelper('binding', [], hash);
      expect(result).toBe('binding');
    } finally {
      (globalThis as any).$_eval = prevEval;
    }
  });

  test('2-arg form returns string when no eval anywhere', () => {
    const prevEval = (globalThis as any).$_eval;
    try {
      delete (globalThis as any).$_eval;
      const result = $_maybeHelper('myBinding', []);
      expect(result).toBe('myBinding');
    } finally {
      (globalThis as any).$_eval = prevEval;
    }
  });
});

describe('$_maybeHelper with scope resolution via context', () => {
  test('resolves dashed helper from scope via context (function-valued $_scope)', () => {
    const prevEval = (globalThis as any).$_eval;
    try {
      (globalThis as any).$_eval = undefined;
      const scope = {
        'x-borf': (value: string) => value,
      };
      // Simulate component with args.$_scope set to a getter function (old pattern)
      const ctx = {
        args: {
          $_scope: () => [scope],
        },
      };
      const result = $_maybeHelper('x-borf', ['YES'], ctx);
      expect(result).toBe('YES');
    } finally {
      (globalThis as any).$_eval = prevEval;
    }
  });

  test('resolves dashed helper from scope via context (direct scope object)', () => {
    const prevEval = (globalThis as any).$_eval;
    try {
      (globalThis as any).$_eval = undefined;
      const scope = {
        'x-borf': () => 'YES',
      };
      // Simulate component with args.$_scope set to direct scope object (new pattern)
      const ctx = {
        args: {
          $_scope: scope,
        },
      };
      const result = $_maybeHelper('x-borf', [], ctx);
      expect(result).toBe('YES');
    } finally {
      (globalThis as any).$_eval = prevEval;
    }
  });

  test('returns string when scope does not contain the helper', () => {
    const prevEval = (globalThis as any).$_eval;
    try {
      (globalThis as any).$_eval = undefined;
      const scope = {
        'other-helper': () => 'NO',
      };
      const ctx = {
        args: {
          $_scope: () => [scope],
        },
      };
      const result = $_maybeHelper('x-borf', [], ctx);
      expect(result).toBe('x-borf');
    } finally {
      (globalThis as any).$_eval = prevEval;
    }
  });

  test('scope non-function value is returned directly', () => {
    const prevEval = (globalThis as any).$_eval;
    try {
      (globalThis as any).$_eval = undefined;
      const scope = {
        'my-value': 42,
      };
      const ctx = {
        args: {
          $_scope: () => [scope],
        },
      };
      const result = $_maybeHelper('my-value', [], ctx);
      expect(result).toBe(42);
    } finally {
      (globalThis as any).$_eval = prevEval;
    }
  });

  test('context with no $_scope returns string as-is', () => {
    const prevEval = (globalThis as any).$_eval;
    try {
      (globalThis as any).$_eval = undefined;
      const ctx = {
        args: {},
      };
      const result = $_maybeHelper('x-borf', [], ctx);
      expect(result).toBe('x-borf');
    } finally {
      (globalThis as any).$_eval = prevEval;
    }
  });

  test('context with hash and named args resolves scope (4-arg form)', () => {
    const prevEval = (globalThis as any).$_eval;
    try {
      (globalThis as any).$_eval = undefined;
      const scope = {
        'my-helper': (...args: any[]) => args.join('-'),
      };
      const ctx = {
        args: {
          $_scope: () => [scope],
        },
      };
      const hash = { format: () => 'short' };
      const result = $_maybeHelper('my-helper', ['a', 'b'], hash, ctx);
      expect(result).toBe('a-b');
    } finally {
      (globalThis as any).$_eval = prevEval;
    }
  });
});

describe('$_GET_SCOPES', () => {
  // Import $_GET_SCOPES for direct testing
  test('returns scopes from hash getter (legacy pattern)', async () => {
    const { $_GET_SCOPES } = await import('./dom');
    const scope = { 'x-foo': () => 'bar' };
    const hash = {
      $_scope: () => [scope],
    };
    const result = $_GET_SCOPES(hash);
    expect(result).toEqual([scope]);
  });

  test('returns scopes from context with function-valued $_scope', async () => {
    const { $_GET_SCOPES } = await import('./dom');
    const scope = { 'x-foo': () => 'bar' };
    const ctx = {
      args: {
        $_scope: () => [scope],
      },
    };
    const result = $_GET_SCOPES({}, ctx);
    expect(result).toEqual([scope]);
  });

  test('returns scopes from context with direct scope object', async () => {
    const { $_GET_SCOPES } = await import('./dom');
    const scope = { 'x-foo': () => 'bar' };
    const ctx = {
      args: {
        $_scope: scope,
      },
    };
    const result = $_GET_SCOPES({}, ctx);
    expect(result).toEqual([scope]);
  });

  test('returns empty array when context has no $_scope', async () => {
    const { $_GET_SCOPES } = await import('./dom');
    const ctx = { args: {} };
    const result = $_GET_SCOPES({}, ctx);
    expect(result).toEqual([]);
  });

  test('returns empty array when hash has no $_scope', async () => {
    const { $_GET_SCOPES } = await import('./dom');
    const result = $_GET_SCOPES({});
    expect(result).toEqual([]);
  });
});
