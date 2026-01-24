/**
 * Shared test utilities for writing mock-free tests.
 *
 * These utilities help create real implementations for testing
 * without relying on mocking frameworks.
 */

import { cell, Cell } from '../reactive';

/**
 * Creates a function that tracks how many times it was called.
 * Use this instead of vi.fn() when you only need to verify call counts.
 *
 * @example
 * const { fn, getCallCount } = createCallTracker(() => 42);
 * fn();
 * expect(getCallCount()).toBe(1);
 */
export function createCallTracker<T, Args extends unknown[] = []>(
  implementation: (...args: Args) => T
) {
  let callCount = 0;
  let lastArgs: Args | undefined;
  let allCalls: Args[] = [];

  const tracked = (...args: Args): T => {
    callCount++;
    lastArgs = args;
    allCalls.push(args);
    return implementation(...args);
  };

  return {
    fn: tracked,
    getCallCount: () => callCount,
    getLastArgs: () => lastArgs,
    getAllCalls: () => allCalls,
    reset: () => {
      callCount = 0;
      lastArgs = undefined;
      allCalls = [];
    },
  };
}

/**
 * Creates a getter function that tracks accesses.
 * Useful for testing reactive getter unwrapping.
 *
 * @example
 * const { getter, getAccessCount } = createTrackedGetter(() => 'value');
 * const result = getter();
 * expect(result).toBe('value');
 * expect(getAccessCount()).toBe(1);
 */
export function createTrackedGetter<T>(getValue: () => T) {
  let accessCount = 0;

  // Arrow function (no prototype) to simulate compiler-generated getters
  const getter = () => {
    accessCount++;
    return getValue();
  };

  return {
    getter,
    getAccessCount: () => accessCount,
    reset: () => {
      accessCount = 0;
    },
  };
}

/**
 * Creates a test Cell with tracking capabilities.
 * Use this when you need a real reactive Cell but want to track updates.
 *
 * @example
 * const { testCell, getUpdateCount } = createTrackedCell(0);
 * testCell.update(1);
 * expect(getUpdateCount()).toBe(1);
 * expect(testCell.value).toBe(1);
 */
export function createTrackedCell<T>(initial: T) {
  let updateCount = 0;
  const originalCell = cell(initial);

  // Wrap the update method to track calls
  const originalUpdate = originalCell.update.bind(originalCell);
  originalCell.update = (value: T) => {
    updateCount++;
    originalUpdate(value);
  };

  return {
    testCell: originalCell as Cell<T>,
    getUpdateCount: () => updateCount,
    reset: () => {
      updateCount = 0;
    },
  };
}

/**
 * Creates a regular function (with prototype) for testing.
 * Unlike arrow functions, these should NOT be unwrapped by helpers.
 *
 * @example
 * const callback = createRegularFunction(() => 'result');
 * expect(callback.prototype).toBeDefined(); // Has prototype
 */
export function createRegularFunction<T>(implementation: () => T): () => T {
  // Use function expression to ensure it has a prototype
  const fn = function () {
    return implementation();
  };
  return fn;
}

/**
 * Creates a class-based callback for testing.
 * Classes always have prototypes and should not be called as getters.
 */
export function createClassCallback<T>(returnValue: T) {
  return class CallbackClass {
    static getValue() {
      return returnValue;
    }
  };
}

/**
 * Waits for a condition to be true, with timeout.
 * Useful for testing async reactive updates.
 *
 * @example
 * await waitFor(() => element.textContent === 'loaded');
 */
export async function waitFor(
  condition: () => boolean,
  timeout = 1000,
  interval = 10
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error('waitFor timeout exceeded');
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Creates a deferred promise for testing async scenarios.
 *
 * @example
 * const { promise, resolve } = createDeferred<string>();
 * // Later...
 * resolve('done');
 * await promise; // 'done'
 */
export function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Flushes microtask queue.
 * Useful for testing reactive updates that use queueMicrotask.
 */
export async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

/**
 * Flushes all pending timers and microtasks.
 */
export async function flushAll(): Promise<void> {
  await flushMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
