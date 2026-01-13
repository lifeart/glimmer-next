import { expect, test, describe, beforeEach, afterEach, vi } from 'vitest';
import { Window } from 'happy-dom';
import { SUSPENSE_CONTEXT, followPromise } from './suspense-utils';
import { Component } from './component';
import {
  provideContext,
  getContext,
  cleanupFastContext,
  RENDERING_CONTEXT,
} from './context';
import { HTMLBrowserDOMApi } from './dom-api';
import {
  RENDERED_NODES_PROPERTY,
  TREE,
  PARENT,
  CHILD,
  addToTree,
} from './shared';
import { Root } from './dom';

describe('Suspense API exports', () => {
  describe('SUSPENSE_CONTEXT', () => {
    test('SUSPENSE_CONTEXT is a symbol', () => {
      expect(typeof SUSPENSE_CONTEXT).toBe('symbol');
      expect(SUSPENSE_CONTEXT.description).toBe('suspense');
    });
  });

  describe('followPromise', () => {
    let window: Window;
    let document: Document;
    let root: Root;

    beforeEach(() => {
      window = new Window();
      document = window.document as unknown as Document;
      cleanupFastContext();
      root = new Root(document);
      const api = new HTMLBrowserDOMApi(document);
      provideContext(root, RENDERING_CONTEXT, api);
    });

    afterEach(() => {
      cleanupFastContext();
      TREE.clear();
      PARENT.clear();
      CHILD.clear();
      window.close();
    });

    test('followPromise returns the same promise', () => {
      const child = new Component({});
      child[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, child);

      const promise = Promise.resolve('test');
      const result = followPromise(child, promise);

      expect(result).toBe(promise);
    });

    test('followPromise handles missing suspense context gracefully', () => {
      // Component without suspense context
      const child = new Component({});
      child[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, child);

      const promise = Promise.resolve('test');
      // Should not throw
      expect(() => followPromise(child, promise)).not.toThrow();
    });

    test('followPromise calls start/end on suspense context', async () => {
      const child = new Component({});
      child[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, child);

      // Create a mock suspense context
      const mockSuspense = {
        start: vi.fn(),
        end: vi.fn(),
      };
      provideContext(child, SUSPENSE_CONTEXT, mockSuspense);

      const promise = Promise.resolve('test');
      followPromise(child, promise);

      expect(mockSuspense.start).toHaveBeenCalled();

      await promise;
      // Wait for microtask (Promise.resolve().then in followPromise)
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockSuspense.end).toHaveBeenCalled();
    });

    test('followPromise calls end even on rejection', async () => {
      const child = new Component({});
      child[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, child);

      const mockSuspense = {
        start: vi.fn(),
        end: vi.fn(),
      };
      provideContext(child, SUSPENSE_CONTEXT, mockSuspense);

      // Create a deferred rejection to avoid unhandled rejection detection
      let rejectFn: (error: Error) => void;
      const promise = new Promise<never>((_, reject) => {
        rejectFn = reject;
      });

      // Attach catch handler before calling followPromise to ensure rejection is always handled
      const handledPromise = promise.catch(() => {});

      followPromise(child, promise);
      expect(mockSuspense.start).toHaveBeenCalled();

      // Now reject the promise after we've set up handling
      rejectFn!(new Error('test error'));

      await handledPromise;

      // Wait for microtask
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockSuspense.end).toHaveBeenCalled();
    });

    test('nested components find correct suspense context', () => {
      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parent);

      const child = new Component({});
      child[RENDERED_NODES_PROPERTY] = [];
      addToTree(parent, child);

      const grandchild = new Component({});
      grandchild[RENDERED_NODES_PROPERTY] = [];
      addToTree(child, grandchild);

      // Provide context at parent level
      const mockSuspense = { start: vi.fn(), end: vi.fn() };
      provideContext(parent, SUSPENSE_CONTEXT, mockSuspense);

      // Grandchild should find it
      const foundContext = getContext(grandchild, SUSPENSE_CONTEXT);
      expect(foundContext).toBe(mockSuspense);
    });

    test('inner suspense context shadows outer', () => {
      const outer = new Component({});
      outer[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, outer);

      const inner = new Component({});
      inner[RENDERED_NODES_PROPERTY] = [];
      addToTree(outer, inner);

      const child = new Component({});
      child[RENDERED_NODES_PROPERTY] = [];
      addToTree(inner, child);

      const outerSuspense = { start: vi.fn(), end: vi.fn() };
      const innerSuspense = { start: vi.fn(), end: vi.fn() };

      provideContext(outer, SUSPENSE_CONTEXT, outerSuspense);
      provideContext(inner, SUSPENSE_CONTEXT, innerSuspense);

      // Child should find inner suspense
      const foundContext = getContext(child, SUSPENSE_CONTEXT);
      expect(foundContext).toBe(innerSuspense);
    });
  });
});

describe('Suspense context protocol', () => {
  let window: Window;
  let document: Document;
  let root: Root;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    cleanupFastContext();
    root = new Root(document);
    const api = new HTMLBrowserDOMApi(document);
    provideContext(root, RENDERING_CONTEXT, api);
  });

  afterEach(() => {
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    window.close();
  });

  test('suspense context follows start/end protocol for tracking', async () => {
    const child = new Component({});
    child[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, child);

    let pendingCount = 0;
    const mockSuspense = {
      start: vi.fn(() => {
        pendingCount++;
      }),
      end: vi.fn(() => {
        pendingCount--;
      }),
    };
    provideContext(child, SUSPENSE_CONTEXT, mockSuspense);

    // Simulate multiple async operations
    const promise1 = new Promise((resolve) => setTimeout(resolve, 10));
    const promise2 = new Promise((resolve) => setTimeout(resolve, 20));

    followPromise(child, promise1);
    followPromise(child, promise2);

    expect(mockSuspense.start).toHaveBeenCalledTimes(2);
    expect(pendingCount).toBe(2);

    await promise1;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pendingCount).toBe(1);

    await promise2;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pendingCount).toBe(0);
  });

  test('followPromise works with async/await pattern', async () => {
    const child = new Component({});
    child[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, child);

    const mockSuspense = {
      start: vi.fn(),
      end: vi.fn(),
    };
    provideContext(child, SUSPENSE_CONTEXT, mockSuspense);

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

    expect(mockSuspense.start).toHaveBeenCalledTimes(1);
    expect(mockSuspense.end).toHaveBeenCalledTimes(1);
  });
});
