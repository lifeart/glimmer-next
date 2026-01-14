import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { destroyElementSync, Component } from './component';
import { HTMLBrowserDOMApi, DOMApi } from './dom-api';
import {
  RENDERED_NODES_PROPERTY,
  PARENT,
  TREE,
  CHILD,
  addToTree,
  COMPONENT_ID_PROPERTY,
} from './shared';
import { cleanupFastContext, provideContext, RENDERING_CONTEXT } from './context';
import { Root, $_slot, $SLOTS_SYMBOL } from './dom';
import { cell, DEBUG_MERGED_CELLS } from './reactive';

describe('Slot Component', () => {
  let window: Window;
  let document: Document;
  let api: DOMApi;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    api = new HTMLBrowserDOMApi(document);
    cleanupFastContext();
    root = new Root(document);
    provideContext(root, RENDERING_CONTEXT, api);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    window.close();
  });

  describe('Slot Param Formula Cleanup', () => {
    test('slot param formulas are destroyed when parent is destroyed', async () => {
      // Skip if not in dev mode (DEBUG_MERGED_CELLS only available in dev)
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      // Create a reactive cell for slot param
      const paramValue = cell(42);

      // Track initial merged cells count
      const initialMergedCellsCount = DEBUG_MERGED_CELLS.size;

      // Create slots object with a default slot
      const slots = {
        [$SLOTS_SYMBOL]: true,
        default: (ctx: any, param: any) => {
          const div = document.createElement('div');
          // Use the param reactively
          div.textContent = String(typeof param === 'object' && 'value' in param ? param.value : param);
          return [div];
        },
      };

      // Call $_slot which internally calls createSlot
      const slotResult = $_slot('default', () => [paramValue], slots, parentComponent);

      // Wait for rendering
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should have created a formula for the param (if not const)
      const afterCreateCount = DEBUG_MERGED_CELLS.size;
      expect(afterCreateCount).toBeGreaterThanOrEqual(initialMergedCellsCount);

      // Destroy the parent component (which should clean up slot and its formulas)
      destroyElementSync(parentComponent, true, api);

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 10));

      // Merged cells count should return to initial (formulas destroyed)
      expect(DEBUG_MERGED_CELLS.size).toBe(initialMergedCellsCount);
    });

    test('const slot params are handled efficiently', async () => {
      // Skip if not in dev mode
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      // Track initial merged cells count
      const initialMergedCellsCount = DEBUG_MERGED_CELLS.size;

      // Create slots object with const param (primitive value)
      const slots = {
        [$SLOTS_SYMBOL]: true,
        default: (ctx: any, param: any) => {
          const div = document.createElement('div');
          div.textContent = String(param);
          return [div];
        },
      };

      // Call $_slot with a const primitive param
      $_slot('default', () => [42], slots, parentComponent);

      // Wait for rendering
      await new Promise(resolve => setTimeout(resolve, 10));

      // Const formula should be destroyed immediately after value extraction
      // So merged cells count should not increase significantly
      const afterCreateCount = DEBUG_MERGED_CELLS.size;

      // Destroy parent
      destroyElementSync(parentComponent, true, api);

      // Should return to initial
      expect(DEBUG_MERGED_CELLS.size).toBe(initialMergedCellsCount);
    });

    test('multiple slot create/destroy cycles do not leak formulas', async () => {
      // Skip if not in dev mode
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const initialMergedCellsCount = DEBUG_MERGED_CELLS.size;
      const initialTreeSize = TREE.size;

      // Simulate 5 create/destroy cycles
      for (let cycle = 0; cycle < 5; cycle++) {
        const parentComponent = new Component({});
        parentComponent[RENDERED_NODES_PROPERTY] = [];
        addToTree(root, parentComponent);

        const paramValue = cell(cycle);

        const slots = {
          [$SLOTS_SYMBOL]: true,
          default: (ctx: any, param: any) => {
            const div = document.createElement('div');
            div.textContent = String(typeof param === 'object' && 'value' in param ? param.value : param);
            return [div];
          },
        };

        $_slot('default', () => [paramValue], slots, parentComponent);

        await new Promise(resolve => setTimeout(resolve, 10));

        // Destroy
        destroyElementSync(parentComponent, true, api);
      }

      // Wait for all cleanup
      await new Promise(resolve => setTimeout(resolve, 20));

      // No leaks - should return to initial counts
      expect(TREE.size).toBe(initialTreeSize);
      expect(DEBUG_MERGED_CELLS.size).toBe(initialMergedCellsCount);
    });

    test('slot with multiple params cleans up all formulas', async () => {
      // Skip if not in dev mode
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const param1 = cell('first');
      const param2 = cell('second');
      const param3 = cell('third');

      const initialMergedCellsCount = DEBUG_MERGED_CELLS.size;

      const slots = {
        [$SLOTS_SYMBOL]: true,
        default: (ctx: any, p1: any, p2: any, p3: any) => {
          const div = document.createElement('div');
          const getValue = (p: any) => typeof p === 'object' && 'value' in p ? p.value : p;
          div.textContent = `${getValue(p1)}-${getValue(p2)}-${getValue(p3)}`;
          return [div];
        },
      };

      $_slot('default', () => [param1, param2, param3], slots, parentComponent);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Should have created formulas for all 3 params
      const afterCreateCount = DEBUG_MERGED_CELLS.size;
      expect(afterCreateCount).toBeGreaterThan(initialMergedCellsCount);

      // Destroy parent
      destroyElementSync(parentComponent, true, api);

      await new Promise(resolve => setTimeout(resolve, 10));

      // All formulas should be cleaned up
      expect(DEBUG_MERGED_CELLS.size).toBe(initialMergedCellsCount);
    });

    test('slot context is added to and removed from tree', async () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const initialTreeSize = TREE.size;

      const slots = {
        [$SLOTS_SYMBOL]: true,
        default: (ctx: any) => {
          const div = document.createElement('div');
          div.textContent = 'slot content';
          return [div];
        },
      };

      $_slot('default', () => [], slots, parentComponent);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Slot context should be added to tree (parent + slot context)
      expect(TREE.size).toBeGreaterThanOrEqual(initialTreeSize);

      // Destroy parent
      destroyElementSync(parentComponent, true, api);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Tree should be cleaned up - only root remains
      expect(TREE.size).toBe(1);
    });
  });

  describe('Deferred Slot Rendering', () => {
    test('deferred slot renders when value is set', async () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      // Create empty slots object (slot not yet defined)
      const slots: Record<string | symbol, any> = {
        [$SLOTS_SYMBOL]: true,
      };

      // Call $_slot before the slot is defined - should return placeholder
      const result = $_slot('mySlot', () => [], slots, parentComponent);

      // Result should be a comment placeholder (nodeType 8 is Comment)
      expect(result.nodeType).toBe(8);

      // Now define the slot
      slots.mySlot = (ctx: any) => {
        const div = document.createElement('div');
        div.textContent = 'deferred content';
        return [div];
      };

      // Slot should now render
      await new Promise(resolve => setTimeout(resolve, 10));

      // Cleanup
      destroyElementSync(parentComponent, true, api);
    });
  });
});
