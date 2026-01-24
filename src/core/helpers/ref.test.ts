import { describe, test, expect } from 'vitest';
import { ref, isRef, deref, IS_REF, REF_GETTER } from './ref';
import { cell } from '@/core/reactive';

describe('ref() - Reactive Reference', () => {
  describe('creation', () => {
    test('creates a ref from a getter function', () => {
      const r = ref(() => 42);
      expect(isRef(r)).toBe(true);
      expect(r.value).toBe(42);
    });

    test('creates a ref from a static value', () => {
      const r = ref(42);
      expect(isRef(r)).toBe(true);
      expect(r.value).toBe(42);
    });

    test('returns same ref if already a ref', () => {
      const r1 = ref(() => 42);
      const r2 = ref(r1);
      expect(r1).toBe(r2);
    });
  });

  describe('value access', () => {
    test('evaluates getter on .value access', () => {
      let count = 0;
      const r = ref(() => ++count);
      expect(r.value).toBe(1);
      expect(r.value).toBe(2);
      expect(r.value).toBe(3);
    });

    test('unwraps nested refs', () => {
      const inner = ref(() => 'inner');
      const outer = ref(() => inner);
      expect(outer.value).toBe('inner');
    });

    test('unwraps Tags/Cells', () => {
      const c = cell(42);
      const r = ref(() => c);
      expect(r.value).toBe(42);

      c.update(100);
      expect(r.value).toBe(100);
    });
  });

  describe('identity', () => {
    test('has IS_REF symbol', () => {
      const r = ref(() => 42);
      expect(r[IS_REF]).toBe(true);
    });

    test('has REF_GETTER symbol', () => {
      const getter = () => 42;
      const r = ref(getter);
      expect(r[REF_GETTER]).toBe(getter);
    });
  });

  describe('primitive coercion', () => {
    test('valueOf returns unwrapped value', () => {
      const r = ref(() => 42);
      expect(r.valueOf()).toBe(42);
    });

    test('toString returns string representation', () => {
      const r = ref(() => 42);
      expect(r.toString()).toBe('42');
    });

    test('Symbol.toPrimitive with string hint', () => {
      const r = ref(() => 42);
      expect(String(r)).toBe('42');
    });

    test('Symbol.toPrimitive with number hint', () => {
      const r = ref(() => 42);
      expect(+r).toBe(42);
    });

    test('arithmetic operations work', () => {
      const r = ref(() => 10);
      // @ts-expect-error - testing runtime behavior
      expect(r + 5).toBe(15);
      // @ts-expect-error - testing runtime behavior
      expect(r * 2).toBe(20);
    });

    test('string concatenation works', () => {
      const r = ref(() => 'hello');
      expect(r + ' world').toBe('hello world');
    });
  });

  describe('property access', () => {
    test('proxies property access to underlying object', () => {
      const r = ref(() => ({ name: 'John', age: 30 })) as any;
      expect(r.name).toBe('John');
      expect(r.age).toBe(30);
    });

    test('handles nested property access', () => {
      const r = ref(() => ({ user: { name: 'John' } }));
      // @ts-expect-error - testing runtime behavior
      expect(r.user).toEqual({ name: 'John' });
    });

    test('returns undefined for non-object values', () => {
      const r = ref(() => 42);
      // @ts-expect-error - testing runtime behavior
      expect(r.nonexistent).toBe(undefined);
    });
  });

  describe('has trap', () => {
    test('IS_REF is in ref', () => {
      const r = ref(() => 42);
      expect(IS_REF in r).toBe(true);
    });

    test('value is in ref', () => {
      const r = ref(() => 42);
      expect('value' in r).toBe(true);
    });

    test('proxies has to underlying object', () => {
      const r = ref(() => ({ name: 'John' }));
      expect('name' in r).toBe(true);
      expect('age' in r).toBe(false);
    });
  });

  describe('boolean context', () => {
    // Note: Objects are always truthy in JS, so refs are always truthy
    // This is a limitation of the Proxy approach
    test('ref is always truthy (object)', () => {
      const rTrue = ref(() => true);
      const rFalse = ref(() => false);
      const rNull = ref(() => null);

      // These will all be truthy because they're objects
      expect(!!rTrue).toBe(true);
      expect(!!rFalse).toBe(true); // Limitation!
      expect(!!rNull).toBe(true); // Limitation!

      // To check truthiness, must use .value
      expect(!!rTrue.value).toBe(true);
      expect(!!rFalse.value).toBe(false);
      expect(!!rNull.value).toBe(false);
    });
  });
});

