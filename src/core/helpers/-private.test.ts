import { describe, test, expect } from 'vitest';
import { isTag, isGetter, unwrap } from './-private';
import { cell } from '@/core/reactive';
import { createCallTracker, createRegularFunction } from '@/core/__test-utils__';

describe('isTag()', () => {
  test('returns true for cells', () => {
    const c = cell(42);
    expect(isTag(c)).toBe(true);
  });

  test('returns false for primitives', () => {
    expect(isTag(42)).toBe(false);
    expect(isTag('hello')).toBe(false);
    expect(isTag(true)).toBe(false);
    expect(isTag(null)).toBe(false);
    expect(isTag(undefined)).toBe(false);
  });

  test('returns false for plain objects', () => {
    expect(isTag({})).toBe(false);
    expect(isTag({ value: 42 })).toBe(false);
  });

  test('returns false for functions', () => {
    expect(isTag(() => 42)).toBe(false);
  });

  test('returns false for arrays', () => {
    expect(isTag([1, 2, 3])).toBe(false);
  });
});

describe('isGetter()', () => {
  describe('returns true for arrow functions (no prototype)', () => {
    test('simple arrow function', () => {
      const arrow = () => 42;
      expect(isGetter(arrow)).toBe(true);
    });

    test('arrow function with parameters', () => {
      const arrow = (x: number) => x * 2;
      expect(isGetter(arrow)).toBe(true);
    });

    test('async arrow function', () => {
      const asyncArrow = async () => 42;
      expect(isGetter(asyncArrow)).toBe(true);
    });
  });

  describe('returns false for functions with prototype', () => {
    test('regular function declaration', () => {
      function regularFn() { return 42; }
      expect(isGetter(regularFn)).toBe(false);
    });

    test('function expression', () => {
      const fnExpr = function() { return 42; };
      expect(isGetter(fnExpr)).toBe(false);
    });

    test('class constructor', () => {
      class MyClass {}
      expect(isGetter(MyClass)).toBe(false);
    });

    test('generator function', () => {
      function* generatorFn() { yield 42; }
      expect(isGetter(generatorFn)).toBe(false);
    });
  });

  describe('edge cases - functions without prototype', () => {
    test('async function declaration (no prototype)', () => {
      // Async function declarations have prototype = undefined
      async function asyncFn() { return 42; }
      // This is a known limitation - async function declarations
      // are detected as getters
      expect(isGetter(asyncFn)).toBe(true);
    });

    test('bound function (no prototype)', () => {
      function regularFn() { return 42; }
      const boundFn = regularFn.bind(null);
      // Bound functions lose their prototype
      // This is a known limitation - bound functions are detected as getters
      expect(isGetter(boundFn)).toBe(true);
    });

    test('regular function with prototype', () => {
      // Regular functions (with prototypes) should NOT be treated as getters
      const regularFn = createRegularFunction(() => 42);
      expect(isGetter(regularFn)).toBe(false);
    });
  });

  describe('returns false for non-functions', () => {
    test('primitives', () => {
      expect(isGetter(42)).toBe(false);
      expect(isGetter('hello')).toBe(false);
      expect(isGetter(true)).toBe(false);
      expect(isGetter(null)).toBe(false);
      expect(isGetter(undefined)).toBe(false);
    });

    test('objects', () => {
      expect(isGetter({})).toBe(false);
      expect(isGetter({ call: () => {} })).toBe(false);
    });

    test('arrays', () => {
      expect(isGetter([])).toBe(false);
    });

    test('cells', () => {
      const c = cell(42);
      expect(isGetter(c)).toBe(false);
    });
  });
});

