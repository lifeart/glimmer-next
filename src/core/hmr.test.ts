import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { createHotReload } from './hmr';
import { Component } from './component';
import {
  RENDERED_NODES_PROPERTY,
  addToTree,
  COMPONENTS_HMR,
  IFS_FOR_HMR,
  LISTS_FOR_HMR,
} from './shared';
import { createDOMFixture, type DOMFixture } from './__test-utils__';

describe('createHotReload', () => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
    // Clear HMR structures
    IFS_FOR_HMR.clear();
    LISTS_FOR_HMR.clear();
  });

  afterEach(() => {
    fixture.cleanup();
    IFS_FOR_HMR.clear();
    LISTS_FOR_HMR.clear();
  });

  describe('factory function', () => {
    test('returns a hotReload function', () => {
      const componentFn = () => new Component({});
      const hotReload = createHotReload(componentFn);
      expect(typeof hotReload).toBe('function');
    });

    test('returned function has correct signature', () => {
      const componentFn = () => new Component({});
      const hotReload = createHotReload(componentFn);
      expect(hotReload.length).toBe(2); // takes oldKlass and newKlass
    });
  });

  describe('hotReload function', () => {
    test('returns early when no rendered instances exist', () => {
      let componentFnCalls = 0;
      const componentFn = () => {
        componentFnCalls++;
        return new Component({});
      };
      const hotReload = createHotReload(componentFn);

      class OldComponent {}
      class NewComponent {}

      // Call without registering any instances
      hotReload(OldComponent as any, NewComponent as any);

      // componentFn should not be called since there are no instances
      expect(componentFnCalls).toBe(0);
    });

    test('creates new component for each rendered instance', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      const instance = new Component({});
      instance[RENDERED_NODES_PROPERTY] = [fixture.document.createElement('div')];
      fixture.container.appendChild(instance[RENDERED_NODES_PROPERTY][0] as Node);
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

      let receivedArgs: unknown[] = [];
      const componentFn = (...args: unknown[]) => {
        receivedArgs = args;
        return newInstance;
      };
      const hotReload = createHotReload(componentFn);

      hotReload(OldComponent as any, NewComponent as any);

      expect(receivedArgs).toEqual([
        NewComponent,
        { foo: 'bar' },
        parentComponent,
      ]);
    });

    test('cleans up COMPONENTS_HMR entry after reload', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      const instance = new Component({});
      instance[RENDERED_NODES_PROPERTY] = [fixture.document.createElement('div')];
      fixture.container.appendChild(instance[RENDERED_NODES_PROPERTY][0] as Node);
      addToTree(parentComponent, instance);

      const instanceSet = new Set([{
        parent: parentComponent,
        instance: instance,
        args: {},
        tags: [],
      }]);
      COMPONENTS_HMR.set(OldComponent as any, instanceSet);

      expect(COMPONENTS_HMR.has(OldComponent as any)).toBe(true);

      const newInstance = new Component({});
      newInstance[RENDERED_NODES_PROPERTY] = [];

      const componentFn = () => newInstance;
      const hotReload = createHotReload(componentFn);

      hotReload(OldComponent as any, NewComponent as any);

      // The entry should have been deleted
      expect(COMPONENTS_HMR.has(OldComponent as any)).toBe(false);
    });

    test('handles multiple instances of the same component', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      const instance1 = new Component({});
      instance1[RENDERED_NODES_PROPERTY] = [fixture.document.createElement('div')];
      fixture.container.appendChild(instance1[RENDERED_NODES_PROPERTY][0] as Node);
      addToTree(parentComponent, instance1);

      const instance2 = new Component({});
      instance2[RENDERED_NODES_PROPERTY] = [fixture.document.createElement('span')];
      fixture.container.appendChild(instance2[RENDERED_NODES_PROPERTY][0] as Node);
      addToTree(parentComponent, instance2);

      const instanceSet = new Set([
        { parent: parentComponent, instance: instance1, args: { id: 1 }, tags: [] },
        { parent: parentComponent, instance: instance2, args: { id: 2 }, tags: [] },
      ]);
      COMPONENTS_HMR.set(OldComponent as any, instanceSet);

      let callCount = 0;
      const componentFn = () => {
        const newInst = new Component({});
        newInst[RENDERED_NODES_PROPERTY] = [];
        callCount++;
        return newInst;
      };

      const hotReload = createHotReload(componentFn);
      hotReload(OldComponent as any, NewComponent as any);

      expect(callCount).toBe(2);
    });
  });

  describe('IFS_FOR_HMR integration', () => {
    test('updates IFS_FOR_HMR when instance matches directly', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      const instance = new Component({});
      instance[RENDERED_NODES_PROPERTY] = [fixture.document.createElement('div')];
      fixture.container.appendChild(instance[RENDERED_NODES_PROPERTY][0] as Node);
      addToTree(parentComponent, instance);

      const instanceSet = new Set([{
        parent: parentComponent,
        instance: instance,
        args: {},
        tags: [],
      }]);
      COMPONENTS_HMR.set(OldComponent as any, instanceSet);

      let setFnCalledWith: unknown = undefined;
      const setFn = (value: unknown) => { setFnCalledWith = value; };
      IFS_FOR_HMR.add(() => ({ item: instance, set: setFn }));

      const newInstance = new Component({});
      newInstance[RENDERED_NODES_PROPERTY] = [];

      const componentFn = () => newInstance;
      const hotReload = createHotReload(componentFn);

      hotReload(OldComponent as any, NewComponent as any);

      expect(setFnCalledWith).toBe(newInstance);
    });

    test('updates IFS_FOR_HMR when instance is in array', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      const instance = new Component({});
      instance[RENDERED_NODES_PROPERTY] = [fixture.document.createElement('div')];
      fixture.container.appendChild(instance[RENDERED_NODES_PROPERTY][0] as Node);
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

      let setFnCalledWith: unknown = undefined;
      const setFn = (value: unknown) => { setFnCalledWith = value; };
      IFS_FOR_HMR.add(() => ({ item: scopesArray, set: setFn }));

      const newInstance = new Component({});
      newInstance[RENDERED_NODES_PROPERTY] = [];

      const componentFn = () => newInstance;
      const hotReload = createHotReload(componentFn);

      hotReload(OldComponent as any, NewComponent as any);

      // The array should have been modified in place
      expect(scopesArray[1]).toBe(newInstance);
      expect(setFnCalledWith).toBe(scopesArray);
    });
  });

  describe('LISTS_FOR_HMR integration', () => {
    test('updates LISTS_FOR_HMR when instance is in keyMap array', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      const instance = new Component({});
      instance[RENDERED_NODES_PROPERTY] = [fixture.document.createElement('div')];
      fixture.container.appendChild(instance[RENDERED_NODES_PROPERTY][0] as Node);
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

      const componentFn = () => newInstance;
      const hotReload = createHotReload(componentFn);

      hotReload(OldComponent as any, NewComponent as any);

      // The array should have been modified
      expect(lineItems[0]).toBe(newInstance);
    });

    test('updates LISTS_FOR_HMR when instance is single item in keyMap', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      const instance = new Component({});
      instance[RENDERED_NODES_PROPERTY] = [fixture.document.createElement('div')];
      fixture.container.appendChild(instance[RENDERED_NODES_PROPERTY][0] as Node);
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

      const componentFn = () => newInstance;
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
      addToTree(fixture.root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      const instance = new Component({});
      instance[RENDERED_NODES_PROPERTY] = [fixture.document.createElement('div')];
      fixture.container.appendChild(instance[RENDERED_NODES_PROPERTY][0] as Node);
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

      const componentFn = () => newInstance;
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

      let componentFnCalls = 0;
      const componentFn = () => {
        componentFnCalls++;
        return new Component({});
      };
      const hotReload = createHotReload(componentFn);

      // Should not throw
      expect(() => hotReload(OldComponent as any, NewComponent as any)).not.toThrow();
      expect(componentFnCalls).toBe(0);
    });

    test('skips instance when parentElement is null', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      // Create instance with orphaned node (no parent)
      const instance = new Component({});
      const orphanedNode = fixture.document.createElement('div');
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

      const componentFn = () => newInstance;
      const hotReload = createHotReload(componentFn);

      // Should not throw even when parentElement is null
      expect(() => hotReload(OldComponent as any, NewComponent as any)).not.toThrow();
    });

    test('handles IFS_FOR_HMR with RENDERED_NODES_PROPERTY scope', () => {
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, parentComponent);

      class OldComponent {}
      class NewComponent {}

      const instance = new Component({});
      instance[RENDERED_NODES_PROPERTY] = [fixture.document.createElement('div')];
      fixture.container.appendChild(instance[RENDERED_NODES_PROPERTY][0] as Node);
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

      let setFnCalledWith: unknown = undefined;
      const setFn = (value: unknown) => { setFnCalledWith = value; };
      IFS_FOR_HMR.add(() => ({ item: scopeWithNodes, set: setFn }));

      const newInstance = new Component({});
      newInstance[RENDERED_NODES_PROPERTY] = [];

      const componentFn = () => newInstance;
      const hotReload = createHotReload(componentFn);

      hotReload(OldComponent as any, NewComponent as any);

      // The RENDERED_NODES_PROPERTY should have been updated
      expect(scopeWithNodes[RENDERED_NODES_PROPERTY][0]).toBe(newInstance);
      expect(setFnCalledWith).toBe(scopeWithNodes);
    });
  });
});
