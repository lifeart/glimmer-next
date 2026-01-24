import { describe, test, expect } from 'vitest';
import { $__if } from './if';
import { $__eq } from './eq';
import { $__and } from './and';
import { $__or } from './or';
import { $__not } from './not';
import { $__fn } from './fn';
import { Cell, cell } from '../reactive';

describe('$__if helper', () => {
  test('returns ifTrue when condition is true', () => {
    expect($__if(true, 'yes', 'no')).toBe('yes');
  });

  test('returns ifFalse when condition is false', () => {
    expect($__if(false, 'yes', 'no')).toBe('no');
  });

  test('returns empty string as default ifFalse', () => {
    expect($__if(false, 'yes')).toBe('');
  });

  test('handles getter function as condition', () => {
    expect($__if(() => true, 'yes', 'no')).toBe('yes');
    expect($__if(() => false, 'yes', 'no')).toBe('no');
  });

  test('does NOT recursively unwrap nested getters (to avoid calling user functions)', () => {
    // Nested getters return the inner function, which is truthy
    // This is intentional - we don't want to call user callback functions
    const innerGetter = () => false;
    expect($__if(() => innerGetter, 'yes', 'no')).toBe('yes'); // innerGetter is truthy (it's a function)
  });

  test('function-as-value: callback existence check works correctly', () => {
    // Real-world: {{if this.onClick "clickable" "not clickable"}}
    // We want to check if onClick EXISTS, not what it returns
    const onClick = () => { /* handler */ };
    expect($__if(() => onClick, 'clickable', 'not clickable')).toBe('clickable');
    expect($__if(() => undefined, 'clickable', 'not clickable')).toBe('not clickable');
  });

  test('function-as-value: does not call user callbacks', () => {
    let called = false;
    const userCallback = () => { called = true; return false; };

    // This should NOT call userCallback
    $__if(() => userCallback, 'yes', 'no');

    expect(called).toBe(false);
  });

  test('handles truthy/falsy values', () => {
    expect($__if(1, 'yes', 'no')).toBe('yes');
    expect($__if(0, 'yes', 'no')).toBe('no');
    expect($__if('hello', 'yes', 'no')).toBe('yes');
    expect($__if('', 'yes', 'no')).toBe('no');
    expect($__if(null, 'yes', 'no')).toBe('no');
    expect($__if(undefined, 'yes', 'no')).toBe('no');
  });

  test('handles getter returning truthy/falsy values', () => {
    expect($__if(() => 1, 'yes', 'no')).toBe('yes');
    expect($__if(() => 0, 'yes', 'no')).toBe('no');
    expect($__if(() => null, 'yes', 'no')).toBe('no');
  });
});

describe('$__eq helper', () => {
  test('returns true for equal values', () => {
    expect($__eq(1, 1)).toBe(true);
    expect($__eq('a', 'a')).toBe(true);
  });

  test('returns false for unequal values', () => {
    expect($__eq(1, 2)).toBe(false);
    expect($__eq('a', 'b')).toBe(false);
  });

  test('handles getter functions', () => {
    expect($__eq(() => 1, 1)).toBe(true);
    expect($__eq(1, () => 1)).toBe(true);
    expect($__eq(() => 1, () => 1)).toBe(true);
    expect($__eq(() => 1, () => 2)).toBe(false);
  });

  test('compares multiple values', () => {
    expect($__eq(1, 1, 1)).toBe(true);
    expect($__eq(1, 1, 2)).toBe(false);
    expect($__eq(() => 'a', 'a', () => 'a')).toBe(true);
  });

  test('function-as-value: compares function identity', () => {
    const fn1 = () => {};
    const fn2 = () => {};
    // Same function reference
    expect($__eq(() => fn1, () => fn1)).toBe(true);
    // Different function references
    expect($__eq(() => fn1, () => fn2)).toBe(false);
  });

  test('function-as-value: does not call user callbacks', () => {
    let called = false;
    const userCallback = () => { called = true; };

    $__eq(() => userCallback, () => userCallback);

    expect(called).toBe(false);
  });
});

