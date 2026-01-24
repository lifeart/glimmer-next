/**
 * Reactive Reference - a Proxy-based wrapper for lazy value evaluation.
 *
 * This provides an alternative to the `unwrap()` function approach.
 * Instead of checking if a value is a function and calling it,
 * we wrap reactive values in a Proxy that auto-evaluates on access.
 */

import { isTag } from './-private';

// Symbol to identify Ref proxies
export const IS_REF = Symbol('IS_REF');

// Symbol to get the raw getter function
export const REF_GETTER = Symbol('REF_GETTER');

/**
 * Check if a value is a Ref proxy
 */
export function isRef(value: unknown): value is RefProxy {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as any)[IS_REF] === true
  );
}

/**
 * The type of a Ref proxy
 */
export interface RefProxy {
  readonly [IS_REF]: true;
  readonly [REF_GETTER]: () => unknown;
  readonly value: unknown;
  valueOf(): unknown;
  toString(): string;
  [Symbol.toPrimitive](hint: string): unknown;
}

/**
 * Create a reactive reference that lazily evaluates its value.
 *
 * @param getter - A function that returns the current value, or a static value
 * @returns A Proxy that auto-evaluates on property access
 *
 * @example
 * ```typescript
 * const r = ref(() => this.count);
 * console.log(r.value); // Evaluates getter, returns current count
 * if (r) { ... } // r is always truthy (it's an object)
 * ```
 */
export function ref(getter: (() => unknown) | unknown): RefProxy {
  // If already a Ref, return as-is
  if (isRef(getter)) {
    return getter;
  }

  // Normalize to a getter function
  const getterFn = typeof getter === 'function' ? getter : () => getter;

  // Helper to get the unwrapped value
  const getValue = (): unknown => {
    let value = getterFn();
    // Unwrap nested refs
    while (isRef(value)) {
      value = value.value;
    }
    // Unwrap Tags/Cells
    if (isTag(value)) {
      return value.value;
    }
    return value;
  };

  const proxy = new Proxy({} as RefProxy, {
    get(_target, prop) {
      // Identity check
      if (prop === IS_REF) {
        return true;
      }
      // Access to raw getter
      if (prop === REF_GETTER) {
        return getterFn;
      }
      // Get the actual value
      if (prop === 'value') {
        return getValue();
      }
      // Primitive coercion
      if (prop === 'valueOf') {
        return () => getValue();
      }
      if (prop === 'toString') {
        return () => String(getValue());
      }
      if (prop === Symbol.toPrimitive) {
        return (hint: string) => {
          const val = getValue();
          if (hint === 'string') {
            return String(val);
          }
          if (hint === 'number') {
            return Number(val);
          }
          return val;
        };
      }
      // Proxy property access to the underlying value
      const value = getValue();
      if (value !== null && typeof value === 'object') {
        return (value as any)[prop];
      }
      return undefined;
    },
    // Support `prop in ref` checks
    has(_target, prop) {
      if (prop === IS_REF || prop === REF_GETTER || prop === 'value') {
        return true;
      }
      const value = getValue();
      if (value !== null && typeof value === 'object') {
        return prop in value;
      }
      return false;
    },
  });

  return proxy;
}

/**
 * Unwrap a Ref or return the value as-is.
 * This is the recommended way to get a value that might be a Ref.
 *
 * IMPORTANT: Does NOT recurse to avoid calling user callback functions.
 */
export function deref(value: unknown): unknown {
  // Handle getter functions - only ONE level
  if (typeof value === 'function') {
    value = value();
  }
  // Handle Refs
  if (isRef(value)) {
    return value.value;
  }
  // Handle Tags/Cells
  if (isTag(value)) {
    return value.value;
  }
  return value;
}
