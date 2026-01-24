/**
 * Manager Integration
 *
 * This module provides the extensibility point for external code (like Ember integration)
 * to provide custom component, helper, and modifier managers.
 *
 * The $_MANAGERS object can be overridden at runtime to intercept and handle
 * components, helpers, and modifiers before the default behavior runs.
 *
 * The integration functions (tryComponentManager, tryHelperManager, tryModifierManager)
 * encapsulate the manager-checking logic and can be tested independently.
 */

import type { Component, ComponentReturnType } from './component-class';

/**
 * Extensibility point for custom managers.
 *
 * External code can override these methods to intercept component, helper,
 * and modifier resolution. The managers are only invoked when
 * WITH_EMBER_INTEGRATION is true (a compile-time constant).
 *
 * Default implementations return false for canHandle and undefined for handle,
 * meaning no custom handling is performed.
 *
 * @example
 * // Override to handle Ember-style components
 * $_MANAGERS.component.canHandle = (comp) => comp && MANAGER_SYMBOL in comp;
 * $_MANAGERS.component.handle = (comp, args, fw, ctx) => {
 *   const manager = comp[MANAGER_SYMBOL];
 *   return manager.create(comp, args);
 * };
 */
export const $_MANAGERS = {
  component: {
    /**
     * Check if this manager can handle the given component.
     * @returns true if handle() should be called, false to use default behavior
     */
    canHandle(_component: unknown): boolean {
      return false;
    },
    /**
     * Handle the component and return an instance or transformed component.
     * Only called if canHandle() returned true.
     */
    handle(
      _component: unknown,
      _args: unknown,
      _fw: unknown,
      _ctx: unknown,
    ): ComponentReturnType | Component | undefined {
      return undefined;
    },
  },
  modifier: {
    /**
     * Check if this manager can handle the given modifier.
     * @returns true if handle() should be called, false to use default behavior
     */
    canHandle(_modifier: unknown): boolean {
      return false;
    },
    /**
     * Handle the modifier and return a modifier function or destructor.
     * Only called if canHandle() returned true.
     */
    handle(
      _modifier: unknown,
      _element: Element,
      _props: unknown[],
      _hashArgs: () => Record<string, unknown>,
    ): unknown {
      return undefined;
    },
  },
  helper: {
    /**
     * Check if this manager can handle the given helper.
     * @returns true if handle() should be called, false to use default behavior
     */
    canHandle(_helper: unknown): boolean {
      return false;
    },
    /**
     * Handle the helper and return the computed value.
     * Only called if canHandle() returned true.
     */
    handle(_helper: unknown, _params: unknown[], _hash: unknown): unknown {
      return undefined;
    },
  },
};

/**
 * Result of attempting to handle via a custom manager.
 * If `handled` is true, `result` contains the manager's output.
 * If `handled` is false, the caller should use default behavior.
 */
export interface ManagerResult<T> {
  handled: boolean;
  result?: T;
}

// Type alias for Root to avoid circular dependency
type RootLike = { document: Document };

/**
 * Attempts to handle a component via the custom component manager.
 *
 * This function encapsulates the integration logic that runs when
 * WITH_EMBER_INTEGRATION is enabled. It can be tested independently
 * of the compile-time flag.
 *
 * @param comp - The component class/function to potentially handle
 * @param args - Arguments passed to the component
 * @param fw - Forward arguments (props, attrs, events)
 * @param ctx - Parent context (Component or Root)
 * @returns ManagerResult with handled component, or { handled: false }
 *
 * @example
 * const result = tryComponentManager(MyEmberComponent, { name: 'test' }, [], ctx);
 * if (result.handled) {
 *   // Use result.result as the component instance
 * } else {
 *   // Fall back to default component instantiation
 * }
 */
export function tryComponentManager(
  comp: unknown,
  args: Record<string, unknown>,
  fw: unknown,
  ctx: Component | RootLike
): ManagerResult<ComponentReturnType | Component> {
  if ($_MANAGERS.component.canHandle(comp)) {
    const result = $_MANAGERS.component.handle(comp, args, fw, ctx);
    return { handled: true, result: result as ComponentReturnType | Component };
  }
  return { handled: false };
}

/**
 * Attempts to handle a helper via the custom helper manager.
 *
 * This function encapsulates the integration logic that runs when
 * WITH_EMBER_INTEGRATION is enabled. It can be tested independently
 * of the compile-time flag.
 *
 * @param helper - The helper to potentially handle
 * @param params - Positional parameters passed to the helper
 * @param hash - Named parameters (hash arguments)
 * @returns ManagerResult with helper result, or { handled: false }
 *
 * @example
 * const result = tryHelperManager(myEmberHelper, [1, 2, 3], { suffix: '!' });
 * if (result.handled) {
 *   return result.result;
 * } else {
 *   // Fall back to default helper execution
 * }
 */
export function tryHelperManager(
  helper: unknown,
  params: unknown[],
  hash: Record<string, unknown>
): ManagerResult<unknown> {
  if ($_MANAGERS.helper.canHandle(helper)) {
    const result = $_MANAGERS.helper.handle(helper, params, hash);
    return { handled: true, result };
  }
  return { handled: false };
}

/**
 * Attempts to handle a modifier via the custom modifier manager.
 *
 * This function encapsulates the integration logic that runs when
 * WITH_EMBER_INTEGRATION is enabled. It can be tested independently
 * of the compile-time flag.
 *
 * @param modifier - The modifier to potentially handle
 * @param element - The DOM element the modifier is applied to
 * @param props - Positional parameters passed to the modifier
 * @param hashArgs - Function returning named parameters
 * @returns ManagerResult with modifier result, or { handled: false }
 *
 * @example
 * const result = tryModifierManager(myEmberModifier, element, [], () => ({}));
 * if (result.handled) {
 *   return result.result; // Could be a destructor function
 * } else {
 *   // Fall back to default modifier handling
 * }
 */
export function tryModifierManager(
  modifier: unknown,
  element: Element,
  props: unknown[],
  hashArgs: () => Record<string, unknown>
): ManagerResult<unknown> {
  if ($_MANAGERS.modifier.canHandle(modifier)) {
    const result = $_MANAGERS.modifier.handle(modifier, element, props, hashArgs);
    return { handled: true, result };
  }
  return { handled: false };
}
