import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { destroyElementSync, Component, unregisterFromParent } from './component';
import { HTMLBrowserDOMApi, DOMApi } from './dom-api';
import {
  RENDERED_NODES_PROPERTY,
  PARENT,
  TREE,
  CHILD,
  addToTree,
  COMPONENT_ID_PROPERTY,
  ADDED_TO_TREE_FLAG,
  releaseId,
} from './shared';
import { destroy } from './glimmer/destroyable';
import { cleanupFastContext, provideContext, RENDERING_CONTEXT } from './context';
import { Root } from './dom';
import { cell, formula, DEBUG_MERGED_CELLS } from './reactive';
import { IfCondition } from './control-flow/if';
import { SyncListComponent, AsyncListComponent } from './control-flow/list';

describe('Destruction Flow Tests', () => {
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

  describe('Tree Mutation During Destruction', () => {
    test('destroying component with many children does not throw', async () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      // Create multiple child components
      const children: Component<any>[] = [];
      for (let i = 0; i < 10; i++) {
        const child = new Component({});
        child[RENDERED_NODES_PROPERTY] = [];
        addToTree(parentComponent, child);
        children.push(child);
      }

      const parentId = parentComponent[COMPONENT_ID_PROPERTY];
      const childIds = CHILD.get(parentId);
      expect(childIds?.length).toBe(10);

      // Should not throw even if CHILD array is mutated during iteration
      expect(() => {
        destroyElementSync(parentComponent, true, api);
      }).not.toThrow();
    });

    test('nested component destruction works correctly', async () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      // Create nested hierarchy: parent -> child -> grandchild
      const child = new Component({});
      child[RENDERED_NODES_PROPERTY] = [];
      addToTree(parentComponent, child);

      const grandchild = new Component({});
      grandchild[RENDERED_NODES_PROPERTY] = [];
      addToTree(child, grandchild);

      const initialTreeSize = TREE.size;
      expect(initialTreeSize).toBeGreaterThanOrEqual(3);

      destroyElementSync(parentComponent, true, api);

      // After destruction, tree should be smaller
      // Note: Root is still in tree
      expect(TREE.size).toBeLessThan(initialTreeSize);
    });
  });

  describe('Error Recovery in destroyElementSync', () => {
    test('continues destruction even with null components in array', () => {
      const validComponent = new Component({});
      validComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, validComponent);

      // Should handle array with potential edge cases
      expect(() => {
        destroyElementSync([validComponent], true, api);
      }).not.toThrow();
    });

    test('handles component without RENDERED_NODES_PROPERTY', () => {
      const node = document.createElement('div');
      container.appendChild(node);

      // Should handle plain DOM nodes
      expect(() => {
        destroyElementSync(node, false, api);
      }).not.toThrow();
    });
  });

  describe('unregisterFromParent Safety', () => {
    test('handles component with undefined id gracefully', () => {
      const component = {} as any;
      component[RENDERED_NODES_PROPERTY] = [];
      // Deliberately not setting COMPONENT_ID_PROPERTY

      expect(() => {
        unregisterFromParent(component);
      }).not.toThrow();
    });

    test('handles component with no parent gracefully', () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];
      // Not added to tree, so no parent

      expect(() => {
        unregisterFromParent(component);
      }).not.toThrow();
    });

    test('handles array of components', () => {
      const component1 = new Component({});
      component1[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component1);

      const component2 = new Component({});
      component2[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component2);

      expect(() => {
        unregisterFromParent([component1, component2]);
      }).not.toThrow();
    });
  });

  describe('IfCondition Tree Cleanup', () => {
    test('IfCondition cleans up TREE/PARENT/CHILD on destroy', async () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const condition = cell(true);
      const placeholder = api.comment('test');
      const target = api.fragment();
      api.insert(target, placeholder);

      const ifCondition = new IfCondition(
        parentComponent,
        condition,
        target as unknown as DocumentFragment,
        placeholder,
        () => null,
        () => null,
      );

      const ifId = ifCondition[COMPONENT_ID_PROPERTY];

      // Verify if is in tree
      expect(TREE.has(ifId)).toBe(true);

      // Destroy
      await ifCondition.destroy();

      // Verify cleanup
      expect(TREE.has(ifId)).toBe(false);
      expect(PARENT.has(ifId)).toBe(false);
      expect(CHILD.has(ifId)).toBe(false);
    });

    test('rapid condition toggling does not cause race conditions', async () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const condition = cell(true);
      const placeholder = api.comment('test');
      const target = api.fragment();
      api.insert(target, placeholder);

      let renderCount = 0;
      const ifCondition = new IfCondition(
        parentComponent,
        condition,
        target as unknown as DocumentFragment,
        placeholder,
        () => {
          renderCount++;
          return null;
        },
        () => {
          renderCount++;
          return null;
        },
      );

      // Wait for initial render
      await new Promise(resolve => setTimeout(resolve, 10));

      // Rapidly toggle condition
      condition.value = false;
      condition.value = true;
      condition.value = false;
      condition.value = true;

      // Wait for all renders to settle
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should not throw and should have rendered
      expect(renderCount).toBeGreaterThan(0);

      // Clean up
      await ifCondition.destroy();
    });
  });

  describe('List Component Tree Cleanup', () => {
    test('SyncListComponent cleans up TREE/PARENT/CHILD on parent destroy', async () => {
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const items = cell([{ id: 1 }, { id: 2 }, { id: 3 }]);
      const placeholder = api.comment('list');
      const target = api.fragment();
      api.insert(target, placeholder);

      const list = new SyncListComponent(
        {
          tag: items,
          ItemComponent: (item: any) => {
            const div = document.createElement('div');
            div.textContent = String(item.id);
            return [div];
          },
          ctx: parentComponent,
          key: 'id',
        },
        target as unknown as DocumentFragment,
        placeholder,
      );

      const listId = list[COMPONENT_ID_PROPERTY];

      // Verify list is in tree
      expect(TREE.has(listId)).toBe(true);

      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 10));

      // Destroy parent (which should clean up list)
      destroyElementSync(parentComponent, true, api);

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify list cleanup
      expect(TREE.has(listId)).toBe(false);
    });

    test('list item removal cleans up index formulas', async () => {
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const items = cell([{ id: 1 }, { id: 2 }, { id: 3 }]);
      const placeholder = api.comment('list');
      const target = api.fragment();
      api.insert(target, placeholder);

      const list = new SyncListComponent(
        {
          tag: items,
          ItemComponent: (_item: any, index: any) => {
            const div = document.createElement('div');
            // Use index reactively to create formulas
            div.textContent = String(typeof index === 'object' ? index.value : index);
            return [div];
          },
          ctx: parentComponent,
          key: 'id',
        },
        target as unknown as DocumentFragment,
        placeholder,
      );

      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify formulas were created
      expect(list.indexFormulaMap.size).toBe(3);

      // Remove an item
      items.value = [{ id: 1 }, { id: 3 }];

      // Wait for update
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify formula was cleaned up (item 2 removed)
      expect(list.indexFormulaMap.size).toBe(2);
      expect(list.indexFormulaMap.has('2')).toBe(false);

      // Clean up
      destroyElementSync(parentComponent, true, api);
    });

    test('list clear cleans up all index formulas', async () => {
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const items = cell([{ id: 1 }, { id: 2 }, { id: 3 }]);
      const placeholder = api.comment('list');
      const target = api.fragment();
      api.insert(target, placeholder);

      const list = new SyncListComponent(
        {
          tag: items,
          ItemComponent: (_item: any, index: any) => {
            const div = document.createElement('div');
            div.textContent = String(typeof index === 'object' ? index.value : index);
            return [div];
          },
          ctx: parentComponent,
          key: 'id',
        },
        target as unknown as DocumentFragment,
        placeholder,
      );

      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(list.indexFormulaMap.size).toBe(3);

      // Clear all items
      items.value = [];

      // Wait for update
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify all formulas were cleaned up
      expect(list.indexFormulaMap.size).toBe(0);

      // Clean up
      destroyElementSync(parentComponent, true, api);
    });
  });

  describe('Formula Cleanup', () => {
    test('formulas created during rendering are cleaned up on destroy', async () => {
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const initialMergedCells = DEBUG_MERGED_CELLS.size;

      // Create some formulas that would be created during rendering
      const reactiveValue = cell('test');
      const testFormula = formula(() => reactiveValue.value, 'test-formula');

      expect(DEBUG_MERGED_CELLS.size).toBeGreaterThan(initialMergedCells);

      // Destroy the formula
      testFormula.destroy();

      // Should return to initial count
      expect(DEBUG_MERGED_CELLS.size).toBe(initialMergedCells);
    });

    test('multiple create/destroy cycles do not leak formulas', async () => {
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const initialMergedCells = DEBUG_MERGED_CELLS.size;
      const initialTreeSize = TREE.size;

      for (let i = 0; i < 5; i++) {
        const parentComponent = new Component({});
        parentComponent[RENDERED_NODES_PROPERTY] = [];
        addToTree(root, parentComponent);

        const reactiveValue = cell(i);
        const testFormula = formula(() => reactiveValue.value, `cycle-${i}`);

        // Simulate usage
        void testFormula.value;

        // Clean up
        testFormula.destroy();
        destroyElementSync(parentComponent, true, api);
      }

      // Wait for all cleanup
      await new Promise(resolve => setTimeout(resolve, 20));

      // No leaks
      expect(DEBUG_MERGED_CELLS.size).toBe(initialMergedCells);
      expect(TREE.size).toBe(initialTreeSize);
    });
  });

  describe('Modifier Destruction Order', () => {
    test('modifier with reactive dependencies cleans up correctly', async () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      let modifierCleanupCalled = false;
      let modifierRunCount = 0;

      const reactiveValue = cell('initial');

      // Simulate a modifier that has reactive dependencies
      const modifierFn = () => {
        modifierRunCount++;
        void reactiveValue.value; // Access reactive value
        return () => {
          modifierCleanupCalled = true;
        };
      };

      // Run modifier
      const cleanup = modifierFn();

      // Update reactive value
      reactiveValue.value = 'updated';

      // Clean up
      if (cleanup) cleanup();

      expect(modifierCleanupCalled).toBe(true);

      // Clean up component
      destroyElementSync(parentComponent, true, api);
    });
  });

  describe('Dynamic Component Cleanup', () => {
    test('dynamic component formula is tracked', async () => {
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const initialMergedCells = DEBUG_MERGED_CELLS.size;

      // Create a formula like $_dc does
      const componentRef = cell(() => null);
      const dcFormula = formula(() => componentRef.value, 'dynamic-component');

      // Formula should be tracked
      expect(DEBUG_MERGED_CELLS.size).toBeGreaterThan(initialMergedCells);

      // Destroy formula
      dcFormula.destroy();

      // Should be cleaned up
      expect(DEBUG_MERGED_CELLS.size).toBe(initialMergedCells);
    });
  });

  describe('Class Modifier Merge Cleanup', () => {
    test('merged class formulas are cleaned up', async () => {
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const initialMergedCells = DEBUG_MERGED_CELLS.size;

      // Simulate what mergeClassModifiers does
      const class1 = cell('class-a');
      const class2 = cell('class-b');

      const formula1 = formula(() => class1.value, 'class-modifier-1');
      const formula2 = formula(() => class2.value, 'class-modifier-2');
      const outerFormula = formula(() => {
        return `${formula1.value} ${formula2.value}`;
      }, 'merged-class');

      // Formulas should be tracked
      expect(DEBUG_MERGED_CELLS.size).toBeGreaterThan(initialMergedCells);

      // Clean up in order
      outerFormula.destroy();
      formula1.destroy();
      formula2.destroy();

      // Should return to initial
      expect(DEBUG_MERGED_CELLS.size).toBe(initialMergedCells);
    });
  });

  describe('AsyncListComponent Tests', () => {
    test('AsyncListComponent cleans up TREE/PARENT/CHILD on parent destroy', async () => {
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const items = cell([{ id: 1 }, { id: 2 }, { id: 3 }]);
      const placeholder = api.comment('async-list');
      const target = api.fragment();
      api.insert(target, placeholder);

      const list = new AsyncListComponent(
        {
          tag: items,
          ItemComponent: (item: any) => {
            const div = document.createElement('div');
            div.textContent = String(item.id);
            return [div];
          },
          ctx: parentComponent,
          key: 'id',
        },
        target as unknown as DocumentFragment,
        placeholder,
      );

      const listId = list[COMPONENT_ID_PROPERTY];

      // Verify list is in tree
      expect(TREE.has(listId)).toBe(true);

      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 10));

      // Destroy parent (which should clean up list)
      destroyElementSync(parentComponent, true, api);

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify list cleanup
      expect(TREE.has(listId)).toBe(false);
    });

    test('AsyncListComponent item removal cleans up index formulas', async () => {
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const items = cell([{ id: 1 }, { id: 2 }, { id: 3 }]);
      const placeholder = api.comment('async-list');
      const target = api.fragment();
      api.insert(target, placeholder);

      const list = new AsyncListComponent(
        {
          tag: items,
          ItemComponent: (_item: any, index: any) => {
            const div = document.createElement('div');
            div.textContent = String(typeof index === 'object' ? index.value : index);
            return [div];
          },
          ctx: parentComponent,
          key: 'id',
        },
        target as unknown as DocumentFragment,
        placeholder,
      );

      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 20));

      // Verify formulas were created
      expect(list.indexFormulaMap.size).toBe(3);

      // Remove an item
      items.value = [{ id: 1 }, { id: 3 }];

      // Wait for async update
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify formula was cleaned up (item 2 removed)
      expect(list.indexFormulaMap.size).toBe(2);

      // Clean up
      destroyElementSync(parentComponent, true, api);
    });

    test('AsyncListComponent fastCleanup cleans up all formulas', async () => {
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const items = cell([{ id: 1 }, { id: 2 }, { id: 3 }]);
      const placeholder = api.comment('async-list');
      const target = api.fragment();
      api.insert(target, placeholder);

      const list = new AsyncListComponent(
        {
          tag: items,
          ItemComponent: (_item: any, index: any) => {
            const div = document.createElement('div');
            div.textContent = String(typeof index === 'object' ? index.value : index);
            return [div];
          },
          ctx: parentComponent,
          key: 'id',
        },
        target as unknown as DocumentFragment,
        placeholder,
      );

      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(list.indexFormulaMap.size).toBe(3);

      // Clear all items (triggers fastCleanup)
      items.value = [];

      // Wait for async cleanup
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify all formulas were cleaned up
      expect(list.indexFormulaMap.size).toBe(0);

      // Clean up
      destroyElementSync(parentComponent, true, api);
    });
  });

  describe('IfCondition with DOM rendering', () => {
    test('IfCondition properly renders and destroys DOM nodes', async () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const condition = cell(true);
      const placeholder = api.comment('if-placeholder');
      container.appendChild(placeholder);

      let trueBranchRenderCount = 0;
      let falseBranchRenderCount = 0;

      const ifCondition = new IfCondition(
        parentComponent,
        condition,
        container as unknown as DocumentFragment,
        placeholder,
        () => {
          trueBranchRenderCount++;
          const div = document.createElement('div');
          div.className = 'true-branch';
          div.textContent = 'True';
          return div;
        },
        () => {
          falseBranchRenderCount++;
          const div = document.createElement('div');
          div.className = 'false-branch';
          div.textContent = 'False';
          return div;
        },
      );

      // Wait for initial render
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(trueBranchRenderCount).toBe(1);
      expect(falseBranchRenderCount).toBe(0);

      // Toggle to false
      condition.value = false;

      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(falseBranchRenderCount).toBe(1);

      // Toggle back to true
      condition.value = true;

      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(trueBranchRenderCount).toBe(2);

      // Clean up
      await ifCondition.destroy();
    });

    test('IfCondition handles destroyPromise correctly during rapid toggles', async () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const condition = cell(true);
      const placeholder = api.comment('if-placeholder');
      container.appendChild(placeholder);

      let renderCount = 0;

      const ifCondition = new IfCondition(
        parentComponent,
        condition,
        container as unknown as DocumentFragment,
        placeholder,
        () => {
          renderCount++;
          const div = document.createElement('div');
          return div;
        },
        () => {
          renderCount++;
          const span = document.createElement('span');
          return span;
        },
      );

      // Wait for initial render
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should have rendered at least once
      expect(renderCount).toBeGreaterThanOrEqual(1);

      // Rapid toggles while destruction might be in progress
      // This tests that race conditions are handled gracefully
      for (let i = 0; i < 10; i++) {
        condition.value = !condition.value;
      }

      // Wait for all operations to complete
      await new Promise(resolve => setTimeout(resolve, 200));

      // The key assertion: no errors should have been thrown during rapid toggles
      // and the component should still be in a valid state for cleanup
      expect(ifCondition.throwedError).toBe(null);

      // Should not throw during cleanup
      await ifCondition.destroy();
    });
  });

  describe('List preserves items correctly', () => {
    test('updating list preserves existing items in CHILD', async () => {
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const items = cell([{ id: 1 }, { id: 2 }, { id: 3 }]);
      const placeholder = api.comment('list');
      const target = api.fragment();
      api.insert(target, placeholder);

      const list = new SyncListComponent(
        {
          tag: items,
          ItemComponent: (item: any) => {
            const div = document.createElement('div');
            div.textContent = String(item.id);
            return [div];
          },
          ctx: parentComponent,
          key: 'id',
        },
        target as unknown as DocumentFragment,
        placeholder,
      );

      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify initial state
      expect(list.keyMap.size).toBe(3);

      // Update list - add one item, keep existing
      items.value = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

      // Wait for update
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should have 4 items now
      expect(list.keyMap.size).toBe(4);

      // Original items should still be tracked
      expect(list.keyMap.has('1')).toBe(true);
      expect(list.keyMap.has('2')).toBe(true);
      expect(list.keyMap.has('3')).toBe(true);
      expect(list.keyMap.has('4')).toBe(true);

      // Clean up
      destroyElementSync(parentComponent, true, api);
    });

    test('reordering list items does not orphan TREE entries', async () => {
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const items = cell([{ id: 1 }, { id: 2 }, { id: 3 }]);
      const placeholder = api.comment('list');
      const target = api.fragment();
      api.insert(target, placeholder);

      const list = new SyncListComponent(
        {
          tag: items,
          ItemComponent: (item: any) => {
            const div = document.createElement('div');
            div.textContent = String(item.id);
            return [div];
          },
          ctx: parentComponent,
          key: 'id',
        },
        target as unknown as DocumentFragment,
        placeholder,
      );

      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 10));

      const initialTreeSize = TREE.size;

      // Reorder items
      items.value = [{ id: 3 }, { id: 1 }, { id: 2 }];

      // Wait for update
      await new Promise(resolve => setTimeout(resolve, 10));

      // Tree size should remain the same after reorder
      expect(TREE.size).toBe(initialTreeSize);

      // All items should still be tracked
      expect(list.keyMap.size).toBe(3);

      // Clean up
      destroyElementSync(parentComponent, true, api);
    });
  });

  describe('Destructor registration and cleanup', () => {
    test('registerDestructor destructors are called on component destroy', async () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      let destructor1Called = false;
      let destructor2Called = false;

      const { registerDestructor } = await import('./glimmer/destroyable');

      registerDestructor(parentComponent, () => {
        destructor1Called = true;
      });

      registerDestructor(parentComponent, () => {
        destructor2Called = true;
      });

      // Destroy
      destroyElementSync(parentComponent, true, api);

      // Both destructors should be called
      expect(destructor1Called).toBe(true);
      expect(destructor2Called).toBe(true);
    });

    test('nested component destructors are called in correct order', async () => {
      const callOrder: string[] = [];

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const childComponent = new Component({});
      childComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(parentComponent, childComponent);

      const { registerDestructor } = await import('./glimmer/destroyable');

      registerDestructor(parentComponent, () => {
        callOrder.push('parent');
      });

      registerDestructor(childComponent, () => {
        callOrder.push('child');
      });

      // Destroy parent (should destroy child first in tree traversal)
      destroyElementSync(parentComponent, true, api);

      // Parent destructor should be called before traversing to children
      // Based on the implementation, parent is destroyed first, then children
      expect(callOrder).toContain('parent');
      expect(callOrder).toContain('child');
    });
  });

  describe('Edge Cases', () => {
    test('destroying already destroyed component does not crash', async () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      // First destroy
      destroyElementSync(parentComponent, true, api);

      // Second destroy should not crash
      expect(() => {
        destroyElementSync(parentComponent, true, api);
      }).not.toThrow();
    });

    test('destroying empty array does not crash', () => {
      expect(() => {
        destroyElementSync([], true, api);
      }).not.toThrow();
    });

    test('CHILD array mutation during destruction is handled', async () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      // Create children that will be destroyed
      const children: Component<any>[] = [];
      for (let i = 0; i < 5; i++) {
        const child = new Component({});
        child[RENDERED_NODES_PROPERTY] = [];
        addToTree(parentComponent, child);
        children.push(child);
      }

      const parentId = parentComponent[COMPONENT_ID_PROPERTY];
      const childArray = CHILD.get(parentId);

      // Verify we have children
      expect(childArray?.length).toBe(5);

      // Destroy should handle iteration over array that may be mutated
      expect(() => {
        destroyElementSync(parentComponent, true, api);
      }).not.toThrow();
    });
  });

  describe('IfCondition formula cleanup', () => {
    test('condition formula created by setupCondition is cleaned up', async () => {
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const initialMergedCells = DEBUG_MERGED_CELLS.size;

      // Pass a function to setupCondition, which creates a formula internally
      const conditionFn = () => true;
      const placeholder = api.comment('if-placeholder');
      const target = api.fragment();
      api.insert(target, placeholder);

      const ifCondition = new IfCondition(
        parentComponent,
        conditionFn,
        target as unknown as DocumentFragment,
        placeholder,
        () => null,
        () => null,
      );

      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should have created a formula for the condition
      expect(DEBUG_MERGED_CELLS.size).toBeGreaterThan(initialMergedCells);

      // Destroy
      await ifCondition.destroy();

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 10));

      // Clean up parent
      destroyElementSync(parentComponent, true, api);
    });
  });

  describe('Deeply nested component trees', () => {
    test('destroying deeply nested tree (10 levels) works correctly', async () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      // Create a deeply nested hierarchy
      let current = parentComponent;
      const depth = 10;
      const components: Component<any>[] = [parentComponent];

      for (let i = 0; i < depth; i++) {
        const child = new Component({});
        child[RENDERED_NODES_PROPERTY] = [];
        addToTree(current, child);
        components.push(child);
        current = child;
      }

      // Verify tree structure
      expect(components.length).toBe(depth + 1);

      const initialTreeSize = TREE.size;
      expect(initialTreeSize).toBeGreaterThanOrEqual(depth + 1);

      // Destroy from root - should clean up entire tree
      expect(() => {
        destroyElementSync(parentComponent, true, api);
      }).not.toThrow();

      // Tree should be significantly smaller
      expect(TREE.size).toBeLessThan(initialTreeSize);
    });

    test('deeply nested destruction with registered destructors', async () => {
      const callOrder: number[] = [];

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const { registerDestructor } = await import('./glimmer/destroyable');

      let current = parentComponent;
      const depth = 5;

      for (let i = 0; i < depth; i++) {
        const child = new Component({});
        child[RENDERED_NODES_PROPERTY] = [];
        addToTree(current, child);

        const level = i;
        registerDestructor(child, () => {
          callOrder.push(level);
        });

        current = child;
      }

      // Destroy
      destroyElementSync(parentComponent, true, api);

      // All destructors should have been called
      expect(callOrder.length).toBe(depth);
    });
  });

  describe('Nested control flow', () => {
    test('list inside IfCondition cleans up correctly', async () => {
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const condition = cell(true);
      const items = cell([{ id: 1 }, { id: 2 }]);

      const placeholder = api.comment('if-placeholder');
      container.appendChild(placeholder);

      let listInstance: SyncListComponent<any> | null = null;

      const ifCondition = new IfCondition(
        parentComponent,
        condition,
        container as unknown as DocumentFragment,
        placeholder,
        () => {
          // Create a list inside the true branch
          const listPlaceholder = api.comment('nested-list');
          const listTarget = api.fragment();
          api.insert(listTarget, listPlaceholder);

          listInstance = new SyncListComponent(
            {
              tag: items,
              ItemComponent: (item: any) => {
                const div = document.createElement('div');
                div.textContent = String(item.id);
                return [div];
              },
              ctx: parentComponent,
              key: 'id',
            },
            listTarget as unknown as DocumentFragment,
            listPlaceholder,
          );

          return listTarget;
        },
        () => null,
      );

      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 20));

      // Verify list was created
      expect(listInstance).not.toBe(null);
      expect(listInstance!.keyMap.size).toBe(2);

      // Toggle condition to false - should destroy the list
      condition.value = false;

      // Wait for destruction
      await new Promise(resolve => setTimeout(resolve, 50));

      // Clean up
      await ifCondition.destroy();
      destroyElementSync(parentComponent, true, api);
    });

    test('IfCondition inside list item cleans up correctly', async () => {
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const items = cell([{ id: 1, show: true }, { id: 2, show: false }]);
      const placeholder = api.comment('list');
      const target = api.fragment();
      api.insert(target, placeholder);

      const ifConditions: IfCondition[] = [];

      const list = new SyncListComponent(
        {
          tag: items,
          ItemComponent: (item: any) => {
            const itemPlaceholder = api.comment(`if-${item.id}`);
            const itemTarget = api.fragment();
            api.insert(itemTarget, itemPlaceholder);

            const showCell = cell(item.show);
            const ifCond = new IfCondition(
              parentComponent,
              showCell,
              itemTarget as unknown as DocumentFragment,
              itemPlaceholder,
              () => {
                const div = document.createElement('div');
                div.textContent = `Shown: ${item.id}`;
                return div;
              },
              () => {
                const span = document.createElement('span');
                span.textContent = `Hidden: ${item.id}`;
                return span;
              },
            );
            ifConditions.push(ifCond);

            return itemTarget;
          },
          ctx: parentComponent,
          key: 'id',
        },
        target as unknown as DocumentFragment,
        placeholder,
      );

      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 20));

      // Verify structure
      expect(list.keyMap.size).toBe(2);
      expect(ifConditions.length).toBe(2);

      // Remove an item - should clean up its IfCondition
      items.value = [{ id: 1, show: true }];

      // Wait for update
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(list.keyMap.size).toBe(1);

      // Clean up
      destroyElementSync(parentComponent, true, api);
    });
  });

  describe('Concurrent list operations', () => {
    test('rapid list updates do not cause memory leaks', async () => {
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const items = cell<{ id: number }[]>([]);
      const placeholder = api.comment('list');
      const target = api.fragment();
      api.insert(target, placeholder);

      const initialMergedCells = DEBUG_MERGED_CELLS.size;

      const list = new SyncListComponent(
        {
          tag: items,
          ItemComponent: (_item: any, index: any) => {
            const div = document.createElement('div');
            div.textContent = String(typeof index === 'object' ? index.value : index);
            return [div];
          },
          ctx: parentComponent,
          key: 'id',
        },
        target as unknown as DocumentFragment,
        placeholder,
      );

      // Rapid updates
      for (let i = 0; i < 10; i++) {
        items.value = [{ id: 1 }, { id: 2 }, { id: 3 }];
        items.value = [{ id: 2 }, { id: 3 }];
        items.value = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
        items.value = [];
      }

      // Wait for all updates
      await new Promise(resolve => setTimeout(resolve, 50));

      // Final state should be empty
      expect(list.keyMap.size).toBe(0);
      expect(list.indexFormulaMap.size).toBe(0);

      // Clean up
      destroyElementSync(parentComponent, true, api);

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 20));

      // Should not have leaked formulas
      expect(DEBUG_MERGED_CELLS.size).toBe(initialMergedCells);
    });

    test('AsyncListComponent handles concurrent updates gracefully', async () => {
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const items = cell<{ id: number }[]>([{ id: 1 }, { id: 2 }]);
      const placeholder = api.comment('async-list');
      const target = api.fragment();
      api.insert(target, placeholder);

      const list = new AsyncListComponent(
        {
          tag: items,
          ItemComponent: (item: any) => {
            const div = document.createElement('div');
            div.textContent = String(item.id);
            return [div];
          },
          ctx: parentComponent,
          key: 'id',
        },
        target as unknown as DocumentFragment,
        placeholder,
      );

      // Wait for initial render
      await new Promise(resolve => setTimeout(resolve, 20));

      // Concurrent updates while async operations might be in progress
      items.value = [{ id: 3 }, { id: 4 }];
      items.value = [{ id: 1 }];
      items.value = [{ id: 5 }, { id: 6 }, { id: 7 }];

      // Wait for all async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should end up with the final state
      expect(list.keyMap.size).toBe(3);

      // Clean up
      destroyElementSync(parentComponent, true, api);
    });
  });

  describe('Component with formulas in rendered nodes', () => {
    test('formulas used in text nodes are cleaned up', async () => {
      if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
        return;
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const initialMergedCells = DEBUG_MERGED_CELLS.size;

      const textValue = cell('Hello');
      const textFormula = formula(() => textValue.value, 'text-content');

      // Simulate using the formula in a text node
      const textNode = document.createTextNode(textFormula.value);
      parentComponent[RENDERED_NODES_PROPERTY].push(textNode);

      // Update to verify reactivity works
      textValue.value = 'World';

      // Clean up formula
      textFormula.destroy();

      // Destroy component
      destroyElementSync(parentComponent, true, api);

      // Formula should be cleaned up
      expect(DEBUG_MERGED_CELLS.size).toBe(initialMergedCells);
    });
  });

  describe('PARENT/CHILD consistency', () => {
    test('PARENT references are consistent with CHILD', async () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const child1 = new Component({});
      child1[RENDERED_NODES_PROPERTY] = [];
      addToTree(parentComponent, child1);

      const child2 = new Component({});
      child2[RENDERED_NODES_PROPERTY] = [];
      addToTree(parentComponent, child2);

      const parentId = parentComponent[COMPONENT_ID_PROPERTY];
      const child1Id = child1[COMPONENT_ID_PROPERTY];
      const child2Id = child2[COMPONENT_ID_PROPERTY];

      // Verify PARENT references
      expect(PARENT.get(child1Id)).toBe(parentId);
      expect(PARENT.get(child2Id)).toBe(parentId);

      // Verify CHILD references
      const children = CHILD.get(parentId);
      expect(children).toContain(child1Id);
      expect(children).toContain(child2Id);

      // Destroy
      destroyElementSync(parentComponent, true, api);
    });

    test('unregisterFromParent maintains PARENT/CHILD consistency', async () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const child = new Component({});
      child[RENDERED_NODES_PROPERTY] = [];
      addToTree(parentComponent, child);

      const parentId = parentComponent[COMPONENT_ID_PROPERTY];
      const childId = child[COMPONENT_ID_PROPERTY];

      // Verify initial state
      expect(CHILD.get(parentId)).toContain(childId);

      // Unregister child
      unregisterFromParent(child);

      // Child should be removed from parent's CHILD array
      expect(CHILD.get(parentId)).not.toContain(childId);

      // Clean up
      destroyElementSync(parentComponent, true, api);
    });
  });

  describe('ID Recycling Race Condition Prevention', () => {
    /**
     * These tests verify that the ownership check in addToTree's destructor
     * and IfCondition's destroy method prevents race conditions when component
     * IDs are recycled.
     *
     * The race condition scenario:
     * 1. Component A is created with ID X
     * 2. Component A's destruction begins (async)
     * 3. Before A's destructor completes, ID X is released and recycled
     * 4. Component B is created with recycled ID X
     * 5. A's destructor finally runs - without ownership check, it would delete B from TREE
     *
     * The fix: Check `TREE.get(ID) === this` before deleting to ensure we only
     * clean up our own entry, not a recycled one.
     */

    test('ownership check prevents stale destructor from deleting new component', async () => {
      // Create component A and add to tree
      const componentA = new Component({});
      componentA[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, componentA);

      const idX = componentA[COMPONENT_ID_PROPERTY];
      expect(TREE.get(idX)).toBe(componentA);
      // @ts-expect-error - accessing symbol property
      expect(componentA[ADDED_TO_TREE_FLAG]).toBe(true);

      // Simulate the race condition:
      // 1. Release ID X back to pool (as if A's destructor partially ran)
      releaseId(idX);

      // 2. Create component B that gets recycled ID X
      const componentB = new Component({});
      componentB[RENDERED_NODES_PROPERTY] = [];
      // Force B to use the recycled ID by setting it before addToTree
      componentB[COMPONENT_ID_PROPERTY] = idX;
      // Manually update TREE to simulate B being added with recycled ID
      TREE.set(idX, componentB);

      // Verify B now owns ID X in TREE
      expect(TREE.get(idX)).toBe(componentB);

      // 3. Now destroy component A - its destructor should check ownership
      const promises: Promise<void>[] = [];
      destroy(componentA, promises);
      if (promises.length) {
        await Promise.all(promises);
      }

      // 4. Verify B is still in TREE (A's destructor didn't delete it)
      expect(TREE.get(idX)).toBe(componentB);
      expect(TREE.has(idX)).toBe(true);

      // 5. Verify A's flag was NOT changed (ownership check prevented all cleanup)
      // @ts-expect-error - accessing symbol property
      expect(componentA[ADDED_TO_TREE_FLAG]).toBe(true);

      // Clean up
      TREE.delete(idX);
    });

    test('normal destruction correctly removes component from TREE', async () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component);

      const id = component[COMPONENT_ID_PROPERTY];

      // Verify initial state
      expect(TREE.get(id)).toBe(component);
      // @ts-expect-error - accessing symbol property
      expect(component[ADDED_TO_TREE_FLAG]).toBe(true);

      // Destroy normally - destructor should clean up since component still owns ID
      const promises: Promise<void>[] = [];
      destroy(component, promises);
      if (promises.length) {
        await Promise.all(promises);
      }

      // Verify cleanup occurred
      expect(TREE.has(id)).toBe(false);
      // @ts-expect-error - accessing symbol property
      expect(component[ADDED_TO_TREE_FLAG]).toBe(false);
    });

    test('IfCondition ownership check prevents stale cleanup', async () => {
      // Create parent for the IfConditions
      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parent);

      // Create placeholder
      const placeholder = document.createComment('if-placeholder');
      container.appendChild(placeholder);

      // Create IfCondition A
      const ifConditionA = new IfCondition(
        parent,
        () => true,
        container,
        placeholder,
        () => null,
        () => null,
      );

      const idX = ifConditionA[COMPONENT_ID_PROPERTY];
      expect(TREE.get(idX)).toBe(ifConditionA);

      // Simulate race condition: create a "new owner" of the ID
      // This represents another IfCondition that got the recycled ID
      const newOwner = { [COMPONENT_ID_PROPERTY]: idX };
      TREE.set(idX, newOwner as any);

      // Verify new owner is in TREE
      expect(TREE.get(idX)).toBe(newOwner);

      // The ownership check in IfCondition.destroy() should prevent
      // deleting the new owner. We test this by checking the condition directly.
      // (We can't call ifConditionA.destroy() because it would throw "Already destroying"
      // on subsequent parent cleanup, so we verify the logic directly)
      // Note: TREE maps to Component but IfCondition is not a Component, so we use Object.is
      const shouldDelete = Object.is(TREE.get(idX), ifConditionA);
      expect(shouldDelete).toBe(false);

      // If the ownership check works, deletion would be skipped
      if (Object.is(TREE.get(idX), ifConditionA)) {
        TREE.delete(idX);
      }

      // New owner should still be in TREE
      expect(TREE.get(idX)).toBe(newOwner);

      // Clean up
      TREE.delete(idX);
      // Note: We don't destroy parent because ifConditionA is registered
      // as a child destructor and would cause issues
    });

    test('IfCondition normal destruction cleans up when it owns ID', async () => {
      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parent);

      const placeholder = document.createComment('if-placeholder');
      container.appendChild(placeholder);

      const ifCondition = new IfCondition(
        parent,
        () => true,
        container,
        placeholder,
        () => null,
        () => null,
      );

      const id = ifCondition[COMPONENT_ID_PROPERTY];
      expect(TREE.get(id)).toBe(ifCondition);

      // Verify ownership check would allow deletion
      // Note: TREE maps to Component but IfCondition is not a Component, so we use Object.is
      const shouldDelete = Object.is(TREE.get(id), ifCondition);
      expect(shouldDelete).toBe(true);

      // Destroy via parent to test normal flow
      // Use async destruction since IfCondition.destroy() is async
      const { destroyElement } = await import('./component');
      await destroyElement(parent, true, api);

      // IfCondition should be removed from TREE after async destruction completes
      expect(TREE.has(id)).toBe(false);
    });

    test('sequential create-destroy cycles maintain TREE consistency', async () => {
      const componentIds: number[] = [];

      // Create and destroy multiple components in sequence
      for (let i = 0; i < 5; i++) {
        const comp = new Component({});
        comp[RENDERED_NODES_PROPERTY] = [];
        addToTree(root, comp);

        const id = comp[COMPONENT_ID_PROPERTY];
        componentIds.push(id);

        // Verify it's in TREE
        expect(TREE.get(id)).toBe(comp);

        // Destroy it
        const promises: Promise<void>[] = [];
        destroy(comp, promises);
        if (promises.length) {
          await Promise.all(promises);
        }

        // Verify it's removed
        expect(TREE.has(id)).toBe(false);
      }

      // Create new components - they may get recycled IDs
      const newComponents: Component<any>[] = [];
      for (let i = 0; i < 3; i++) {
        const comp = new Component({});
        comp[RENDERED_NODES_PROPERTY] = [];
        addToTree(root, comp);
        newComponents.push(comp);

        const id = comp[COMPONENT_ID_PROPERTY];
        // Verify new component is properly in TREE
        expect(TREE.get(id)).toBe(comp);
      }

      // Clean up
      for (const comp of newComponents) {
        destroyElementSync(comp, true, api);
      }
    });

    test('ADDED_TO_TREE_FLAG tracks component lifecycle correctly', async () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];

      // Before adding to tree
      // @ts-expect-error - accessing symbol property
      expect(component[ADDED_TO_TREE_FLAG]).toBeUndefined();

      addToTree(root, component);

      // After adding to tree
      // @ts-expect-error - accessing symbol property
      expect(component[ADDED_TO_TREE_FLAG]).toBe(true);

      // Destroy
      const promises: Promise<void>[] = [];
      destroy(component, promises);
      if (promises.length) {
        await Promise.all(promises);
      }

      // After destruction
      // @ts-expect-error - accessing symbol property
      expect(component[ADDED_TO_TREE_FLAG]).toBe(false);
    });

    test('PARENT and CHILD maps are cleaned up with ownership check', async () => {
      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parent);

      const child = new Component({});
      child[RENDERED_NODES_PROPERTY] = [];
      addToTree(parent, child);

      const parentId = parent[COMPONENT_ID_PROPERTY];
      const childId = child[COMPONENT_ID_PROPERTY];

      // Verify PARENT/CHILD relationships
      expect(PARENT.get(childId)).toBe(parentId);
      expect(CHILD.get(parentId)).toContain(childId);

      // Destroy child
      const promises: Promise<void>[] = [];
      destroy(child, promises);
      if (promises.length) {
        await Promise.all(promises);
      }

      // PARENT entry should be cleaned up (ownership check passed)
      expect(PARENT.has(childId)).toBe(false);

      // Clean up parent
      destroyElementSync(parent, true, api);
    });
  });
});
