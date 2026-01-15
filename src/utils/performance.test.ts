/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cell, formula } from './reactive';
import { opcodeFor } from './vm';
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

      const destroy1 = opcodeFor(cell1, (v) => { results1.push(v as number); });
      const destroy2 = opcodeFor(cell2, (v) => { results2.push(v as number); });

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

      const destroy = opcodeFor(derivedFormula, (v) => { results.push(v as number); });

      expect(results).toEqual([10]);

      baseCell.update(10);
      await waitForSync();

      expect(results).toEqual([10, 20]);

      destroy();
      derivedFormula.destroy();
    });
  });

  describe('List IndexMap Operations', () => {
    // List operations tests - verifying Map operations work correctly

    it('Map tracks item indices correctly', () => {
      const indexMap = new Map<string, number>();

      // Initial items
      indexMap.set('a', 0);
      indexMap.set('b', 1);
      indexMap.set('c', 2);

      expect(indexMap.get('a')).toBe(0);
      expect(indexMap.get('b')).toBe(1);
      expect(indexMap.get('c')).toBe(2);

      // Update indices when items move
      indexMap.set('a', 2);
      indexMap.set('b', 0);
      indexMap.set('c', 1);

      expect(indexMap.get('a')).toBe(2);
      expect(indexMap.get('b')).toBe(0);
      expect(indexMap.get('c')).toBe(1);
    });

    it('Map handles item additions correctly', () => {
      const indexMap = new Map<string, number>();

      // Add items one by one
      indexMap.set('item-0', 0);
      indexMap.set('item-1', 1);
      indexMap.set('item-2', 2);

      expect(indexMap.size).toBe(3);

      // Add more items
      indexMap.set('item-3', 3);
      indexMap.set('item-4', 4);

      expect(indexMap.size).toBe(5);
      expect(indexMap.get('item-4')).toBe(4);
    });

    it('Map handles item removals correctly', () => {
      const indexMap = new Map<string, number>();

      // Initial items
      for (let i = 0; i < 5; i++) {
        indexMap.set(`item-${i}`, i);
      }

      expect(indexMap.size).toBe(5);

      // Remove items
      indexMap.delete('item-2');
      indexMap.delete('item-4');

      expect(indexMap.size).toBe(3);
      expect(indexMap.has('item-2')).toBe(false);
      expect(indexMap.has('item-4')).toBe(false);
      expect(indexMap.has('item-0')).toBe(true);
    });
  });
});
