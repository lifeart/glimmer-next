/**
 * Shared test utilities for writing mock-free tests.
 *
 * These utilities help create real implementations for testing
 * without relying on mocking frameworks.
 */

import { Window } from 'happy-dom';
import { cell, Cell } from '../reactive';
import { HTMLBrowserDOMApi, type DOMApi } from '../dom-api';
import { Root } from '../dom';
import { cleanupFastContext, provideContext, RENDERING_CONTEXT } from '../context';
import { TREE, PARENT, CHILD } from '../shared';

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

export interface DOMFixture {
  window: Window;
  document: Document;
  api: DOMApi;
  root: Root;
  container: HTMLElement;
  cleanup: () => void;
}

/**
 * Creates a complete DOM fixture for tests that need happy-dom.
 * Replaces the duplicated beforeEach/afterEach pattern across test files.
 *
 * @param customApi - Optional custom DOMApi to use instead of HTMLBrowserDOMApi
 *
 * @example
 * let fixture: DOMFixture;
 * beforeEach(() => { fixture = createDOMFixture(); });
 * afterEach(() => { fixture.cleanup(); });
 */
export function createDOMFixture(customApi?: DOMApi): DOMFixture {
  const window = new Window();
  const document = window.document as unknown as Document;
  const api = customApi ?? new HTMLBrowserDOMApi(document);
  cleanupFastContext();
  const root = new Root(document);
  provideContext(root, RENDERING_CONTEXT, api);
  const container = document.createElement('div');
  document.body.appendChild(container);

  return {
    window,
    document,
    api,
    root,
    container,
    cleanup() {
      cleanupFastContext();
      TREE.clear();
      PARENT.clear();
      CHILD.clear();
      window.close();
    },
  };
}

/**
 * Creates a test suspense context that tracks start/end calls.
 * Use this instead of vi.fn() for suspense protocol tests.
 *
 * @example
 * const { ctx, getStartCount, getEndCount } = createTestSuspenseContext();
 * provideContext(component, SUSPENSE_CONTEXT, ctx);
 * // ... trigger followPromise ...
 * expect(getStartCount()).toBe(1);
 */
export function createTestSuspenseContext() {
  let startCount = 0;
  let endCount = 0;

  return {
    ctx: {
      start() { startCount++; },
      end() { endCount++; },
    },
    getStartCount: () => startCount,
    getEndCount: () => endCount,
    reset() {
      startCount = 0;
      endCount = 0;
    },
  };
}
