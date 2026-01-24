import { expect, test, describe, beforeEach, afterEach, vi } from 'vitest';
import { Window } from 'happy-dom';
import { createHotReload } from './hmr';
import { Component } from './component';
import { HTMLBrowserDOMApi, DOMApi } from './dom-api';
import {
  RENDERED_NODES_PROPERTY,
  PARENT,
  TREE,
  CHILD,
  addToTree,
  COMPONENTS_HMR,
  IFS_FOR_HMR,
  LISTS_FOR_HMR,
} from './shared';
import { cleanupFastContext, provideContext, RENDERING_CONTEXT } from './context';
import { Root } from './dom';

describe('createHotReload', () => {
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
    // Clear HMR structures
    COMPONENTS_HMR.delete = vi.fn(COMPONENTS_HMR.delete.bind(COMPONENTS_HMR));
    IFS_FOR_HMR.clear();
    LISTS_FOR_HMR.clear();
  });

  afterEach(() => {
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    IFS_FOR_HMR.clear();
    LISTS_FOR_HMR.clear();
    window.close();
  });

  describe('factory function', () => {
    test('returns a hotReload function', () => {
      const componentFn = vi.fn();
      const hotReload = createHotReload(componentFn);
      expect(typeof hotReload).toBe('function');
    });

    test('returned function has correct signature', () => {
      const componentFn = vi.fn();
      const hotReload = createHotReload(componentFn);
      expect(hotReload.length).toBe(2); // takes oldKlass and newKlass
    });
  });

  describe('hotReload function', () => {
    test('returns early when no rendered instances exist', () => {
      const componentFn = vi.fn();
      const hotReload = createHotReload(componentFn);

      class OldComponent {}
      class NewComponent {}

      // Call without registering any instances
      hotReload(OldComponent as any, NewComponent as any);

      // componentFn should not be called since there are no instances
      expect(componentFn).not.toHaveBeenCalled();
    });

    test('creates new component for each rendered instance', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      const instance = new Component({});
      instance[RENDERED_NODES_PROPERTY] = [document.createElement('div')];
      container.appendChild(instance[RENDERED_NODES_PROPERTY][0] as Node);
      addToTree(parentComponent, instance);

      // Register the instance in COMPONENTS_HMR
      const instanceSet = new Set([{
        parent: parentComponent,
        instance: instance,
        args: { foo: 'bar' },
        tags: [],
      }]);
      COMPONENTS_HMR.set(OldComponent as any, instanceSet);

      const newInstance = new Component({});
      newInstance[RENDERED_NODES_PROPERTY] = [];

      const componentFn = vi.fn().mockReturnValue(newInstance);
      const hotReload = createHotReload(componentFn);

      hotReload(OldComponent as any, NewComponent as any);

      expect(componentFn).toHaveBeenCalledWith(
        NewComponent,
        { foo: 'bar' },
        parentComponent
      );
    });

    test('cleans up COMPONENTS_HMR entry after reload', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      const instance = new Component({});
      instance[RENDERED_NODES_PROPERTY] = [document.createElement('div')];
      container.appendChild(instance[RENDERED_NODES_PROPERTY][0] as Node);
      addToTree(parentComponent, instance);

      const instanceSet = new Set([{
        parent: parentComponent,
        instance: instance,
        args: {},
        tags: [],
      }]);
      COMPONENTS_HMR.set(OldComponent as any, instanceSet);

      const newInstance = new Component({});
      newInstance[RENDERED_NODES_PROPERTY] = [];

      const componentFn = vi.fn().mockReturnValue(newInstance);
      const hotReload = createHotReload(componentFn);

      hotReload(OldComponent as any, NewComponent as any);

      // The delete should have been called
      expect(COMPONENTS_HMR.delete).toHaveBeenCalledWith(OldComponent);
    });

    test('handles multiple instances of the same component', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      const instance1 = new Component({});
      instance1[RENDERED_NODES_PROPERTY] = [document.createElement('div')];
      container.appendChild(instance1[RENDERED_NODES_PROPERTY][0] as Node);
      addToTree(parentComponent, instance1);

      const instance2 = new Component({});
      instance2[RENDERED_NODES_PROPERTY] = [document.createElement('span')];
      container.appendChild(instance2[RENDERED_NODES_PROPERTY][0] as Node);
      addToTree(parentComponent, instance2);

      const instanceSet = new Set([
        { parent: parentComponent, instance: instance1, args: { id: 1 }, tags: [] },
        { parent: parentComponent, instance: instance2, args: { id: 2 }, tags: [] },
      ]);
      COMPONENTS_HMR.set(OldComponent as any, instanceSet);

      let callCount = 0;
      const componentFn = vi.fn().mockImplementation(() => {
        const newInst = new Component({});
        newInst[RENDERED_NODES_PROPERTY] = [];
        callCount++;
        return newInst;
      });

      const hotReload = createHotReload(componentFn);
      hotReload(OldComponent as any, NewComponent as any);

      expect(componentFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('IFS_FOR_HMR integration', () => {
    test('updates IFS_FOR_HMR when instance matches directly', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      const instance = new Component({});
      instance[RENDERED_NODES_PROPERTY] = [document.createElement('div')];
      container.appendChild(instance[RENDERED_NODES_PROPERTY][0] as Node);
      addToTree(parentComponent, instance);

      const instanceSet = new Set([{
        parent: parentComponent,
        instance: instance,
        args: {},
        tags: [],
      }]);
      COMPONENTS_HMR.set(OldComponent as any, instanceSet);

      const setFn = vi.fn();
      IFS_FOR_HMR.add(() => ({ item: instance, set: setFn }));

      const newInstance = new Component({});
      newInstance[RENDERED_NODES_PROPERTY] = [];

      const componentFn = vi.fn().mockReturnValue(newInstance);
      const hotReload = createHotReload(componentFn);

      hotReload(OldComponent as any, NewComponent as any);

      expect(setFn).toHaveBeenCalledWith(newInstance);
    });

    test('updates IFS_FOR_HMR when instance is in array', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      const instance = new Component({});
      instance[RENDERED_NODES_PROPERTY] = [document.createElement('div')];
      container.appendChild(instance[RENDERED_NODES_PROPERTY][0] as Node);
      addToTree(parentComponent, instance);

      const otherComponent = new Component({});
      const scopesArray = [otherComponent, instance];

      const instanceSet = new Set([{
        parent: parentComponent,
        instance: instance,
        args: {},
        tags: [],
      }]);
      COMPONENTS_HMR.set(OldComponent as any, instanceSet);

      const setFn = vi.fn();
      IFS_FOR_HMR.add(() => ({ item: scopesArray, set: setFn }));

      const newInstance = new Component({});
      newInstance[RENDERED_NODES_PROPERTY] = [];

      const componentFn = vi.fn().mockReturnValue(newInstance);
      const hotReload = createHotReload(componentFn);

      hotReload(OldComponent as any, NewComponent as any);

      // The array should have been modified in place
      expect(scopesArray[1]).toBe(newInstance);
      expect(setFn).toHaveBeenCalledWith(scopesArray);
    });
  });

  describe('LISTS_FOR_HMR integration', () => {
    test('updates LISTS_FOR_HMR when instance is in keyMap array', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      const instance = new Component({});
      instance[RENDERED_NODES_PROPERTY] = [document.createElement('div')];
      container.appendChild(instance[RENDERED_NODES_PROPERTY][0] as Node);
      addToTree(parentComponent, instance);

      const instanceSet = new Set([{
        parent: parentComponent,
        instance: instance,
        args: {},
        tags: [],
      }]);
      COMPONENTS_HMR.set(OldComponent as any, instanceSet);

      // Create a mock list component with keyMap
      const lineItems = [instance];
      const keyMap = new Map([['key1', lineItems]]);
      const mockList = { keyMap } as any;
      LISTS_FOR_HMR.add(mockList);

      const newInstance = new Component({});
      newInstance[RENDERED_NODES_PROPERTY] = [];

      const componentFn = vi.fn().mockReturnValue(newInstance);
      const hotReload = createHotReload(componentFn);

      hotReload(OldComponent as any, NewComponent as any);

      // The array should have been modified
      expect(lineItems[0]).toBe(newInstance);
    });

    test('updates LISTS_FOR_HMR when instance is single item in keyMap', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      const instance = new Component({});
      instance[RENDERED_NODES_PROPERTY] = [document.createElement('div')];
      container.appendChild(instance[RENDERED_NODES_PROPERTY][0] as Node);
      addToTree(parentComponent, instance);

      const instanceSet = new Set([{
        parent: parentComponent,
        instance: instance,
        args: {},
        tags: [],
      }]);
      COMPONENTS_HMR.set(OldComponent as any, instanceSet);

      // Create a mock list component with keyMap (single value, not array)
      const keyMap = new Map([['key1', instance]]);
      const mockList = { keyMap } as any;
      LISTS_FOR_HMR.add(mockList);

      const newInstance = new Component({});
      newInstance[RENDERED_NODES_PROPERTY] = [];

      const componentFn = vi.fn().mockReturnValue(newInstance);
      const hotReload = createHotReload(componentFn);

      hotReload(OldComponent as any, NewComponent as any);

      // The keyMap entry should have been updated
      expect(keyMap.get('key1')).toBe(newInstance);
    });
  });

  describe('tag preservation', () => {
    test('preserves tag values when tag counts match', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      const instance = new Component({});
      instance[RENDERED_NODES_PROPERTY] = [document.createElement('div')];
      container.appendChild(instance[RENDERED_NODES_PROPERTY][0] as Node);
      addToTree(parentComponent, instance);

      const oldTag = { _debugName: 'count', _value: 42, value: 42 };
      const instanceSet = new Set([{
        parent: parentComponent,
        instance: instance,
        args: {},
        tags: [oldTag] as any[],
      }]);
      COMPONENTS_HMR.set(OldComponent as any, instanceSet);

      const newInstance = new Component({});
      newInstance[RENDERED_NODES_PROPERTY] = [];

      const newTag = { _debugName: 'count', _value: 0, value: 0 };

      const componentFn = vi.fn().mockReturnValue(newInstance);
      const hotReload = createHotReload(componentFn);

      // Register the new instance with its tag
      const newInstanceSet = new Set([{
        parent: parentComponent,
        instance: newInstance,
        args: {},
        tags: [newTag] as any[],
      }]);
      COMPONENTS_HMR.set(NewComponent as any, newInstanceSet);

      hotReload(OldComponent as any, NewComponent as any);

      // The new tag should have received the old tag's value
      expect(newTag.value).toBe(42);
    });
  });

  describe('edge cases', () => {
    test('handles empty instance set gracefully', () => {
      class OldComponent {}
      class NewComponent {}

      COMPONENTS_HMR.set(OldComponent as any, new Set());

      const componentFn = vi.fn();
      const hotReload = createHotReload(componentFn);

      // Should not throw
      expect(() => hotReload(OldComponent as any, NewComponent as any)).not.toThrow();
      expect(componentFn).not.toHaveBeenCalled();
    });

    test('skips instance when parentElement is null', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      // Create instance with orphaned node (no parent)
      const instance = new Component({});
      const orphanedNode = document.createElement('div');
      // Don't append to container - it has no parent
      instance[RENDERED_NODES_PROPERTY] = [orphanedNode];
      addToTree(parentComponent, instance);

      const instanceSet = new Set([{
        parent: parentComponent,
        instance: instance,
        args: { foo: 'bar' },
        tags: [],
      }]);
      COMPONENTS_HMR.set(OldComponent as any, instanceSet);

      const newInstance = new Component({});
      newInstance[RENDERED_NODES_PROPERTY] = [];

      const componentFn = vi.fn().mockReturnValue(newInstance);
      const hotReload = createHotReload(componentFn);

      // Should not throw even when parentElement is null
      expect(() => hotReload(OldComponent as any, NewComponent as any)).not.toThrow();
    });

    test('handles IFS_FOR_HMR with RENDERED_NODES_PROPERTY scope', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      const instance = new Component({});
      instance[RENDERED_NODES_PROPERTY] = [document.createElement('div')];
      container.appendChild(instance[RENDERED_NODES_PROPERTY][0] as Node);
      addToTree(parentComponent, instance);

      const instanceSet = new Set([{
        parent: parentComponent,
        instance: instance,
        args: {},
        tags: [],
      }]);
      COMPONENTS_HMR.set(OldComponent as any, instanceSet);

      // Create a scope object with RENDERED_NODES_PROPERTY containing the instance
      const scopeWithNodes = new Component({});
      // In HMR, RENDERED_NODES_PROPERTY can contain Component instances
      scopeWithNodes[RENDERED_NODES_PROPERTY] = [instance as unknown as Node];

      const setFn = vi.fn();
      IFS_FOR_HMR.add(() => ({ item: scopeWithNodes, set: setFn }));

      const newInstance = new Component({});
      newInstance[RENDERED_NODES_PROPERTY] = [];

      const componentFn = vi.fn().mockReturnValue(newInstance);
      const hotReload = createHotReload(componentFn);

      hotReload(OldComponent as any, NewComponent as any);

      // The RENDERED_NODES_PROPERTY should have been updated
      expect(scopeWithNodes[RENDERED_NODES_PROPERTY][0]).toBe(newInstance);
      expect(setFn).toHaveBeenCalledWith(scopeWithNodes);
    });
  });
});