describe('isRef()', () => {
  test('returns true for refs', () => {
    expect(isRef(ref(() => 42))).toBe(true);
    expect(isRef(ref(42))).toBe(true);
  });

  test('returns false for non-refs', () => {
    expect(isRef(42)).toBe(false);
    expect(isRef('hello')).toBe(false);
    expect(isRef(null)).toBe(false);
    expect(isRef(undefined)).toBe(false);
    expect(isRef({})).toBe(false);
    expect(isRef(() => 42)).toBe(false);
  });
});

describe('deref()', () => {
  test('unwraps refs', () => {
    const r = ref(() => 42);
    expect(deref(r)).toBe(42);
  });

  test('unwraps Tags/Cells', () => {
    const c = cell(42);
    expect(deref(c)).toBe(42);
  });

  test('unwraps getter functions', () => {
    expect(deref(() => 42)).toBe(42);
  });

  test('returns primitives as-is', () => {
    expect(deref(42)).toBe(42);
    expect(deref('hello')).toBe('hello');
    expect(deref(null)).toBe(null);
    expect(deref(undefined)).toBe(undefined);
  });

  test('unwraps one level then handles Tags', () => {
    const c = cell(42);
    // deref(() => c) calls the getter, returns c, then unwraps the Tag
    expect(deref(() => c)).toBe(42);
  });
});

describe('comparison with unwrap()', () => {
  // These tests document the differences between ref/deref and unwrap

  test('deref calls functions (treats them as getters)', () => {
    // A function that should NOT be called (it's a value, not a getter)
    const myCallback = () => 'called!';

    // With deref, we call it (same as unwrap - this is the limitation)
    // deref cannot distinguish between a getter and a function value
    expect(deref(myCallback)).toBe('called!');
  });

  test('ref with function as static value calls it as getter', () => {
    const myCallback = () => 'called!';
    // ref(fn) treats fn as a getter, so it will be called
    const r = ref(myCallback);
    expect(r.value).toBe('called!');
  });

  test('ref preserves function identity when used as static value', () => {
    const myFn = () => 'I am a function';
    const r = ref(myFn); // myFn becomes the getter, NOT the value!

    // This is a gotcha - ref(fn) treats fn as getter
    // To store a function as a value, wrap it: ref(() => myFn)
    expect(r.value).toBe('I am a function'); // Called myFn

    // Correct way to store function as value:
    const r2 = ref(() => myFn);
    expect(r2.value).toBe(myFn); // myFn itself, not called
  });
});

describe('usage in helpers (simulation)', () => {
  // Simulate how helpers would use ref/deref

  function $__if_with_deref(condition: unknown, ifTrue: unknown, ifFalse: unknown = '') {
    return deref(condition) ? ifTrue : ifFalse;
  }

  function $__if_with_ref(condition: unknown, ifTrue: unknown, ifFalse: unknown = '') {
    // If condition is a ref, get its value; otherwise use as-is
    const cond = isRef(condition) ? condition.value : condition;
    return cond ? ifTrue : ifFalse;
  }

  test('$__if with deref handles getters', () => {
    expect($__if_with_deref(() => true, 'yes', 'no')).toBe('yes');
    expect($__if_with_deref(() => false, 'yes', 'no')).toBe('no');
  });

  test('$__if with ref handles refs', () => {
    expect($__if_with_ref(ref(() => true), 'yes', 'no')).toBe('yes');
    expect($__if_with_ref(ref(() => false), 'yes', 'no')).toBe('no');
  });

  test('$__if with ref handles non-refs', () => {
    expect($__if_with_ref(true, 'yes', 'no')).toBe('yes');
    expect($__if_with_ref(false, 'yes', 'no')).toBe('no');
  });

  test('$__if with deref has the function-as-value problem', () => {
    // If we pass a function as a VALUE (not getter), deref calls it
    const alwaysTrue = () => true;
    // We want to check if alwaysTrue is truthy (it is - it's a function)
    // But deref calls it, so we get true anyway (lucky coincidence here)
    expect($__if_with_deref(alwaysTrue, 'yes', 'no')).toBe('yes');

    // The problem shows with functions that return falsy:
    const returnsFalse = () => false;
    // We want: is returnsFalse truthy? Yes, it's a function
    // But deref: calls returnsFalse() -> false
    expect($__if_with_deref(returnsFalse, 'yes', 'no')).toBe('no'); // Wrong!
  });
});