describe('$__and helper', () => {
  test('returns true when all values are truthy', () => {
    expect($__and(true, true)).toBe(true);
    expect($__and(1, 'a', true)).toBe(true);
  });

  test('returns false when any value is falsy', () => {
    expect($__and(true, false)).toBe(false);
    expect($__and(1, 0, true)).toBe(false);
  });

  test('handles getter functions', () => {
    expect($__and(() => true, () => true)).toBe(true);
    expect($__and(() => true, () => false)).toBe(false);
    expect($__and(() => 1, () => 'a')).toBe(true);
  });

  test('does NOT recursively unwrap (functions are truthy)', () => {
    // Inner function is truthy, so and() returns true
    const innerFn = () => false;
    expect($__and(() => innerFn, true)).toBe(true); // innerFn is truthy
  });

  test('function-as-value: functions are truthy', () => {
    const fn = () => {};
    expect($__and(() => fn, true)).toBe(true);
    expect($__and(() => fn, () => fn)).toBe(true);
  });

  test('function-as-value: does not call user callbacks', () => {
    let called = false;
    const userCallback = () => { called = true; return false; };

    $__and(() => userCallback, true);

    expect(called).toBe(false);
  });
});

describe('$__or helper', () => {
  test('returns first truthy value', () => {
    expect($__or(false, 'a', 'b')).toBe('a');
    expect($__or(0, null, 'found')).toBe('found');
  });

  test('returns last value if all falsy', () => {
    expect($__or(false, 0, null)).toBe(null);
    expect($__or(false, '')).toBe('');
  });

  test('handles getter functions', () => {
    expect($__or(() => false, () => 'a')).toBe('a');
    expect($__or(() => 'first', () => 'second')).toBe('first');
  });

  test('returns undefined for empty args', () => {
    expect($__or()).toBe(undefined);
  });

  test('function-as-value: returns function (truthy)', () => {
    const fn = () => false;
    // fn is truthy (it's a function), so or() returns it
    expect($__or(() => fn, 'fallback')).toBe(fn);
  });

  test('function-as-value: does not call user callbacks', () => {
    let called = false;
    const userCallback = () => { called = true; };

    $__or(() => userCallback, 'fallback');

    expect(called).toBe(false);
  });
});

describe('$__not helper', () => {
  test('negates truthy values', () => {
    expect($__not(true)).toBe(false);
    expect($__not(1)).toBe(false);
    expect($__not('a')).toBe(false);
  });

  test('negates falsy values', () => {
    expect($__not(false)).toBe(true);
    expect($__not(0)).toBe(true);
    expect($__not('')).toBe(true);
    expect($__not(null)).toBe(true);
  });

  test('handles getter functions', () => {
    expect($__not(() => true)).toBe(false);
    expect($__not(() => false)).toBe(true);
    expect($__not(() => 1)).toBe(false);
    expect($__not(() => 0)).toBe(true);
  });

  test('does NOT recursively unwrap (functions are truthy)', () => {
    // Inner function is truthy, so not() returns false
    const innerFn = () => true;
    expect($__not(() => innerFn)).toBe(false); // innerFn is truthy, !truthy = false
  });

  test('function-as-value: functions are truthy so not() returns false', () => {
    const fn = () => {};
    expect($__not(() => fn)).toBe(false); // fn is truthy
  });

  test('function-as-value: does not call user callbacks', () => {
    let called = false;
    const userCallback = () => { called = true; };

    $__not(() => userCallback);

    expect(called).toBe(false);
  });
});

