import { expect, test, describe, beforeEach, afterEach, vi } from 'vitest';
import { SUSPENSE_CONTEXT, followPromise } from './suspense-utils';
import { lazy, Suspense, type SuspenseContext } from './suspense';
import { Component } from './component';
import {
  provideContext,
  getContext,
} from './context';
import { HTMLBrowserDOMApi } from './dom-api';
import {
  RENDERED_NODES_PROPERTY,
  addToTree,
} from './shared';
import {
  createDOMFixture,
  createTestSuspenseContext,
  type DOMFixture,
} from './__test-utils__';

describe('Suspense API exports', () => {
  describe('SUSPENSE_CONTEXT', () => {
    test('SUSPENSE_CONTEXT is a symbol', () => {
      expect(typeof SUSPENSE_CONTEXT).toBe('symbol');
      expect(SUSPENSE_CONTEXT.description).toBe('suspense');
    });
  });

  describe('followPromise', () => {
    let fixture: DOMFixture;

    beforeEach(() => { fixture = createDOMFixture(); });
    afterEach(() => { fixture.cleanup(); });

    test('followPromise returns a promise that resolves to the same value', async () => {
      const child = new Component({});
      child[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, child);

      const promise = Promise.resolve('test');
      const result = followPromise(child, promise);

      // Returns the .finally() chain, not the same promise object,
      // but resolves to the same value
      expect(result).not.toBe(promise);
      expect(await result).toBe('test');
    });

    test('followPromise handles missing suspense context gracefully', () => {
      // Component without suspense context
      const child = new Component({});
      child[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, child);

      const promise = Promise.resolve('test');
      // Should not throw
      expect(() => followPromise(child, promise)).not.toThrow();
    });

    test('followPromise calls start/end on suspense context', async () => {
      const child = new Component({});
      child[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, child);

      const { ctx: testSuspense, getStartCount, getEndCount } = createTestSuspenseContext();
      provideContext(child, SUSPENSE_CONTEXT, testSuspense);

      const promise = Promise.resolve('test');
      followPromise(child, promise);

      expect(getStartCount()).toBe(1);

      await promise;
      // Wait for microtask (Promise.resolve().then in followPromise)
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(getEndCount()).toBe(1);
    });

    test('followPromise calls end even on rejection', async () => {
      const child = new Component({});
      child[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, child);

      const { ctx: testSuspense, getStartCount, getEndCount } = createTestSuspenseContext();
      provideContext(child, SUSPENSE_CONTEXT, testSuspense);

      // Create a deferred rejection
      let rejectFn: (error: Error) => void;
      const promise = new Promise<never>((_, reject) => {
        rejectFn = reject;
      });

      // followPromise now returns the .finally() chain
      const tracked = followPromise(child, promise);
      expect(getStartCount()).toBe(1);

      // Reject the promise
      rejectFn!(new Error('test error'));

      // Await the tracked promise, catching the rejection
      // end() is guaranteed to have been called when this resolves
      await tracked.catch(() => {});

      expect(getEndCount()).toBe(1);
    });

    test('nested components find correct suspense context', () => {
      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, parent);

      const child = new Component({});
      child[RENDERED_NODES_PROPERTY] = [];
      addToTree(parent, child);

      const grandchild = new Component({});
      grandchild[RENDERED_NODES_PROPERTY] = [];
      addToTree(child, grandchild);

      // Provide context at parent level
      const { ctx: testSuspense } = createTestSuspenseContext();
      provideContext(parent, SUSPENSE_CONTEXT, testSuspense);

      // Grandchild should find it
      const foundContext = getContext(grandchild, SUSPENSE_CONTEXT);
      expect(foundContext).toBe(testSuspense);
    });

    test('inner suspense context shadows outer', () => {
      const outer = new Component({});
      outer[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, outer);

      const inner = new Component({});
      inner[RENDERED_NODES_PROPERTY] = [];
      addToTree(outer, inner);

      const child = new Component({});
      child[RENDERED_NODES_PROPERTY] = [];
      addToTree(inner, child);

      const { ctx: outerSuspense } = createTestSuspenseContext();
      const { ctx: innerSuspense } = createTestSuspenseContext();

      provideContext(outer, SUSPENSE_CONTEXT, outerSuspense);
      provideContext(inner, SUSPENSE_CONTEXT, innerSuspense);

      // Child should find inner suspense
      const foundContext = getContext(child, SUSPENSE_CONTEXT);
      expect(foundContext).toBe(innerSuspense);
    });
  });
});

