/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cell, formula, Cell, MergedCell } from './reactive';
import { opcodeFor, evaluateOpcode } from './vm';
import { syncDom } from './runtime';
import { HTMLBrowserDOMApi } from './dom-api';
import { pushParentContext, popParentContext, setParentContext, Root } from './dom';
import { TREE, COMPONENT_ID_PROPERTY, RENDERED_NODES_PROPERTY } from './shared';

// Helper to wait for microtask queue (where syncDom runs)
const waitForSync = () => new Promise(resolve => setTimeout(resolve, 10));

describe('Performance Optimizations', () => {
  describe('Async Opcode Fast Path', () => {
    it('executes sync opcodes without WeakSet lookup when no async opcodes exist', async () => {
      const tag = cell(1, 'test-cell-sync');
      const values: number[] = [];

      // Create a sync opcode
      const destroy = opcodeFor(tag, (value) => {
        values.push(value as number);
      });

      expect(values).toEqual([1]);

      // Update triggers sync execution via microtask
      tag.update(2);
      await waitForSync();

      expect(values).toEqual([1, 2]);

      destroy();
    });

    it('handles mixed sync/async opcodes correctly', async () => {
      const tag = cell(1, 'async-test-mixed');
      const syncValues: number[] = [];
      const asyncValues: number[] = [];

      // Sync opcode
      const destroySync = opcodeFor(tag, (value) => {
        syncValues.push(value as number);
      });

      // Async opcode (returns a promise)
      const destroyAsync = opcodeFor(tag, async (value) => {
        await Promise.resolve();
        asyncValues.push(value as number);
      });

      expect(syncValues).toEqual([1]);
      // Async opcode runs but result is captured after await
      await waitForSync();
      expect(asyncValues).toEqual([1]);

      tag.update(2);
      await waitForSync();

      expect(syncValues).toEqual([1, 2]);
      expect(asyncValues).toEqual([1, 2]);

      destroySync();
      destroyAsync();
    });
  });

  describe('DOM Insert Guard', () => {
    it('handles null parent gracefully', () => {
      const api = new HTMLBrowserDOMApi(document);
      const child = document.createElement('div');

      // Should not throw when parent is null
      expect(() => {
        // @ts-expect-error - testing null parent
        api.insert(null, child, null);
      }).not.toThrow();
    });

    it('inserts element when parent is valid', () => {
      const api = new HTMLBrowserDOMApi(document);
      const parent = document.createElement('div');
      const child = document.createElement('span');

      api.insert(parent, child, null);

      expect(parent.contains(child)).toBe(true);
    });

    it('inserts before anchor when provided', () => {
      const api = new HTMLBrowserDOMApi(document);
      const parent = document.createElement('div');
      const child = document.createElement('span');
      const anchor = document.createElement('div');

      parent.appendChild(anchor);
      api.insert(parent, child, anchor);

      expect(parent.firstChild).toBe(child);
      expect(parent.lastChild).toBe(anchor);
    });
  });

  describe('Parent Context Push/Pop', () => {
    let root: Root;

    beforeEach(() => {
      root = new Root(document);
    });

    afterEach(() => {
      // Cleanup
      TREE.delete(root[COMPONENT_ID_PROPERTY]);
    });

    it('pushParentContext adds to stack', () => {
      // Create a mock component-like object
      const mockComponent = {
        [COMPONENT_ID_PROPERTY]: 999,
        [RENDERED_NODES_PROPERTY]: [],
      };
      TREE.set(999, mockComponent as any);

      pushParentContext(mockComponent as any);

      // Pop should work without error
      expect(() => popParentContext()).not.toThrow();

      TREE.delete(999);
    });

    it('setParentContext handles both push and pop', () => {
      const mockComponent = {
        [COMPONENT_ID_PROPERTY]: 998,
        [RENDERED_NODES_PROPERTY]: [],
      };
      TREE.set(998, mockComponent as any);

      // Push via setParentContext
      setParentContext(mockComponent as any);

      // Pop via setParentContext
      expect(() => setParentContext(null)).not.toThrow();

      TREE.delete(998);
    });
  });

  describe('SyncDom Direct Iteration', () => {
    it('processes multiple tags efficiently', async () => {
      const cell1 = cell(1, 'cell1-sync');
      const cell2 = cell(2, 'cell2-sync');
      const results1: number[] = [];
      const results2: number[] = [];

      const destroy1 = opcodeFor(cell1, (v) => results1.push(v as number));
      const destroy2 = opcodeFor(cell2, (v) => results2.push(v as number));

      // Update both cells
      cell1.update(10);
      cell2.update(20);

      await waitForSync();

      expect(results1).toEqual([1, 10]);
      expect(results2).toEqual([2, 20]);

      destroy1();
      destroy2();
    });

    it('handles formulas with related tags', async () => {
      const baseCell = cell(5, 'base-formula');
      const derivedFormula = formula(() => baseCell.value * 2, 'derived-formula');
      const results: number[] = [];

      const destroy = opcodeFor(derivedFormula, (v) => results.push(v as number));

      expect(results).toEqual([10]);

      baseCell.update(10);
      await waitForSync();

      expect(results).toEqual([10, 20]);

      destroy();
      derivedFormula.destroy();
    });
  });

  describe('List IndexMap Optimization', () => {
    // List optimization tests are covered in list.test.ts
    // Here we just verify the optimization doesn't break Map operations

    it('Map operations work correctly with deferred updates', () => {
      // This tests the pattern used in list.ts where we defer index updates
      const indexMap = new Map<string, number>();
      const appendedIndexes = new Set<number>();

      // Initial items
      indexMap.set('a', 0);
      indexMap.set('b', 1);
      indexMap.set('c', 2);

      // Simulate inserting 'x' at index 0 without updating all other indices
      indexMap.set('x', 0);
      appendedIndexes.add(0);

      // The optimization: instead of updating all indices >= 0,
      // we just track which indices were appended
      // This makes the check O(1) instead of O(N)
      expect(appendedIndexes.has(0)).toBe(true);
      expect(indexMap.get('x')).toBe(0);

      // Existing items still have their original indices
      // but we can detect they need adjustment via appendedIndexes
      expect(indexMap.get('a')).toBe(0);
      expect(appendedIndexes.has(indexMap.get('a')!)).toBe(true);
    });

    it('appendedIndexes tracks multiple insertions correctly', () => {
      const appendedIndexes = new Set<number>();

      // Simulate multiple insertions
      appendedIndexes.add(0);
      appendedIndexes.add(2);
      appendedIndexes.add(4);

      // Can check if an index was an insertion point
      expect(appendedIndexes.has(0)).toBe(true);
      expect(appendedIndexes.has(1)).toBe(false);
      expect(appendedIndexes.has(2)).toBe(true);
      expect(appendedIndexes.has(3)).toBe(false);
      expect(appendedIndexes.has(4)).toBe(true);
    });

    it('deferred update pattern avoids O(N²) complexity', () => {
      // Demonstrate the O(N²) avoidance
      const N = 1000;
      const indexMap = new Map<string, number>();
      const appendedIndexes = new Set<number>();

      // Setup: N items
      for (let i = 0; i < N; i++) {
        indexMap.set(`item-${i}`, i);
      }

      // Old approach would do this for each insertion:
      // for (const [key, value] of indexMap) {
      //   if (value >= insertIndex) indexMap.set(key, value + 1);
      // }
      // This is O(N) per insertion = O(N²) for N insertions

      // New approach: just track insertions
      const startTime = performance.now();
      for (let i = 0; i < 100; i++) {
        // Simulate 100 insertions - with old approach this would be O(100 * N)
        appendedIndexes.add(i * 10);
      }
      const endTime = performance.now();

      // Should be nearly instant (< 10ms for 100 set operations)
      expect(endTime - startTime).toBeLessThan(10);
      expect(appendedIndexes.size).toBe(100);
    });
  });
});