describe('$__fn helper', () => {
  test('curries function with bound arguments', () => {
    const add = (a: number, b: number) => a + b;
    const addFive = $__fn(add, 5);
    expect(addFive(3)).toBe(8);
  });

  test('allows additional tail arguments', () => {
    const concat = (a: string, b: string, c: string) => a + b + c;
    const partial = $__fn(concat, 'hello', '-');
    expect(partial('world')).toBe('hello-world');
  });

  test('unwraps getter functions (arrow functions without prototype)', () => {
    let value = 10;
    const getValue = () => value;
    const multiply = (a: number, b: number) => a * b;

    const curriedMultiply = $__fn(multiply, getValue);
    expect(curriedMultiply(2)).toBe(20);

    // Getter is called at invocation time, not bind time
    value = 20;
    expect(curriedMultiply(2)).toBe(40);
  });

  test('preserves Cell references (does NOT unwrap Cells)', () => {
    const myCell = cell(42);
    let receivedArg: unknown = null;

    const captureArg = (arg: unknown) => {
      receivedArg = arg;
    };

    const curriedCapture = $__fn(captureArg, myCell);
    curriedCapture();

    // Cell should be passed as-is, not unwrapped to its value
    expect(receivedArg).toBe(myCell);
    expect(receivedArg).toBeInstanceOf(Cell);
  });

  test('callbacks can call .update() on preserved Cells', () => {
    const myCell = cell(0);

    const updateCell = (c: Cell<number>, newValue: number) => {
      c.update(newValue);
    };

    const curriedUpdate = $__fn(updateCell, myCell);

    // This simulates what happens in UI callbacks like {{fn this.updateCell this.myCell}}
    curriedUpdate(100);

    expect(myCell.value).toBe(100);
  });

  test('distinguishes between getter functions and regular functions with prototype', () => {
    // Regular function (has prototype) should NOT be called
    function RegularFn() {
      return 'called';
    }
    let regularFnCalled = false;
    const originalRegularFn = RegularFn;
    const wrappedRegularFn = function() {
      regularFnCalled = true;
      return originalRegularFn();
    };
    // Copy prototype to mimic regular function
    wrappedRegularFn.prototype = RegularFn.prototype;

    const capture = (arg: unknown) => arg;
    const curried = $__fn(capture, wrappedRegularFn);
    const result = curried();

    // Regular function with prototype should be passed through, not called
    expect(result).toBe(wrappedRegularFn);
    expect(regularFnCalled).toBe(false);
  });

  test('does not unwrap class constructors', () => {
    class MyClass {
      value = 42;
    }

    let receivedArg: unknown = null;
    const captureArg = (arg: unknown) => {
      receivedArg = arg;
    };

    const curried = $__fn(captureArg, MyClass);
    curried();

    // Class constructor should be passed as-is
    expect(receivedArg).toBe(MyClass);
  });

  test('handles mixed arguments: getters, Cells, and primitives', () => {
    let getterValue = 'getter';
    const getter = () => getterValue;
    const myCell = cell('cell');
    const primitive = 'primitive';

    const results: unknown[] = [];
    const collectArgs = (...args: unknown[]) => {
      results.push(...args);
    };

    const curried = $__fn(collectArgs, getter, myCell, primitive);
    curried('tail');

    expect(results).toEqual(['getter', myCell, 'primitive', 'tail']);
    expect(results[1]).toBeInstanceOf(Cell);
  });

  describe('edge cases with function types', () => {
    test('generator functions are NOT called (have prototype)', () => {
      function* generatorFn() {
        yield 1;
        yield 2;
      }

      let receivedArg: unknown = null;
      const captureArg = (arg: unknown) => {
        receivedArg = arg;
      };

      const curried = $__fn(captureArg, generatorFn);
      curried();

      // Generator functions have prototype, should be passed through
      expect(receivedArg).toBe(generatorFn);
    });

    test('compat mode: async callback through getter is preserved', () => {
      // In compat mode, compiler wraps args in getters: () => this.asyncCallback
      async function asyncCallback() {
        return 'async result';
      }

      // Simulates compat mode compiled code: $__fn(handler, () => this.asyncCallback)
      const getter = () => asyncCallback;
      let receivedArg: unknown = null;
      const handler = (arg: unknown) => {
        receivedArg = arg;
      };

      const curried = $__fn(handler, getter);
      curried();

      // The getter is called, returning asyncCallback which is passed through
      expect(receivedArg).toBe(asyncCallback);
    });

    test('compat mode: bound function through getter is preserved', () => {
      // In compat mode, compiler wraps args in getters
      function regularFn(this: { value: number }) {
        return this.value;
      }
      const context = { value: 42 };
      const boundFn = regularFn.bind(context);

      // Simulates compat mode: $__fn(handler, () => this.boundMethod)
      const getter = () => boundFn;
      let receivedArg: unknown = null;
      const handler = (arg: unknown) => {
        receivedArg = arg;
      };

      const curried = $__fn(handler, getter);
      curried();

      // The getter is called, returning boundFn which is passed through
      expect(receivedArg).toBe(boundFn);
      // And the bound function still works
      expect((receivedArg as () => number)()).toBe(42);
    });

    test('non-compat mode simulation: async function declaration passed directly', () => {
      // WARNING: This documents a known limitation in non-compat mode
      // In non-compat mode, async function declarations are incorrectly called
      // because they have no prototype
      async function asyncFn() {
        return 'async result';
      }

      let receivedArg: unknown = null;
      const captureArg = (arg: unknown) => {
        receivedArg = arg;
      };

      // In non-compat mode, no getter wrapping: $__fn(handler, asyncFn)
      const curried = $__fn(captureArg, asyncFn);
      curried();

      // Limitation: async function is CALLED because it has no prototype
      // This returns a Promise, not the function itself
      expect(receivedArg).toBeInstanceOf(Promise);
    });

    test('non-compat mode simulation: bound function passed directly', () => {
      // WARNING: This documents a known limitation in non-compat mode
      // In non-compat mode, bound functions are incorrectly called
      function regularFn() {
        return 'called';
      }
      const boundFn = regularFn.bind(null);

      let receivedArg: unknown = null;
      const captureArg = (arg: unknown) => {
        receivedArg = arg;
      };

      // In non-compat mode, no getter wrapping: $__fn(handler, boundFn)
      const curried = $__fn(captureArg, boundFn);
      curried();

      // Limitation: bound function is CALLED because it has no prototype
      expect(receivedArg).toBe('called');
    });
  });

  describe('compat mode patterns (how compiler generates code)', () => {
    test('reactive value through getter', () => {
      // Simulates: {{fn this.handler this.value}}
      // Compiled: $__fn(this.handler, () => this.value)
      let reactiveValue = 'initial';
      const getter = () => reactiveValue;

      const results: unknown[] = [];
      const handler = (val: unknown) => results.push(val);

      const curried = $__fn(handler, getter);

      curried();
      expect(results[0]).toBe('initial');

      // Value changes
      reactiveValue = 'updated';
      curried();
      expect(results[1]).toBe('updated');
    });

    test('Cell through getter (for updateable callbacks)', () => {
      // Simulates: {{fn this.updateValue this.valueCell}}
      // Compiled: $__fn(this.updateValue, () => this.valueCell)
      const valueCell = cell(0);
      const getter = () => valueCell;

      const updateValue = (c: Cell<number>, newVal: number) => {
        c.update(newVal);
      };

      const curried = $__fn(updateValue, getter);

      curried(100);
      expect(valueCell.value).toBe(100);

      curried(200);
      expect(valueCell.value).toBe(200);
    });

    test('callback through getter (event handlers)', () => {
      // Simulates: {{fn this.wrapper @onClick}}
      // Compiled: $__fn(this.wrapper, () => this.args.onClick)
      let clicked = false;
      const onClick = () => { clicked = true; };
      const getter = () => onClick;

      let wrappedCallback: Function | null = null;
      const wrapper = (cb: Function) => {
        wrappedCallback = cb;
      };

      const curried = $__fn(wrapper, getter);
      curried();

      // Callback should be passed through, not called
      expect(clicked).toBe(false);
      expect(wrappedCallback).toBe(onClick);

      // Now we can call it
      wrappedCallback!();
      expect(clicked).toBe(true);
    });
  });
});
