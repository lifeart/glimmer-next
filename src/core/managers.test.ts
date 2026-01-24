import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import {
  $_MANAGERS,
  tryComponentManager,
  tryHelperManager,
  tryModifierManager,
} from './manager-integration';

/**
 * Helper to save and restore $_MANAGERS state between tests.
 * Prevents test pollution when tests override manager methods.
 */
function createManagerSaveRestore() {
  let originalComponentCanHandle: typeof $_MANAGERS.component.canHandle;
  let originalComponentHandle: typeof $_MANAGERS.component.handle;
  let originalHelperCanHandle: typeof $_MANAGERS.helper.canHandle;
  let originalHelperHandle: typeof $_MANAGERS.helper.handle;
  let originalModifierCanHandle: typeof $_MANAGERS.modifier.canHandle;
  let originalModifierHandle: typeof $_MANAGERS.modifier.handle;

  return {
    save() {
      originalComponentCanHandle = $_MANAGERS.component.canHandle;
      originalComponentHandle = $_MANAGERS.component.handle;
      originalHelperCanHandle = $_MANAGERS.helper.canHandle;
      originalHelperHandle = $_MANAGERS.helper.handle;
      originalModifierCanHandle = $_MANAGERS.modifier.canHandle;
      originalModifierHandle = $_MANAGERS.modifier.handle;
    },
    restore() {
      $_MANAGERS.component.canHandle = originalComponentCanHandle;
      $_MANAGERS.component.handle = originalComponentHandle;
      $_MANAGERS.helper.canHandle = originalHelperCanHandle;
      $_MANAGERS.helper.handle = originalHelperHandle;
      $_MANAGERS.modifier.canHandle = originalModifierCanHandle;
      $_MANAGERS.modifier.handle = originalModifierHandle;
    },
  };
}

/**
 * Tests for the $_MANAGERS extensibility point.
 *
 * $_MANAGERS allows external code (like Ember integration) to provide
 * custom component, helper, and modifier managers that can intercept
 * and handle these primitives before the default behavior runs.
 *
 * Note: The managers are only invoked when WITH_EMBER_INTEGRATION is true
 * (a compile-time constant, default false). These tests verify the manager
 * infrastructure can be overridden correctly, but don't test the actual
 * integration paths in dom.ts since WITH_EMBER_INTEGRATION is false in tests.
 */
