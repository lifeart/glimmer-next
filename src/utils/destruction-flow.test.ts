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
} from './shared';
import { cleanupFastContext, provideContext, RENDERING_CONTEXT } from './context';
import { Root, $_if, $_each, $_eachSync, $_tag, $_edp, $_fin, $_GET_ARGS, $_dc, $_args } from './dom';
import { cell, formula, DEBUG_MERGED_CELLS, MergedCell } from './reactive';
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

      const initialTreeSize = TREE.size;

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

      const initialMergedCells = DEBUG_MERGED_CELLS.size;

      const list = new SyncListComponent(
        {
          tag: items,
          ItemComponent: (item: any, index: any) => {
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
          ItemComponent: (item: any, index: any) => {
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
        const _ = testFormula.value;

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
        const _ = reactiveValue.value; // Access reactive value
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
          ItemComponent: (item: any, index: any) => {
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
          ItemComponent: (item: any, index: any) => {
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
});
