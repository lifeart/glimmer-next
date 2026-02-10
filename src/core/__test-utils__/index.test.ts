import { describe, test, expect } from 'vitest';
import {
  createCallTracker,
  createTrackedGetter,
  createTrackedCell,
  createRegularFunction,
  createDeferred,
  flushMicrotasks,
  waitFor,
  createDOMFixture,
  createTestSuspenseContext,
} from './index';
import { Cell } from '../reactive';

describe('Test Utilities', () => {
  describe('createCallTracker', () => {
    test('tracks call count', () => {
      const { fn, getCallCount } = createCallTracker(() => 42);

      expect(getCallCount()).toBe(0);
      fn();
      expect(getCallCount()).toBe(1);
      fn();
      expect(getCallCount()).toBe(2);
    });

    test('returns implementation result', () => {
      const { fn } = createCallTracker(() => 'result');
      expect(fn()).toBe('result');
    });

    test('tracks arguments', () => {
      const { fn, getLastArgs, getAllCalls } = createCallTracker(
        (a: number, b: string) => `${a}-${b}`
      );

      fn(1, 'a');
      expect(getLastArgs()).toEqual([1, 'a']);

      fn(2, 'b');
      expect(getLastArgs()).toEqual([2, 'b']);
      expect(getAllCalls()).toEqual([
        [1, 'a'],
        [2, 'b'],
      ]);
    });

    test('reset clears tracking', () => {
      const { fn, getCallCount, reset } = createCallTracker(() => null);

      fn();
      fn();
      expect(getCallCount()).toBe(2);

      reset();
      expect(getCallCount()).toBe(0);
    });
  });

  describe('createTrackedGetter', () => {
    test('tracks access count', () => {
      const { getter, getAccessCount } = createTrackedGetter(() => 'value');

      expect(getAccessCount()).toBe(0);
      getter();
      expect(getAccessCount()).toBe(1);
      getter();
      expect(getAccessCount()).toBe(2);
    });

    test('returns value from getValue function', () => {
      let value = 'initial';
      const { getter } = createTrackedGetter(() => value);

      expect(getter()).toBe('initial');
      value = 'updated';
      expect(getter()).toBe('updated');
    });

    test('getter has no prototype (like arrow function)', () => {
      const { getter } = createTrackedGetter(() => 42);
      expect(getter.prototype).toBeUndefined();
    });
  });

  describe('createTrackedCell', () => {
    test('creates a real Cell', () => {
      const { testCell } = createTrackedCell(0);
      expect(testCell).toBeInstanceOf(Cell);
      expect(testCell.value).toBe(0);
    });

    test('tracks update count', () => {
      const { testCell, getUpdateCount } = createTrackedCell(0);

      expect(getUpdateCount()).toBe(0);
      testCell.update(1);
      expect(getUpdateCount()).toBe(1);
      expect(testCell.value).toBe(1);
    });

    test('reset clears update count', () => {
      const { testCell, getUpdateCount, reset } = createTrackedCell(0);

      testCell.update(1);
      testCell.update(2);
      expect(getUpdateCount()).toBe(2);

      reset();
      expect(getUpdateCount()).toBe(0);
      // Cell value is not reset
      expect(testCell.value).toBe(2);
    });
  });

  describe('createRegularFunction', () => {
    test('creates function with prototype', () => {
      const fn = createRegularFunction(() => 42);
      expect(fn.prototype).toBeDefined();
    });

    test('returns implementation result', () => {
      const fn = createRegularFunction(() => 'result');
      expect(fn()).toBe('result');
    });
  });

  describe('createDeferred', () => {
    test('creates resolvable promise', async () => {
      const { promise, resolve } = createDeferred<string>();

      setTimeout(() => resolve('done'), 0);

      const result = await promise;
      expect(result).toBe('done');
    });

    test('creates rejectable promise', async () => {
      const { promise, reject } = createDeferred<string>();

      setTimeout(() => reject(new Error('failed')), 0);

      await expect(promise).rejects.toThrow('failed');
    });
  });

  describe('flushMicrotasks', () => {
    test('flushes pending microtasks', async () => {
      let executed = false;
      queueMicrotask(() => {
        executed = true;
      });

      expect(executed).toBe(false);
      await flushMicrotasks();
      expect(executed).toBe(true);
    });
  });

  describe('waitFor', () => {
    test('waits for condition to be true', async () => {
      let ready = false;
      setTimeout(() => {
        ready = true;
      }, 50);

      await waitFor(() => ready);
      expect(ready).toBe(true);
    });

    test('throws on timeout', async () => {
      await expect(waitFor(() => false, 50)).rejects.toThrow(
        'waitFor timeout exceeded'
      );
    });
  });

  describe('createDOMFixture', () => {
    test('returns all DOM primitives', () => {
      const fixture = createDOMFixture();

      expect(fixture.window).toBeDefined();
      expect(fixture.document).toBeDefined();
      expect(fixture.api).toBeDefined();
      expect(fixture.root).toBeDefined();
      expect(fixture.container).toBeDefined();
      expect(fixture.container.parentNode).toBe(fixture.document.body);

      fixture.cleanup();
    });

    test('cleanup does not throw', () => {
      const fixture = createDOMFixture();
      expect(() => fixture.cleanup()).not.toThrow();
    });
  });

  describe('createTestSuspenseContext', () => {
    test('tracks start and end calls', () => {
      const { ctx, getStartCount, getEndCount } = createTestSuspenseContext();

      expect(getStartCount()).toBe(0);
      expect(getEndCount()).toBe(0);

      ctx.start();
      expect(getStartCount()).toBe(1);

      ctx.start();
      expect(getStartCount()).toBe(2);

      ctx.end();
      expect(getEndCount()).toBe(1);
    });

    test('reset clears counts', () => {
      const { ctx, getStartCount, getEndCount, reset } = createTestSuspenseContext();

      ctx.start();
      ctx.end();
      expect(getStartCount()).toBe(1);
      expect(getEndCount()).toBe(1);

      reset();
      expect(getStartCount()).toBe(0);
      expect(getEndCount()).toBe(0);
    });
  });
});