describe('Suspense context protocol', () => {
  let fixture: DOMFixture;

  beforeEach(() => { fixture = createDOMFixture(); });
  afterEach(() => { fixture.cleanup(); });

  test('suspense context follows start/end protocol for tracking', async () => {
    const child = new Component({});
    child[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, child);

    let pendingCount = 0;
    const testSuspense = {
      start() { pendingCount++; },
      end() { pendingCount--; },
    };
    provideContext(child, SUSPENSE_CONTEXT, testSuspense);

    // Use controlled promises for deterministic behavior
    let resolve1!: () => void;
    let resolve2!: () => void;
    const promise1 = new Promise<void>((r) => {
      resolve1 = r;
    });
    const promise2 = new Promise<void>((r) => {
      resolve2 = r;
    });

    // followPromise returns the .finally() chain, so awaiting it
    // guarantees end() has been called
    const tracked1 = followPromise(child, promise1);
    const tracked2 = followPromise(child, promise2);

    expect(pendingCount).toBe(2);

    // Resolve and await - end() is guaranteed to have run
    resolve1();
    await tracked1;
    expect(pendingCount).toBe(1);

    resolve2();
    await tracked2;
    expect(pendingCount).toBe(0);
  });

  test('followPromise works with async/await pattern', async () => {
    const child = new Component({});
    child[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, child);

    const { ctx: testSuspense, getStartCount, getEndCount } = createTestSuspenseContext();
    provideContext(child, SUSPENSE_CONTEXT, testSuspense);

    // Simulate typical lazy loading pattern
    const loadData = async () => {
      const data = await followPromise(
        child,
        Promise.resolve({ name: 'test' }),
      );
      return data;
    };

    const result = await loadData();
    expect(result).toEqual({ name: 'test' });

    // Wait for cleanup
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getStartCount()).toBe(1);
    expect(getEndCount()).toBe(1);
  });
});

describe('lazy() error handling', () => {
  let fixture: DOMFixture;

  beforeEach(() => { fixture = createDOMFixture(); });
  afterEach(() => { fixture.cleanup(); });

  type LazyStateValue = {
    loading: boolean;
    error: Error | null;
    component: unknown;
  };

  type LazyComponentInstance = Component & {
    stateCell: { value: LazyStateValue };
  };

  test('lazy() catches factory errors and stores them in state', async () => {
    const factoryError = new Error('Factory failed to load module');
    const LazyComponent = lazy(() => Promise.reject(factoryError));

    // Create an instance of the lazy component
    const instance = new (LazyComponent as unknown as new (
      params: Record<string, unknown>,
    ) => LazyComponentInstance)({});
    instance[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, instance);

    // Wait for the factory promise to reject
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Error should be stored in state
    expect(instance.stateCell.value.error).toBe(factoryError);
    expect(instance.stateCell.value.loading).toBe(false);
    expect(instance.stateCell.value.component).toBe(null);
  });

  test('lazy() handles synchronous factory errors', async () => {
    const factoryError = new Error('Synchronous factory error');
    const LazyComponent = lazy(() => {
      throw factoryError;
    });

    const instance = new (LazyComponent as unknown as new (
      params: Record<string, unknown>,
    ) => LazyComponentInstance)({});
    instance[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, instance);

    // Wait for error to be caught
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(instance.stateCell.value.error).toBe(factoryError);
    expect(instance.stateCell.value.loading).toBe(false);
  });

  test('lazy() successfully loads component when factory succeeds', async () => {
    const MockComponent = class extends Component {};
    const LazyComponent = lazy(() =>
      Promise.resolve({ default: MockComponent }),
    );

    const instance = new (LazyComponent as unknown as new (
      params: Record<string, unknown>,
    ) => LazyComponentInstance)({});
    instance[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, instance);

    // Wait for the factory promise to resolve
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(instance.stateCell.value.error).toBe(null);
    expect(instance.stateCell.value.loading).toBe(false);
    expect(instance.stateCell.value.component).toBe(MockComponent);
  });
});