describe('$_MANAGERS extensibility', () => {
  const managerState = createManagerSaveRestore();

  beforeEach(() => managerState.save());
  afterEach(() => managerState.restore());

  describe('$_MANAGERS structure', () => {
    test('exports $_MANAGERS object', () => {
      expect($_MANAGERS).toBeDefined();
      expect(typeof $_MANAGERS).toBe('object');
    });

    test('has component manager', () => {
      expect($_MANAGERS.component).toBeDefined();
      expect(typeof $_MANAGERS.component.canHandle).toBe('function');
      expect(typeof $_MANAGERS.component.handle).toBe('function');
    });

    test('has helper manager', () => {
      expect($_MANAGERS.helper).toBeDefined();
      expect(typeof $_MANAGERS.helper.canHandle).toBe('function');
      expect(typeof $_MANAGERS.helper.handle).toBe('function');
    });

    test('has modifier manager', () => {
      expect($_MANAGERS.modifier).toBeDefined();
      expect(typeof $_MANAGERS.modifier.canHandle).toBe('function');
      expect(typeof $_MANAGERS.modifier.handle).toBe('function');
    });
  });

  describe('default manager behavior', () => {
    test('component.canHandle returns false by default', () => {
      expect($_MANAGERS.component.canHandle({})).toBe(false);
      expect($_MANAGERS.component.canHandle(class {})).toBe(false);
      expect($_MANAGERS.component.canHandle(() => {})).toBe(false);
    });

    test('helper.canHandle returns false by default', () => {
      expect($_MANAGERS.helper.canHandle({})).toBe(false);
      expect($_MANAGERS.helper.canHandle(() => {})).toBe(false);
    });

    test('modifier.canHandle returns false by default', () => {
      expect($_MANAGERS.modifier.canHandle({})).toBe(false);
      expect($_MANAGERS.modifier.canHandle(() => {})).toBe(false);
    });

    test('component.handle returns undefined by default', () => {
      expect($_MANAGERS.component.handle({}, {}, [], {})).toBeUndefined();
    });

    test('helper.handle returns undefined by default', () => {
      expect($_MANAGERS.helper.handle(() => {}, [], {})).toBeUndefined();
    });

    test('modifier.handle returns undefined by default', () => {
      const window = new Window();
      const document = window.document;
      try {
        expect($_MANAGERS.modifier.handle(() => {}, document.createElement('div') as unknown as Element, [], () => ({}))).toBeUndefined();
      } finally {
        window.close();
      }
    });

    test('canHandle handles null and undefined gracefully', () => {
      // Default implementations should not throw on null/undefined
      expect($_MANAGERS.component.canHandle(null)).toBe(false);
      expect($_MANAGERS.component.canHandle(undefined)).toBe(false);
      expect($_MANAGERS.helper.canHandle(null)).toBe(false);
      expect($_MANAGERS.helper.canHandle(undefined)).toBe(false);
      expect($_MANAGERS.modifier.canHandle(null)).toBe(false);
      expect($_MANAGERS.modifier.canHandle(undefined)).toBe(false);
    });
  });

  describe('component manager override', () => {
    test('can override canHandle to detect custom components', () => {
      const CUSTOM_COMPONENT_MARKER = Symbol('custom-component');

      $_MANAGERS.component.canHandle = (component: unknown) => {
        return component !== null && typeof component === 'object' && CUSTOM_COMPONENT_MARKER in component && (component as Record<symbol, unknown>)[CUSTOM_COMPONENT_MARKER] === true;
      };

      const regularComponent = {};
      const customComponent = { [CUSTOM_COMPONENT_MARKER]: true };

      expect($_MANAGERS.component.canHandle(regularComponent)).toBe(false);
      expect($_MANAGERS.component.canHandle(customComponent)).toBe(true);
    });

    test('can override handle to return custom component instance', () => {
      const CUSTOM_COMPONENT_MARKER = Symbol('custom-component');
      const handledComponents: unknown[] = [];

      $_MANAGERS.component.canHandle = (component: unknown) => {
        return component !== null && typeof component === 'object' && CUSTOM_COMPONENT_MARKER in component && component[CUSTOM_COMPONENT_MARKER] === true;
      };

      $_MANAGERS.component.handle = (component: unknown, args: unknown, fw: unknown, ctx: unknown) => {
        handledComponents.push({ component, args, fw, ctx });
        // Return a wrapped component
        return { wrapped: true, original: component } as any;
      };

      const customComponent = { [CUSTOM_COMPONENT_MARKER]: true, name: 'MyComponent' };
      const args = { foo: 'bar' };
      const fw: unknown[] = [];
      const ctx = {};

      // Verify canHandle returns true for our custom component
      expect($_MANAGERS.component.canHandle(customComponent)).toBe(true);

      const result = $_MANAGERS.component.handle(customComponent, args, fw, ctx);
      expect(result).toEqual({ wrapped: true, original: customComponent });
      expect(handledComponents).toHaveLength(1);
      expect((handledComponents[0] as { component: unknown }).component).toBe(customComponent);
      expect((handledComponents[0] as { args: unknown }).args).toBe(args);
    });
  });

  describe('helper manager override', () => {
    test('can override canHandle to detect custom helpers', () => {
      const isCustomHelper = (helper: unknown) => {
        return helper !== null && typeof helper === 'object' && 'isHelper' in helper && (helper as { isHelper: unknown }).isHelper === true;
      };

      $_MANAGERS.helper.canHandle = isCustomHelper;

      expect($_MANAGERS.helper.canHandle({ isHelper: true })).toBe(true);
      expect($_MANAGERS.helper.canHandle({ isHelper: false })).toBe(false);
      expect($_MANAGERS.helper.canHandle(() => {})).toBe(false);
    });

    test('can override handle to execute custom helper logic', () => {
      const HELPER_MARKER = Symbol('helper');

      $_MANAGERS.helper.canHandle = (helper: unknown) => {
        return helper !== null && typeof helper === 'object' && HELPER_MARKER in helper && (helper as Record<symbol, unknown>)[HELPER_MARKER] === true;
      };

      $_MANAGERS.helper.handle = (helper: unknown, params: unknown[], hash: unknown) => {
        // Custom helper execution
        return (helper as { compute: (p: unknown[], h: unknown) => string }).compute(params, hash);
      };

      const customHelper = {
        [HELPER_MARKER]: true,
        compute(params: unknown[], hash: Record<string, unknown>) {
          return (params as string[]).join('-') + ((hash.suffix as string) || '');
        },
      };

      // Verify canHandle returns true
      expect($_MANAGERS.helper.canHandle(customHelper)).toBe(true);

      const result = $_MANAGERS.helper.handle(customHelper, ['a', 'b', 'c'], { suffix: '!' });
      expect(result).toBe('a-b-c!');
    });
  });

  describe('modifier manager override', () => {
    test('can override canHandle to detect custom modifiers', () => {
      const MODIFIER_MARKER = Symbol('modifier');

      $_MANAGERS.modifier.canHandle = (modifier: unknown) => {
        return modifier !== null && typeof modifier === 'object' && MODIFIER_MARKER in modifier && (modifier as Record<symbol, unknown>)[MODIFIER_MARKER] === true;
      };

      expect($_MANAGERS.modifier.canHandle({ [MODIFIER_MARKER]: true })).toBe(true);
      expect($_MANAGERS.modifier.canHandle({ [MODIFIER_MARKER]: false })).toBe(false);
      expect($_MANAGERS.modifier.canHandle(() => {})).toBe(false);
    });

    test('can override handle to execute custom modifier logic', () => {
      const window = new Window();
      const document = window.document;
      const MODIFIER_MARKER = Symbol('modifier');
      const modifiedElements: Element[] = [];

      try {
        $_MANAGERS.modifier.canHandle = (modifier: unknown) => {
          return modifier !== null && typeof modifier === 'object' && MODIFIER_MARKER in modifier && (modifier as Record<symbol, unknown>)[MODIFIER_MARKER] === true;
        };

        $_MANAGERS.modifier.handle = (_modifier: unknown, element: Element, _props: unknown[], hashFn: () => Record<string, unknown>) => {
          modifiedElements.push(element);
          const hash = hashFn();
          // Apply custom modifier
          if (hash.class) {
            (element as HTMLElement).classList.add(hash.class as string);
          }
          // Return destructor
          return () => {
            if (hash.class) {
              (element as HTMLElement).classList.remove(hash.class as string);
            }
          };
        };

        const customModifier = { [MODIFIER_MARKER]: true };
        const element = document.createElement('div') as unknown as HTMLElement;

        // Verify canHandle returns true
        expect($_MANAGERS.modifier.canHandle(customModifier)).toBe(true);

        const destructor = $_MANAGERS.modifier.handle(
          customModifier,
          element,
          [],
          () => ({ class: 'custom-class' })
        );

        expect(modifiedElements).toContain(element);
        expect(element.classList.contains('custom-class')).toBe(true);

        // Verify destructor is returned
        expect(typeof destructor).toBe('function');

        // Call destructor
        (destructor as () => void)();
        expect(element.classList.contains('custom-class')).toBe(false);
      } finally {
        window.close();
      }
    });
  });

  describe('Ember-style component manager integration', () => {
    test('can implement Ember-style component manager pattern', () => {
      // Simulate Ember's component manager pattern
      const COMPONENT_MANAGER = Symbol('component-manager');

      interface ComponentManager {
        createComponent(component: unknown, args: unknown): unknown;
        getContext(instance: unknown): unknown;
      }

      interface EmberLikeComponent {
        [key: symbol]: ComponentManager;
        template: string;
      }

      $_MANAGERS.component.canHandle = (component: unknown): component is EmberLikeComponent => {
        return component !== null && typeof component === 'object' && COMPONENT_MANAGER in component;
      };

      $_MANAGERS.component.handle = (component: unknown, args: unknown, _fw: unknown, _ctx: unknown) => {
        const manager = (component as Record<symbol, ComponentManager>)[COMPONENT_MANAGER];
        const instance = manager.createComponent(component, args);
        return manager.getContext(instance) as any;
      };

      // Create an Ember-style component
      const emberComponent: EmberLikeComponent = {
        [COMPONENT_MANAGER]: {
          createComponent(Component: unknown, args: unknown) {
            return { type: 'ember-instance', Component, args };
          },
          getContext(instance: unknown) {
            return { emberContext: true, instance };
          },
        },
        template: '<div>Hello</div>',
      };

      expect($_MANAGERS.component.canHandle(emberComponent)).toBe(true);

      const result = $_MANAGERS.component.handle(emberComponent, { name: 'World' }, [], {});
      expect(result).toEqual({
        emberContext: true,
        instance: {
          type: 'ember-instance',
          Component: emberComponent,
          args: { name: 'World' },
        },
      });
    });
  });

  describe('Ember-style helper manager integration', () => {
    test('can implement Ember-style helper manager pattern', () => {
      const HELPER_MANAGER = Symbol('helper-manager');

      interface HelperManager {
        getValue(helper: unknown, params: unknown[], hash: unknown): unknown;
      }

      $_MANAGERS.helper.canHandle = (helper: unknown) => {
        return helper !== null && typeof helper === 'object' && HELPER_MANAGER in helper;
      };

      $_MANAGERS.helper.handle = (helper: unknown, params: unknown[], hash: unknown) => {
        const manager = (helper as Record<symbol, HelperManager>)[HELPER_MANAGER];
        return manager.getValue(helper, params, hash);
      };

      const emberHelper = {
        [HELPER_MANAGER]: {
          getValue(_helper: unknown, params: unknown[], hash: unknown) {
            return `computed: ${(params as number[]).join(', ')} | ${JSON.stringify(hash)}`;
          },
        },
      };

      expect($_MANAGERS.helper.canHandle(emberHelper)).toBe(true);

      const result = $_MANAGERS.helper.handle(emberHelper, [1, 2, 3], { key: 'value' });
      expect(result).toBe('computed: 1, 2, 3 | {"key":"value"}');
    });
  });
});