describe('unwrap()', () => {
  describe('basic unwrapping', () => {
    test('returns primitives as-is', () => {
      expect(unwrap(42)).toBe(42);
      expect(unwrap('hello')).toBe('hello');
      expect(unwrap(true)).toBe(true);
      expect(unwrap(false)).toBe(false);
      expect(unwrap(null)).toBe(null);
      expect(unwrap(undefined)).toBe(undefined);
    });

    test('returns objects as-is', () => {
      const obj = { name: 'test' };
      expect(unwrap(obj)).toBe(obj);
    });

    test('returns arrays as-is', () => {
      const arr = [1, 2, 3];
      expect(unwrap(arr)).toBe(arr);
    });
  });

  describe('getter functions', () => {
    test('calls getter and returns result', () => {
      expect(unwrap(() => 42)).toBe(42);
      expect(unwrap(() => 'hello')).toBe('hello');
      expect(unwrap(() => true)).toBe(true);
      expect(unwrap(() => false)).toBe(false);
      expect(unwrap(() => null)).toBe(null);
    });

    test('calls getter only once', () => {
      // Use manual counter since vi.fn() creates functions with prototypes
      let callCount = 0;
      const getter = () => {
        callCount++;
        return 42;
      };
      unwrap(getter);
      expect(callCount).toBe(1);
    });

    test('does NOT call functions with prototypes (user callbacks)', () => {
      // Regular functions have prototypes and should NOT be called
      const { fn: regularFn, getCallCount } = createCallTracker(() => 42);
      // Wrap in a function expression to give it a prototype
      const fnWithPrototype = createRegularFunction(() => regularFn());
      const result = unwrap(fnWithPrototype);
      expect(getCallCount()).toBe(0);
      expect(result).toBe(fnWithPrototype); // Returns the function itself
    });

    test('returns object from getter', () => {
      const obj = { name: 'test' };
      expect(unwrap(() => obj)).toBe(obj);
    });
  });

  describe('Tags/Cells', () => {
    test('unwraps cell value', () => {
      const c = cell(42);
      expect(unwrap(c)).toBe(42);
    });

    test('unwraps cell with object value', () => {
      const obj = { name: 'test' };
      const c = cell(obj);
      expect(unwrap(c)).toBe(obj);
    });

    test('getter returning cell unwraps both', () => {
      const c = cell(42);
      expect(unwrap(() => c)).toBe(42);
    });
  });

  describe('NO recursive unwrapping (critical for user functions)', () => {
    test('does NOT call function returned by getter', () => {
      const { fn: userCallback, getCallCount } = createCallTracker(() => 'should not be called');
      // Give it a prototype so it's not treated as a getter
      const callbackWithPrototype = createRegularFunction(() => userCallback());
      const getter = () => callbackWithPrototype;

      const result = unwrap(getter);

      // Should return the callback function, NOT call it
      expect(result).toBe(callbackWithPrototype);
      expect(getCallCount()).toBe(0);
    });

    test('function values are truthy (not unwrapped further)', () => {
      const userFn = () => false;
      const getter = () => userFn;

      const result = unwrap(getter);

      // userFn is a function, which is truthy
      expect(result).toBe(userFn);
      expect(typeof result).toBe('function');
      expect(!!result).toBe(true); // truthy!
    });

    test('nested getters only unwrap one level', () => {
      // Create a regular function (with prototype) that tracks calls
      const { fn: innerFn, getCallCount } = createCallTracker(() => 42);
      const innerGetter = createRegularFunction(() => innerFn());
      const outerGetter = () => innerGetter;

      const result = unwrap(outerGetter);

      // Should return innerGetter, NOT call it
      expect(result).toBe(innerGetter);
      expect(getCallCount()).toBe(0);
    });

    test('real-world: onClick handler is not called', () => {
      // Simulates: <Button @onClick={{this.handleClick}} />
      // Compiled: onClick: () => this.handleClick
      const { fn: handleClick, getCallCount } = createCallTracker(() => {});
      const handleClickWithPrototype = createRegularFunction(() => handleClick());
      const compiledGetter = () => handleClickWithPrototype;

      const result = unwrap(compiledGetter);

      expect(result).toBe(handleClickWithPrototype);
      expect(getCallCount()).toBe(0);
    });

    test('real-world: callback in condition is not called', () => {
      // Simulates: {{if this.onSuccess "has callback" "no callback"}}
      // User wants to check if onSuccess EXISTS, not call it
      const { fn: onSuccess, getCallCount } = createCallTracker(() => 'side effect!');
      const onSuccessWithPrototype = createRegularFunction(() => onSuccess());
      const compiledGetter = () => onSuccessWithPrototype;

      const result = unwrap(compiledGetter);

      // onSuccess is truthy (it's a function)
      expect(!!result).toBe(true);
      expect(getCallCount()).toBe(0);
    });
  });

  describe('edge cases', () => {
    test('getter returning undefined', () => {
      expect(unwrap(() => undefined)).toBe(undefined);
    });

    test('getter returning null', () => {
      expect(unwrap(() => null)).toBe(null);
    });

    test('getter returning empty string', () => {
      expect(unwrap(() => '')).toBe('');
    });

    test('getter returning 0', () => {
      expect(unwrap(() => 0)).toBe(0);
    });

    test('getter returning NaN', () => {
      expect(Number.isNaN(unwrap(() => NaN))).toBe(true);
    });

    test('getter that throws propagates error', () => {
      const errorGetter = () => {
        throw new Error('test error');
      };
      expect(() => unwrap(errorGetter)).toThrow('test error');
    });

    test('handles Symbol values', () => {
      const sym = Symbol('test');
      expect(unwrap(sym)).toBe(sym);
      expect(unwrap(() => sym)).toBe(sym);
    });

    test('handles BigInt values', () => {
      const big = BigInt(9007199254740991);
      expect(unwrap(big)).toBe(big);
      expect(unwrap(() => big)).toBe(big);
    });
  });
});

describe('unwrap() with helpers integration', () => {
  // These tests simulate how helpers use unwrap()

  function simulateIf(condition: unknown, ifTrue: string, ifFalse: string) {
    return unwrap(condition) ? ifTrue : ifFalse;
  }

  test('if with true getter', () => {
    expect(simulateIf(() => true, 'yes', 'no')).toBe('yes');
  });

  test('if with false getter', () => {
    expect(simulateIf(() => false, 'yes', 'no')).toBe('no');
  });

  test('if with truthy value getter', () => {
    expect(simulateIf(() => 'truthy', 'yes', 'no')).toBe('yes');
    expect(simulateIf(() => 1, 'yes', 'no')).toBe('yes');
    expect(simulateIf(() => ({}), 'yes', 'no')).toBe('yes'); // Note: ({}) not {} - empty object vs undefined
  });

  test('if with falsy value getter', () => {
    expect(simulateIf(() => '', 'yes', 'no')).toBe('no');
    expect(simulateIf(() => 0, 'yes', 'no')).toBe('no');
    expect(simulateIf(() => null, 'yes', 'no')).toBe('no');
  });

  test('if with function value (function is truthy)', () => {
    const callback = () => false;
    // The callback function itself is truthy, even though it returns false
    expect(simulateIf(() => callback, 'yes', 'no')).toBe('yes');
  });

  test('if with cell', () => {
    const c = cell(true);
    expect(simulateIf(c, 'yes', 'no')).toBe('yes');

    c.update(false);
    expect(simulateIf(c, 'yes', 'no')).toBe('no');
  });

  test('if with getter returning cell', () => {
    const c = cell(true);
    expect(simulateIf(() => c, 'yes', 'no')).toBe('yes');

    c.update(false);
    expect(simulateIf(() => c, 'yes', 'no')).toBe('no');
  });
});