describe('Suspense.end() safety guard', () => {
  let fixture: DOMFixture;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let consoleWarnSpy: any;

  // Cast Suspense to accept args (it uses ...arguments pattern internally)
  const SuspenseWithArgs = Suspense as unknown as new (
    args: Record<string, unknown>,
  ) => Suspense & SuspenseContext;

  beforeEach(() => {
    fixture = createDOMFixture();
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    fixture.cleanup();
    consoleWarnSpy.mockRestore();
  });

  test('Suspense.start() increments pendingAmount', () => {
    const suspense = new SuspenseWithArgs({});
    suspense[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, suspense);

    expect(suspense.pendingAmount).toBe(0);

    suspense.start();
    expect(suspense.pendingAmount).toBe(1);

    suspense.start();
    expect(suspense.pendingAmount).toBe(2);
  });

  test('Suspense.end() decrements pendingAmount', () => {
    const suspense = new SuspenseWithArgs({});
    suspense[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, suspense);

    suspense.start();
    suspense.start();
    expect(suspense.pendingAmount).toBe(2);

    suspense.end();
    expect(suspense.pendingAmount).toBe(1);

    suspense.end();
    expect(suspense.pendingAmount).toBe(0);
  });

  test('Suspense.end() does not go below zero', () => {
    const suspense = new SuspenseWithArgs({});
    suspense[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, suspense);

    expect(suspense.pendingAmount).toBe(0);

    // Calling end() without start() should not go negative
    suspense.end();
    expect(suspense.pendingAmount).toBe(0);

    // Multiple calls should still not go negative
    suspense.end();
    suspense.end();
    expect(suspense.pendingAmount).toBe(0);
  });

  test('Suspense.end() does not warn when IS_DEV_MODE is false', () => {
    const suspense = new SuspenseWithArgs({});
    suspense[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, suspense);

    // Call end without start
    suspense.end();

    // IS_DEV_MODE is false in test mode, so no warning should be emitted
    // The guard still prevents going negative, but silently
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(suspense.pendingAmount).toBe(0);
  });

  test('Suspense sets isReleased when pendingAmount reaches zero', () => {
    const suspense = new SuspenseWithArgs({});
    suspense[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, suspense);

    expect(suspense.isReleased).toBe(false);

    suspense.start();
    suspense.start();
    expect(suspense.isReleased).toBe(false);

    suspense.end();
    expect(suspense.isReleased).toBe(false);

    suspense.end();
    expect(suspense.isReleased).toBe(true);
  });

  test('Suspense ignores start/end after being released', () => {
    const suspense = new SuspenseWithArgs({});
    suspense[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, suspense);

    suspense.start();
    suspense.end();
    expect(suspense.isReleased).toBe(true);

    // After release, start/end should be ignored
    suspense.start();
    expect(suspense.pendingAmount).toBe(0);

    suspense.end();
    expect(suspense.pendingAmount).toBe(0);
  });

  test('Suspense ignores start/end calls after release without warnings in production', () => {
    const suspense = new SuspenseWithArgs({});
    suspense[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, suspense);

    suspense.start();
    suspense.end();
    expect(suspense.isReleased).toBe(true);

    consoleWarnSpy.mockClear();

    // Calling start after release should be ignored (no warning in production)
    suspense.start();
    expect(suspense.pendingAmount).toBe(0);
    // IS_DEV_MODE is false in test mode, so no warning
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    // Calling end after release should also be ignored
    suspense.end();
    expect(suspense.pendingAmount).toBe(0);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  test('isReleasedCell is reactive and can be tracked', () => {
    const suspense = new SuspenseWithArgs({});
    suspense[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, suspense);

    // isReleasedCell should be a Cell
    expect(suspense.isReleasedCell).toBeDefined();
    expect(suspense.isReleasedCell.value).toBe(false);

    // isReleased getter should read from the cell
    expect(suspense.isReleased).toBe(false);

    suspense.start();
    suspense.end();

    // After release, the cell should be updated
    expect(suspense.isReleasedCell.value).toBe(true);
    expect(suspense.isReleased).toBe(true);
  });
});

describe('Suspense fast loading scenario', () => {
  let fixture: DOMFixture;

  // Cast Suspense to accept args
  const SuspenseWithArgs = Suspense as unknown as new (
    args: Record<string, unknown>,
  ) => Suspense & SuspenseContext;

  beforeEach(() => { fixture = createDOMFixture(); });
  afterEach(() => { fixture.cleanup(); });

  test('fast loading: start() and end() called synchronously still triggers isReleased', () => {
    const suspense = new SuspenseWithArgs({});
    suspense[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, suspense);

    // Initially not released
    expect(suspense.isReleased).toBe(false);
    expect(suspense.pendingAmount).toBe(0);

    // Simulate fast loading: start() and end() called synchronously
    // (before any microtask has a chance to run)
    suspense.start();
    expect(suspense.pendingAmount).toBe(1);
    expect(suspense.isReleased).toBe(false);

    suspense.end();
    expect(suspense.pendingAmount).toBe(0);
    expect(suspense.isReleased).toBe(true);

    // The key invariant: isReleased changed from false to true,
    // even though pendingAmount went 0 -> 1 -> 0
  });

  test('fast loading: isReleased changes even when pendingAmount returns to initial value', () => {
    const suspense = new SuspenseWithArgs({});
    suspense[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, suspense);

    // Record initial state
    const initialPendingAmount = suspense.pendingAmount;
    const initialIsReleased = suspense.isReleased;

    expect(initialPendingAmount).toBe(0);
    expect(initialIsReleased).toBe(false);

    // Fast loading cycle
    suspense.start();
    suspense.end();

    // pendingAmount is back to initial value
    expect(suspense.pendingAmount).toBe(initialPendingAmount);

    // But isReleased has changed - this is the key difference!
    expect(suspense.isReleased).not.toBe(initialIsReleased);
    expect(suspense.isReleased).toBe(true);
  });

  test('multiple fast loading cycles: only first release matters', () => {
    const suspense = new SuspenseWithArgs({});
    suspense[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, suspense);

    // First cycle
    suspense.start();
    suspense.end();
    expect(suspense.isReleased).toBe(true);

    // Second cycle should be ignored
    suspense.start();
    expect(suspense.pendingAmount).toBe(0); // Ignored because released

    suspense.end();
    expect(suspense.pendingAmount).toBe(0); // Still 0
    expect(suspense.isReleased).toBe(true); // Still released
  });

  test('isReleasedCell value changes can be observed for reactivity', async () => {
    const suspense = new SuspenseWithArgs({});
    suspense[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, suspense);

    // Track value changes
    const observedValues: boolean[] = [];
    observedValues.push(suspense.isReleasedCell.value);

    // Fast loading
    suspense.start();
    observedValues.push(suspense.isReleasedCell.value); // Still false

    suspense.end();
    observedValues.push(suspense.isReleasedCell.value); // Now true

    expect(observedValues).toEqual([false, false, true]);
  });
});

describe('lazy() destructor tree integration', () => {
  let fixture: DOMFixture;

  beforeEach(() => { fixture = createDOMFixture(); });
  afterEach(() => { fixture.cleanup(); });

  type LazyComponentInstance = Component & {
    stateCell: { value: { loading: boolean; error: Error | null; component: unknown } };
    loadingPromise: Promise<void>;
  };

  test('lazy() registers loading promise with destructor tree', async () => {
    let resolveFactory!: (value: { default: typeof Component }) => void;
    const factoryPromise = new Promise<{ default: typeof Component }>((resolve) => {
      resolveFactory = resolve;
    });

    const LazyComponent = lazy(() => factoryPromise);
    const instance = new (LazyComponent as unknown as new (
      params: Record<string, unknown>,
    ) => LazyComponentInstance)({});
    instance[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, instance);

    // Verify loading promise exists
    expect(instance.loadingPromise).toBeInstanceOf(Promise);

    // Resolve the factory to complete loading
    resolveFactory({ default: Component });

    // Wait for promise to settle
    await instance.loadingPromise;

    expect(instance.stateCell.value.loading).toBe(false);
  });

  test('lazy() loading promise is awaited during destruction', async () => {
    let resolveFactory!: (value: { default: typeof Component }) => void;
    const factoryPromise = new Promise<{ default: typeof Component }>((resolve) => {
      resolveFactory = resolve;
    });

    const LazyComponent = lazy(() => factoryPromise);
    const instance = new (LazyComponent as unknown as new (
      params: Record<string, unknown>,
    ) => LazyComponentInstance)({});
    instance[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, instance);

    // Get the loading promise
    const loadingPromise = instance.loadingPromise;
    expect(loadingPromise).toBeInstanceOf(Promise);

    // Import destroyElement
    const { destroyElement } = await import('./component');
    const api = new HTMLBrowserDOMApi(fixture.document);

    // Start destruction - should collect loading promise
    const destructionPromise = destroyElement(instance, true, api);

    // Resolve factory while destruction is pending
    resolveFactory({ default: Component });

    // Destruction should complete after loading promise resolves
    await destructionPromise;

    // Component should be destroyed
    const { isDestroyed } = await import('./glimmer/destroyable');
    expect(isDestroyed(instance)).toBe(true);
  });

  test('lazy() skips state update when destroyed during loading', async () => {
    let resolveFactory!: (value: { default: typeof Component }) => void;
    const factoryPromise = new Promise<{ default: typeof Component }>((resolve) => {
      resolveFactory = resolve;
    });

    const LazyComponent = lazy(() => factoryPromise);
    const instance = new (LazyComponent as unknown as new (
      params: Record<string, unknown>,
    ) => LazyComponentInstance)({});
    instance[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, instance);

    // Import and destroy immediately
    const { destroyElement } = await import('./component');
    const { isDestroyed } = await import('./glimmer/destroyable');
    const api = new HTMLBrowserDOMApi(fixture.document);

    // Capture initial loading state
    expect(instance.stateCell.value.loading).toBe(true);

    // Start destruction
    const destructionPromise = destroyElement(instance, true, api);

    // Now resolve the factory after destruction started
    resolveFactory({ default: Component });

    await destructionPromise;

    // Component should be destroyed
    expect(isDestroyed(instance)).toBe(true);

    // State should NOT be updated to loaded because isDestroyed check prevents it
    // (the loading property stays true because update was skipped)
    expect(instance.stateCell.value.loading).toBe(true);
  });

  test('lazy() handles factory rejection during destruction', async () => {
    let rejectFactory!: (error: Error) => void;
    const factoryPromise = new Promise<{ default: typeof Component }>((_, reject) => {
      rejectFactory = reject;
    });

    const LazyComponent = lazy(() => factoryPromise);
    const instance = new (LazyComponent as unknown as new (
      params: Record<string, unknown>,
    ) => LazyComponentInstance)({});
    instance[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, instance);

    const { destroyElement } = await import('./component');
    const { isDestroyed } = await import('./glimmer/destroyable');
    const api = new HTMLBrowserDOMApi(fixture.document);

    // Start destruction
    const destructionPromise = destroyElement(instance, true, api);

    // Reject the factory
    rejectFactory(new Error('Factory failed'));

    // Destruction should complete without throwing
    await destructionPromise;

    expect(isDestroyed(instance)).toBe(true);
  });

  test('multiple lazy components are all awaited during parent destruction', async () => {
    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, parent);

    let resolveFactory1!: (value: { default: typeof Component }) => void;
    let resolveFactory2!: (value: { default: typeof Component }) => void;

    const LazyComponent1 = lazy(() => new Promise<{ default: typeof Component }>((resolve) => {
      resolveFactory1 = resolve;
    }));
    const LazyComponent2 = lazy(() => new Promise<{ default: typeof Component }>((resolve) => {
      resolveFactory2 = resolve;
    }));

    const instance1 = new (LazyComponent1 as unknown as new (
      params: Record<string, unknown>,
    ) => LazyComponentInstance)({});
    instance1[RENDERED_NODES_PROPERTY] = [];
    addToTree(parent, instance1);

    const instance2 = new (LazyComponent2 as unknown as new (
      params: Record<string, unknown>,
    ) => LazyComponentInstance)({});
    instance2[RENDERED_NODES_PROPERTY] = [];
    addToTree(parent, instance2);

    const { destroyElement } = await import('./component');
    const { isDestroyed } = await import('./glimmer/destroyable');
    const api = new HTMLBrowserDOMApi(fixture.document);

    // Start parent destruction
    const destructionPromise = destroyElement(parent, true, api);

    // Resolve both factories
    resolveFactory1({ default: Component });
    resolveFactory2({ default: Component });

    await destructionPromise;

    // All components should be destroyed
    expect(isDestroyed(parent)).toBe(true);
    expect(isDestroyed(instance1)).toBe(true);
    expect(isDestroyed(instance2)).toBe(true);
  });
});

describe('followPromise destructor tree integration', () => {
  let fixture: DOMFixture;

  beforeEach(() => { fixture = createDOMFixture(); });
  afterEach(() => { fixture.cleanup(); });

  test('followPromise returns tracked promise that resolves to same value', async () => {
    const child = new Component({});
    child[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, child);

    const result = await followPromise(child, Promise.resolve({ data: 'test' }));
    expect(result).toEqual({ data: 'test' });
  });

  test('followPromise calls suspense start/end correctly', async () => {
    const child = new Component({});
    child[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, child);

    const { ctx: testSuspense, getStartCount, getEndCount } = createTestSuspenseContext();
    provideContext(child, SUSPENSE_CONTEXT, testSuspense);

    let resolvePromise!: (value: string) => void;
    const promise = new Promise<string>((resolve) => {
      resolvePromise = resolve;
    });

    const tracked = followPromise(child, promise);
    expect(getStartCount()).toBe(1);
    expect(getEndCount()).toBe(0);

    resolvePromise('done');
    await tracked;

    expect(getEndCount()).toBe(1);
  });

  test('followPromise gracefully handles component destruction during loading', async () => {
    const child = new Component({});
    child[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, child);

    const { isDestroyed } = await import('./glimmer/destroyable');

    let resolvePromise!: (value: string) => void;
    const promise = new Promise<string>((resolve) => {
      resolvePromise = resolve;
    });

    const tracked = followPromise(child, promise);

    // Destroy the component - destruction now waits for the promise
    const { destroyElement } = await import('./component');
    const api = new HTMLBrowserDOMApi(fixture.document);

    // Start destruction (non-blocking) and resolve promise concurrently
    const destructionPromise = destroyElement(child, true, api);

    // Resolve the promise so destruction can complete
    resolvePromise('done');

    // Now wait for both to complete
    const [result] = await Promise.all([tracked, destructionPromise]);

    expect(result).toBe('done');
    expect(isDestroyed(child)).toBe(true);
  });

  test('followPromise still calls end on suspense after destruction', async () => {
    const child = new Component({});
    child[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, child);

    // Note: The Suspense component has isDestroyed checks in start/end,
    // but our test context doesn't. This test verifies the .finally() always runs.
    const { ctx: testSuspense, getStartCount, getEndCount } = createTestSuspenseContext();
    provideContext(child, SUSPENSE_CONTEXT, testSuspense);

    let resolvePromise!: (value: string) => void;
    const promise = new Promise<string>((resolve) => {
      resolvePromise = resolve;
    });

    const tracked = followPromise(child, promise);
    expect(getStartCount()).toBe(1);

    // Destroy the component - destruction now waits for the promise
    const { destroyElement } = await import('./component');
    const api = new HTMLBrowserDOMApi(fixture.document);

    // Start destruction (non-blocking) and resolve promise concurrently
    const destructionPromise = destroyElement(child, true, api);

    // Resolve the promise so destruction can complete
    resolvePromise('done');

    // Wait for both to complete
    await Promise.all([tracked, destructionPromise]);

    // end() should still be called via .finally()
    expect(getEndCount()).toBe(1);
  });

  test('followPromise destruction waits for pending promise', async () => {
    const child = new Component({});
    child[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, child);

    let promiseSettled = false;
    let destructionComplete = false;
    let resolvePromise!: (value: string) => void;
    const promise = new Promise<string>((resolve) => {
      resolvePromise = resolve;
    }).then((value) => {
      promiseSettled = true;
      return value;
    });

    followPromise(child, promise);

    const { destroyElement } = await import('./component');
    const api = new HTMLBrowserDOMApi(fixture.document);

    // Start destruction - it will wait for the promise
    const destructionPromise = destroyElement(child, true, api).then(() => {
      destructionComplete = true;
    });

    // Allow microtask queue to flush
    await Promise.resolve();

    // Destruction hasn't completed yet because promise is pending
    expect(destructionComplete).toBe(false);
    expect(promiseSettled).toBe(false);

    // Resolve the promise
    resolvePromise('done');

    // Wait for destruction to complete
    await destructionPromise;

    // Now destruction is complete and promise has settled
    expect(destructionComplete).toBe(true);
    expect(promiseSettled).toBe(true);
  });

  test('followPromise rejected promise does not break destruction', async () => {
    const child = new Component({});
    child[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, child);

    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<string>((_, reject) => {
      rejectPromise = reject;
    });

    // followPromise returns the tracked promise that will reject
    const tracked = followPromise(child, promise);

    const { destroyElement } = await import('./component');
    const { isDestroyed } = await import('./glimmer/destroyable');
    const api = new HTMLBrowserDOMApi(fixture.document);

    // Start destruction
    const destructionPromise = destroyElement(child, true, api);

    // Reject the promise
    rejectPromise(new Error('Test rejection'));

    // Destruction should complete without throwing (destructor uses .catch())
    await expect(destructionPromise).resolves.toBeUndefined();
    expect(isDestroyed(child)).toBe(true);

    // The tracked promise should still reject for the caller
    await expect(tracked).rejects.toThrow('Test rejection');
  });
});