/**
 * Integration tests for the try*Manager functions.
 *
 * These tests verify the actual integration path logic that runs when
 * WITH_EMBER_INTEGRATION is enabled. The functions encapsulate the
 * manager-checking logic and return a ManagerResult indicating whether
 * custom handling was performed.
 */
describe('Manager Integration Functions', () => {
  const managerState = createManagerSaveRestore();

  beforeEach(() => managerState.save());
  afterEach(() => managerState.restore());

  describe('tryComponentManager', () => {
    test('returns { handled: false } when no manager handles the component', () => {
      const component = { name: 'TestComponent' };
      const result = tryComponentManager(component, {}, [], { document: {} as Document });

      expect(result.handled).toBe(false);
      expect(result.result).toBeUndefined();
    });

    test('returns { handled: true, result } when manager handles the component', () => {
      const MARKER = Symbol('test-component');
      const handledInstance = { type: 'handled', name: 'TestComponent' };

      $_MANAGERS.component.canHandle = (comp: unknown) => {
        return comp !== null && typeof comp === 'object' && MARKER in comp;
      };

      $_MANAGERS.component.handle = (_comp: unknown, args: unknown, _fw: unknown, _ctx: unknown) => {
        return { ...handledInstance, args } as any;
      };

      const component = { [MARKER]: true, name: 'TestComponent' };
      const args = { foo: 'bar' };
      const result = tryComponentManager(component, args, [], { document: {} as Document });

      expect(result.handled).toBe(true);
      expect(result.result).toEqual({ type: 'handled', name: 'TestComponent', args });
    });

    test('passes all arguments to the manager handle function', () => {
      const MARKER = Symbol('test-component');
      let capturedArgs: { comp: unknown; args: unknown; fw: unknown; ctx: unknown } | null = null;

      $_MANAGERS.component.canHandle = (comp: unknown) => {
        return comp !== null && typeof comp === 'object' && MARKER in comp;
      };

      $_MANAGERS.component.handle = (comp: unknown, args: unknown, fw: unknown, ctx: unknown) => {
        capturedArgs = { comp, args, fw, ctx };
        return {} as any;
      };

      const component = { [MARKER]: true };
      const args = { prop: 'value' };
      const fw = [['id', 'test-id']];
      const ctx = { document: {} as Document };

      tryComponentManager(component, args, fw, ctx);

      expect(capturedArgs).not.toBeNull();
      expect(capturedArgs!.comp).toBe(component);
      expect(capturedArgs!.args).toBe(args);
      expect(capturedArgs!.fw).toBe(fw);
      expect(capturedArgs!.ctx).toBe(ctx);
    });
  });

  describe('tryHelperManager', () => {
    test('returns { handled: false } when no manager handles the helper', () => {
      const helper = () => 'default';
      const result = tryHelperManager(helper, [1, 2], { key: 'value' });

      expect(result.handled).toBe(false);
      expect(result.result).toBeUndefined();
    });

    test('returns { handled: true, result } when manager handles the helper', () => {
      const MARKER = Symbol('test-helper');

      $_MANAGERS.helper.canHandle = (helper: unknown) => {
        return helper !== null && typeof helper === 'object' && MARKER in helper;
      };

      $_MANAGERS.helper.handle = (_helper: unknown, params: unknown[], hash: unknown) => {
        return { computed: true, params, hash };
      };

      const helper = { [MARKER]: true };
      const result = tryHelperManager(helper, ['a', 'b'], { suffix: '!' });

      expect(result.handled).toBe(true);
      expect(result.result).toEqual({
        computed: true,
        params: ['a', 'b'],
        hash: { suffix: '!' },
      });
    });

    test('manager can return any value type', () => {
      const MARKER = Symbol('test-helper');

      $_MANAGERS.helper.canHandle = () => true;

      // Test returning a primitive
      $_MANAGERS.helper.handle = () => 42;
      expect(tryHelperManager({ [MARKER]: true }, [], {}).result).toBe(42);

      // Test returning a string
      $_MANAGERS.helper.handle = () => 'hello';
      expect(tryHelperManager({ [MARKER]: true }, [], {}).result).toBe('hello');

      // Test returning null
      $_MANAGERS.helper.handle = () => null;
      expect(tryHelperManager({ [MARKER]: true }, [], {}).result).toBeNull();

      // Test returning a function
      const fn = () => 'lazy';
      $_MANAGERS.helper.handle = () => fn;
      expect(tryHelperManager({ [MARKER]: true }, [], {}).result).toBe(fn);
    });
  });

  describe('tryModifierManager', () => {
    test('returns { handled: false } when no manager handles the modifier', () => {
      const window = new Window();
      const document = window.document;

      try {
        const modifier = () => {};
        const element = document.createElement('div') as unknown as HTMLElement;
        const result = tryModifierManager(modifier, element, [], () => ({}));

        expect(result.handled).toBe(false);
        expect(result.result).toBeUndefined();
      } finally {
        window.close();
      }
    });

    test('returns { handled: true, result } when manager handles the modifier', () => {
      const window = new Window();
      const document = window.document;

      try {
        const MARKER = Symbol('test-modifier');
        const destructorCalled = { value: false };

        $_MANAGERS.modifier.canHandle = (modifier: unknown) => {
          return modifier !== null && typeof modifier === 'object' && MARKER in modifier;
        };

        $_MANAGERS.modifier.handle = (_modifier: unknown, element: Element, _props: unknown[], hashArgs: () => Record<string, unknown>) => {
          const hash = hashArgs();
          if (hash.class) {
            (element as HTMLElement).classList.add(hash.class as string);
          }
          // Return destructor
          return () => {
            destructorCalled.value = true;
            if (hash.class) {
              (element as HTMLElement).classList.remove(hash.class as string);
            }
          };
        };

        const modifier = { [MARKER]: true };
        const element = document.createElement('div') as unknown as HTMLElement;
        const result = tryModifierManager(modifier, element, [], () => ({ class: 'test-class' }));

        expect(result.handled).toBe(true);
        expect(element.classList.contains('test-class')).toBe(true);

        // Call the destructor
        expect(typeof result.result).toBe('function');
        (result.result as () => void)();
        expect(destructorCalled.value).toBe(true);
        expect(element.classList.contains('test-class')).toBe(false);
      } finally {
        window.close();
      }
    });

    test('passes hashArgs as a function for lazy evaluation', () => {
      const window = new Window();
      const document = window.document;

      try {
        let hashArgsCallCount = 0;

        $_MANAGERS.modifier.canHandle = () => true;
        $_MANAGERS.modifier.handle = (_modifier: unknown, _element: Element, _props: unknown[], hashArgs: () => Record<string, unknown>) => {
          // Verify hashArgs is a function
          expect(typeof hashArgs).toBe('function');

          // Each call should increment the counter
          hashArgs();
          hashArgsCallCount++;
          hashArgs();
          hashArgsCallCount++;

          return undefined;
        };

        const modifier = { marker: true };
        const element = document.createElement('div') as unknown as HTMLElement;
        let hashCallCount = 0;
        const hashArgsFn = () => {
          hashCallCount++;
          return { key: 'value' };
        };

        tryModifierManager(modifier, element, [], hashArgsFn);

        // hashArgs should have been called twice by the handler
        expect(hashCallCount).toBe(2);
        expect(hashArgsCallCount).toBe(2);
      } finally {
        window.close();
      }
    });
  });

  describe('integration path simulation', () => {
    test('simulates full component integration path', () => {
      const COMPONENT_MANAGER = Symbol('component-manager');

      // Set up manager that handles components with COMPONENT_MANAGER
      $_MANAGERS.component.canHandle = (comp: unknown) => {
        return comp !== null && typeof comp === 'object' && COMPONENT_MANAGER in comp;
      };

      $_MANAGERS.component.handle = (comp: unknown, args: unknown) => {
        const manager = (comp as Record<symbol, { create: (c: unknown, a: unknown) => unknown }>)[COMPONENT_MANAGER];
        return manager.create(comp, args) as any;
      };

      // Create a managed component
      const ManagedComponent = {
        [COMPONENT_MANAGER]: {
          create(component: unknown, args: unknown) {
            return {
              type: 'managed-instance',
              component,
              args,
              render() {
                return '<div>Managed Component</div>';
              },
            };
          },
        },
        template: '<div>Original Template</div>',
      };

      // Regular component (not managed)
      const RegularComponent = {
        template: '<div>Regular Component</div>',
      };

      // Simulate the integration path that would run when WITH_EMBER_INTEGRATION=true
      const managedResult = tryComponentManager(ManagedComponent, { name: 'Test' }, [], { document: {} as Document });
      const regularResult = tryComponentManager(RegularComponent, { name: 'Test' }, [], { document: {} as Document });

      // Managed component should be handled
      expect(managedResult.handled).toBe(true);
      expect((managedResult.result as unknown as { type: string }).type).toBe('managed-instance');
      expect((managedResult.result as unknown as { args: unknown }).args).toEqual({ name: 'Test' });

      // Regular component should NOT be handled
      expect(regularResult.handled).toBe(false);
    });

    test('simulates full helper integration path', () => {
      const HELPER_MANAGER = Symbol('helper-manager');

      $_MANAGERS.helper.canHandle = (helper: unknown) => {
        return helper !== null && typeof helper === 'object' && HELPER_MANAGER in helper;
      };

      $_MANAGERS.helper.handle = (helper: unknown, params: unknown[], hash: unknown) => {
        const manager = (helper as Record<symbol, { compute: (h: unknown, p: unknown[], hsh: unknown) => unknown }>)[HELPER_MANAGER];
        return manager.compute(helper, params, hash);
      };

      const ManagedHelper = {
        [HELPER_MANAGER]: {
          compute(_helper: unknown, params: unknown[], hash: Record<string, unknown>) {
            return `${(params as string[]).join('-')}${hash.suffix || ''}`;
          },
        },
      };

      const regularHelper = (a: string, b: string) => `${a}+${b}`;

      // Simulate integration path
      const managedResult = tryHelperManager(ManagedHelper, ['hello', 'world'], { suffix: '!' });
      const regularResult = tryHelperManager(regularHelper, ['hello', 'world'], {});

      expect(managedResult.handled).toBe(true);
      expect(managedResult.result).toBe('hello-world!');

      expect(regularResult.handled).toBe(false);
    });

    test('simulates full modifier integration path', () => {
      const window = new Window();
      const document = window.document;

      try {
        const MODIFIER_MANAGER = Symbol('modifier-manager');

        $_MANAGERS.modifier.canHandle = (modifier: unknown) => {
          return modifier !== null && typeof modifier === 'object' && MODIFIER_MANAGER in modifier;
        };

        $_MANAGERS.modifier.handle = (modifier: unknown, element: Element, props: unknown[], hashArgs: () => Record<string, unknown>) => {
          const manager = (modifier as Record<symbol, {
            setup: (el: Element, p: unknown[], h: Record<string, unknown>) => () => void
          }>)[MODIFIER_MANAGER];
          return manager.setup(element, props, hashArgs());
        };

        const ManagedModifier = {
          [MODIFIER_MANAGER]: {
            setup(element: Element, _props: unknown[], hash: Record<string, unknown>) {
              if (hash.tooltip) {
                element.setAttribute('data-tooltip', hash.tooltip as string);
              }
              return () => {
                element.removeAttribute('data-tooltip');
              };
            },
          },
        };

        const regularModifier = () => {};
        const element = document.createElement('div') as unknown as HTMLElement;

        // Simulate integration path
        const managedResult = tryModifierManager(ManagedModifier, element, [], () => ({ tooltip: 'Hello!' }));
        const regularResult = tryModifierManager(regularModifier, element, [], () => ({}));

        expect(managedResult.handled).toBe(true);
        expect(element.getAttribute('data-tooltip')).toBe('Hello!');

        // Call destructor
        (managedResult.result as () => void)();
        expect(element.getAttribute('data-tooltip')).toBeNull();

        expect(regularResult.handled).toBe(false);
      } finally {
        window.close();
      }
    });

    test('simulates full modifier integration path (Ember-style)', () => {
      const window = new Window();
      const document = window.document;

      try {
        const MODIFIER_MANAGER = Symbol('modifier-manager');

        // Ember-style modifier manager that tracks lifecycle
        $_MANAGERS.modifier.canHandle = (modifier: unknown) => {
          return modifier !== null && typeof modifier === 'object' && MODIFIER_MANAGER in modifier;
        };

        $_MANAGERS.modifier.handle = (modifier: unknown, element: Element, props: unknown[], hashArgs: () => Record<string, unknown>) => {
          const manager = (modifier as Record<symbol, {
            createModifier(): { element: Element | null; didInsertElement: boolean; willDestroyElement: boolean };
            installModifier(state: unknown, el: Element, p: unknown[], h: Record<string, unknown>): void;
            destroyModifier(state: unknown): void;
          }>)[MODIFIER_MANAGER];

          const state = manager.createModifier();
          manager.installModifier(state, element, props, hashArgs());

          return () => {
            manager.destroyModifier(state);
          };
        };

        const EmberModifier = {
          [MODIFIER_MANAGER]: {
            createModifier() {
              return { element: null, didInsertElement: false, willDestroyElement: false };
            },
            installModifier(state: { element: Element | null; didInsertElement: boolean }, element: Element, _props: unknown[], hash: Record<string, unknown>) {
              state.element = element;
              state.didInsertElement = true;
              if (hash.autofocus) {
                element.setAttribute('autofocus', 'true');
              }
            },
            destroyModifier(state: { element: Element | null; willDestroyElement: boolean }) {
              state.willDestroyElement = true;
              if (state.element) {
                state.element.removeAttribute('autofocus');
              }
            },
          },
        };

        const element = document.createElement('input') as unknown as HTMLElement;
        const result = tryModifierManager(EmberModifier, element, [], () => ({ autofocus: true }));

        expect(result.handled).toBe(true);
        expect(element.getAttribute('autofocus')).toBe('true');

        // Cleanup
        (result.result as () => void)();
        expect(element.getAttribute('autofocus')).toBeNull();
      } finally {
        window.close();
      }
    });
  });

  describe('error handling', () => {
    test('propagates error when canHandle throws', () => {
      $_MANAGERS.component.canHandle = () => {
        throw new Error('canHandle error');
      };

      expect(() => {
        tryComponentManager({}, {}, [], { document: {} as Document });
      }).toThrow('canHandle error');
    });

    test('propagates error when handle throws', () => {
      $_MANAGERS.helper.canHandle = () => true;
      $_MANAGERS.helper.handle = () => {
        throw new Error('handle error');
      };

      expect(() => {
        tryHelperManager({}, [], {});
      }).toThrow('handle error');
    });

    test('propagates error when modifier handle throws', () => {
      const window = new Window();
      const document = window.document;

      try {
        $_MANAGERS.modifier.canHandle = () => true;
        $_MANAGERS.modifier.handle = () => {
          throw new Error('modifier handle error');
        };

        const element = document.createElement('div') as unknown as HTMLElement;
        expect(() => {
          tryModifierManager({}, element, [], () => ({}));
        }).toThrow('modifier handle error');
      } finally {
        window.close();
      }
    });
  });

  describe('edge cases', () => {
    test('handle returning undefined is still considered handled', () => {
      $_MANAGERS.helper.canHandle = () => true;
      $_MANAGERS.helper.handle = () => undefined;

      const result = tryHelperManager({}, [], {});

      expect(result.handled).toBe(true);
      expect(result.result).toBeUndefined();
    });

    test('handle returning null is preserved', () => {
      $_MANAGERS.component.canHandle = () => true;
      $_MANAGERS.component.handle = () => null as any;

      const result = tryComponentManager({}, {}, [], { document: {} as Document });

      expect(result.handled).toBe(true);
      expect(result.result).toBeNull();
    });

    test('handle returning false is preserved', () => {
      $_MANAGERS.helper.canHandle = () => true;
      $_MANAGERS.helper.handle = () => false;

      const result = tryHelperManager({}, [], {});

      expect(result.handled).toBe(true);
      expect(result.result).toBe(false);
    });

    test('handle returning 0 is preserved', () => {
      $_MANAGERS.helper.canHandle = () => true;
      $_MANAGERS.helper.handle = () => 0;

      const result = tryHelperManager({}, [], {});

      expect(result.handled).toBe(true);
      expect(result.result).toBe(0);
    });

    test('handle returning empty string is preserved', () => {
      $_MANAGERS.helper.canHandle = () => true;
      $_MANAGERS.helper.handle = () => '';

      const result = tryHelperManager({}, [], {});

      expect(result.handled).toBe(true);
      expect(result.result).toBe('');
    });

    test('canHandle is called before handle', () => {
      const callOrder: string[] = [];

      $_MANAGERS.component.canHandle = () => {
        callOrder.push('canHandle');
        return true;
      };
      $_MANAGERS.component.handle = () => {
        callOrder.push('handle');
        return {} as any;
      };

      tryComponentManager({}, {}, [], { document: {} as Document });

      expect(callOrder).toEqual(['canHandle', 'handle']);
    });

    test('handle is not called when canHandle returns false', () => {
      let handleCalled = false;

      $_MANAGERS.helper.canHandle = () => false;
      $_MANAGERS.helper.handle = () => {
        handleCalled = true;
        return 'should not be called';
      };

      const result = tryHelperManager({}, [], {});

      expect(result.handled).toBe(false);
      expect(handleCalled).toBe(false);
    });

    test('params array is passed by reference and can be mutated by handler', () => {
      $_MANAGERS.helper.canHandle = () => true;
      $_MANAGERS.helper.handle = (_helper, params) => {
        // Handler can mutate params since it's passed by reference
        (params as unknown[]).push('mutated');
        return params;
      };

      const originalParams = [1, 2, 3];
      const paramsCopy = [...originalParams];

      tryHelperManager({}, originalParams, {});

      // Documents that params is passed by reference - handlers can mutate it
      expect(originalParams.length).toBe(4);
      expect(originalParams).toEqual([1, 2, 3, 'mutated']);
      expect(paramsCopy).toEqual([1, 2, 3]); // copy is unaffected
    });

    test('hash object is passed by reference to helper manager', () => {
      let receivedHash: Record<string, unknown> | null = null;

      $_MANAGERS.helper.canHandle = () => true;
      $_MANAGERS.helper.handle = (_helper, _params, hash) => {
        receivedHash = hash as Record<string, unknown>;
        return hash;
      };

      const hash = { key: 'value' };
      tryHelperManager({}, [], hash);

      expect(receivedHash).toBe(hash); // Same reference
    });
  });

  describe('manager isolation', () => {
    test('component manager changes do not affect helper manager', () => {
      const MARKER = Symbol('test');

      $_MANAGERS.component.canHandle = (comp: unknown) => {
        return comp !== null && typeof comp === 'object' && MARKER in comp;
      };

      // Helper manager should still use default
      const helperResult = tryHelperManager({ [MARKER]: true }, [], {});
      expect(helperResult.handled).toBe(false);

      // Component manager should work
      const compResult = tryComponentManager({ [MARKER]: true }, {}, [], { document: {} as Document });
      expect(compResult.handled).toBe(true);
    });

    test('modifier manager changes do not affect other managers', () => {
      const window = new Window();
      const document = window.document;

      try {
        const MARKER = Symbol('test');

        $_MANAGERS.modifier.canHandle = (mod: unknown) => {
          return mod !== null && typeof mod === 'object' && MARKER in mod;
        };

        // Other managers should still use defaults
        expect(tryHelperManager({ [MARKER]: true }, [], {}).handled).toBe(false);
        expect(tryComponentManager({ [MARKER]: true }, {}, [], { document: {} as Document }).handled).toBe(false);

        // Modifier manager should work
        const element = document.createElement('div') as unknown as HTMLElement;
        expect(tryModifierManager({ [MARKER]: true }, element, [], () => ({})).handled).toBe(true);
      } finally {
        window.close();
      }
    });
  });
});

/**
 * Tests for re-export from dom.ts
 * Verifies backwards compatibility of the $_MANAGERS export
 */
describe('$_MANAGERS re-export from dom.ts', () => {
  const managerState = createManagerSaveRestore();

  beforeEach(() => managerState.save());
  afterEach(() => managerState.restore());

  test('$_MANAGERS is exported from dom.ts', async () => {
    const domModule = await import('./dom');
    expect(domModule.$_MANAGERS).toBeDefined();
  });

  test('$_MANAGERS from dom.ts is the same instance as from manager-integration.ts', async () => {
    const domModule = await import('./dom');
    const managerModule = await import('./manager-integration');

    expect(domModule.$_MANAGERS).toBe(managerModule.$_MANAGERS);
  });

  test('modifying $_MANAGERS from dom.ts affects manager-integration.ts', async () => {
    const domModule = await import('./dom');
    const managerModule = await import('./manager-integration');

    const customCanHandle = () => true;
    domModule.$_MANAGERS.helper.canHandle = customCanHandle;

    expect(managerModule.$_MANAGERS.helper.canHandle).toBe(customCanHandle);
    // Cleanup handled by afterEach
  });
});
