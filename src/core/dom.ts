/**
 * DOM - Level 6
 *
 * High-level DOM utilities and component instantiation.
 * This is the main module that ties together all the lower-level modules.
 */

// Import component types from component-class
import { Component, type ComponentReturnType } from './component-class';

// Import from render/destroy modules directly (no late-binding needed)
import { renderElement } from './render-core';
import { destroyElementSync, unregisterFromParent, runDestructors } from './destroy';

// Import Root and resolveRenderable from root module
import { Root, createRoot, resolveRenderable } from './root';
export { Root, createRoot, resolveRenderable };

// Import types
import type { ComponentLike, DOMApi, GenericReturnType, Slots, ComponentRenderTarget } from './types';
import {
  RENDERING_CONTEXT_PROPERTY,
  RENDERED_NODES_PROPERTY,
  COMPONENT_ID_PROPERTY,
} from './types';

import {
  AnyCell,
  Cell,
  MergedCell,
  formula,
  deepFnValue,
  getTagId,
  tagsFromRange,
} from '@/core/reactive';
import { opcodeFor } from '@/core/vm';
import {
  SyncListComponent,
  AsyncListComponent,
} from '@/core/control-flow/list';
import {
  DestructorFn,
  Destructors,
  registerDestructor,
} from './glimmer/destroyable';
import { HTMLBrowserDOMApi } from '@/core/dom-api';
import {
  isFn,
  isPrimitive,
  isTagLike,
  $template,
  setBounds,
  $args,
  $DEBUG_REACTIVE_CONTEXTS,
  IN_SSR_ENV,
  COMPONENTS_HMR,
  isEmpty,
} from './shared';
import { TREE, CHILD, PARENT, cId, addToTree } from './tree';
import { ADDED_TO_TREE_FLAG } from './types';
import { isRehydrationScheduled } from './ssr/rehydration-state';
import { createHotReload } from './hmr';
import { CONSTANTS } from '../../plugins/symbols';
import { initDOM, provideContext, RENDERING_CONTEXT, cleanupFastContext } from './context';
import { SVGProvider, HTMLProvider, MathMLProvider } from './provider';
import { IfCondition, type IfFunction } from './control-flow/if';

// Import and re-export tracking functions
import {
  pushParentContext,
  popParentContext,
  setParentContext,
  getParentContext,
} from './tracking';
export { pushParentContext, popParentContext, setParentContext, getParentContext };


type ShadowRootMode = 'open' | 'closed' | null;
type ModifierFn = (
  element: HTMLElement,
  ...args: unknown[]
) => void | DestructorFn;

type Attr =
  | MergedCell
  | Cell
  | string
  | ((element: HTMLElement, attribute: string) => void);

type TagAttr = [string, Attr];
type TagProp = [string, Attr];
type TagEvent = [string, EventListener | ModifierFn];
type FwType = [TagProp[], TagAttr[], TagEvent[]];
type Props = [TagProp[], TagAttr[], TagEvent[], FwType?];

type InElementFnArg = () => HTMLElement;
type BranchCb = (ctx: IfCondition) => GenericReturnType | Node | null;

// EMPTY DOM PROPS
export const $_edp = [[], [], []] as Props;
export const $_emptySlot = Object.seal(Object.freeze({}));

export const $SLOTS_SYMBOL = Symbol('slots');
export const $PROPS_SYMBOL = Symbol('props');
export const $_SVGProvider = SVGProvider;
export const $_HTMLProvider = HTMLProvider;
export const $_MathMLProvider = MathMLProvider;

const $_className = 'className';

let unstableWrapperId: number = 0;

// Import and re-export $_MANAGERS from manager-integration
import { $_MANAGERS } from './manager-integration';
export { $_MANAGERS };

export function $_TO_VALUE(reference: unknown) {
  if (isFn(reference)) {
    return resolveRenderable(reference as Function);
  } else {
    return reference;
  }
}

/**
 * Unwrap a helper argument - if it's a getter function, call it to get the actual value.
 * If it's a Tag (reactive cell), get its .value property.
 */
export function $_unwrapHelperArg(value: unknown): unknown {
  if (typeof value === 'function' && !value.prototype) {
    value = value();
  }
  if (value !== null && value !== undefined && isTagLike(value)) {
    return (value as { value: unknown }).value;
  }
  return value;
}

/**
 * Component helper - curries a component with pre-bound args.
 * Handles both class/function components and string component names.
 */
export function $_componentHelper(params: any[], hash: Record<string, unknown>) {
  const componentFn = $_unwrapHelperArg(params[0]);

  // For string component names, return a special wrapper that will be resolved at render time
  if (typeof componentFn === 'string') {
    // Return the string as the component identifier
    // The component manager will resolve it when $_c is called
    const wrappedComponent = function wrappedStringComponent(args: Record<string, unknown>) {
      const keys = Object.keys(hash);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        args[key] = $_unwrapHelperArg(hash[key]);
      }
      // Return the string - the manager will handle resolution
      // The args are merged so the resolved component gets them
      return args;
    };
    // Mark the wrapper with the string component name for manager resolution
    (wrappedComponent as any).__stringComponentName = componentFn;
    return wrappedComponent;
  }

  return function wrappedComponent(args: Record<string, unknown>) {
    const keys = Object.keys(hash);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      args[key] = $_unwrapHelperArg(hash[key]);
    }
    // @ts-expect-error dynamic constructor
    return new componentFn(args);
  };
}

/**
 * Modifier helper - curries a modifier with pre-bound args.
 */
export function $_modifierHelper(params: any[], hash: Record<string, unknown>) {
  const modifierFn = $_unwrapHelperArg(params[0]) as Function;
  const boundParams = params.slice(1);

  // @ts-expect-error EmberFunctionalModifiers global
  if (typeof EmberFunctionalModifiers !== 'undefined' && EmberFunctionalModifiers.has(modifierFn)) {
    function wrappedModifier(node: HTMLElement, _params: any[], _hash: Record<string, unknown>) {
      return $_maybeModifier(modifierFn, node, [...boundParams, ..._params], () => ({
        ...hash,
        ..._hash,
      }));
    }
    // @ts-expect-error EmberFunctionalModifiers global
    EmberFunctionalModifiers.add(wrappedModifier);
    return wrappedModifier;
  }

  return function wrappedModifier(node: HTMLElement, _params: any[], _hash: Record<string, unknown>) {
    const allParams = $_unwrapArgs([...boundParams, ..._params]);
    const mergedHash = { ...hash, ..._hash };
    return modifierFn(node, allParams, mergedHash);
  };
}

/**
 * Helper helper - curries a helper with pre-bound args.
 */
export function $_helperHelper(params: any[], hash: Record<string, unknown>) {
  const helperFn = $_unwrapHelperArg(params[0]) as Function;
  const boundParams = params.slice(1);

  if (WITH_EMBER_INTEGRATION) {
    if ($_MANAGERS.helper.canHandle(helperFn)) {
      return $_MANAGERS.helper.handle(helperFn, boundParams, hash);
    }
  }

  // @ts-expect-error EmberFunctionalHelpers global
  if (typeof EmberFunctionalHelpers !== 'undefined' && EmberFunctionalHelpers.has(helperFn)) {
    function wrappedHelper(_params: any[], _hash: Record<string, unknown>) {
      return $_maybeHelper(helperFn, [...boundParams, ..._params], {
        ...hash,
        ..._hash,
      });
    }
    // @ts-expect-error EmberFunctionalHelpers global
    EmberFunctionalHelpers.add(wrappedHelper);
    return wrappedHelper;
  }

  return function wrappedHelper(_params: any[], _hash: Record<string, unknown>) {
    const allParams = $_unwrapArgs([...boundParams, ..._params]);
    return helperFn(...allParams);
  };
}

/**
 * Resolve a value for attribute/property binding, preserving reactivity.
 */
function resolveBindingValue(
  value: unknown,
  debugName: string
): { result: unknown; isReactive: boolean } {
  if (isFn(value)) {
    const f = formula(() => deepFnValue(value as Function), debugName);
    if (f.isConst) {
      const constValue = f.value;
      f.destroy();
      return { result: constValue, isReactive: false };
    }
    return { result: f, isReactive: true };
  }

  const result = $_TO_VALUE(value);
  if (isTagLike(result)) {
    return { result, isReactive: true };
  }
  return { result, isReactive: false };
}

function $prop(
  api: DOMApi,
  element: Node,
  key: string,
  value: unknown,
  destructors: DestructorFn[],
) {
  const { result, isReactive } = resolveBindingValue(value, `${key}-prop`);

  if (isEmpty(result)) {
    return;
  }

  if (isReactive) {
    let prevPropValue: any = undefined;
    destructors.push(
      opcodeFor(result as AnyCell, (resolvedValue) => {
        if (resolvedValue === prevPropValue) {
          return;
        }
        prevPropValue = api.prop(element, key, resolvedValue);
      }),
    );
  } else {
    if (isRehydrationScheduled()) {
      return;
    }
    api.prop(element, key, result);
  }
}

function mergeClassModifiers(
  api: DOMApi,
  element: Node,
  classNameModifiers: Attr[],
  destructors: Destructors,
) {
  if (classNameModifiers.length === 0) {
    return;
  }
  if (IS_DEV_MODE) {
    $DEBUG_REACTIVE_CONTEXTS.push(`[class]`);
  }
  if (classNameModifiers.length === 1) {
    $prop(api, element, $_className, classNameModifiers[0], destructors);
  } else {
    const formulasToDestroy: MergedCell[] = [];
    const formulas = classNameModifiers.map((modifier) => {
      if (isFn(modifier)) {
        const f = formula(
          () => deepFnValue(modifier),
          'functional modifier for className',
        );
        if (!f.isConst) {
          formulasToDestroy.push(f);
        } else {
          const value = f.value;
          f.destroy();
          return value;
        }
        return f;
      } else {
        return modifier;
      }
    });
    const outerFormula = formula(() => {
      return formulas.join(' ');
    }, (element as HTMLElement).tagName + '.className');
    if (!outerFormula.isConst) {
      formulasToDestroy.push(outerFormula);
    }
    $prop(
      api,
      element,
      $_className,
      outerFormula,
      destructors,
    );
    if (formulasToDestroy.length > 0) {
      destructors.push(() => {
        for (const f of formulasToDestroy) {
          f.destroy();
        }
      });
    }
  }
  if (IS_DEV_MODE) {
    $DEBUG_REACTIVE_CONTEXTS.pop();
  }
}

function $attr(
  api: DOMApi,
  element: HTMLElement,
  key: string,
  value: unknown,
  destructors: Destructors,
) {
  const { result, isReactive } = resolveBindingValue(value, `${key}-attr`);

  if (isEmpty(result)) {
    return;
  }

  if (isReactive) {
    destructors.push(
      opcodeFor(result as AnyCell, (resolvedValue) => {
        if (!isEmpty(resolvedValue)) {
          // @ts-expect-error type casting
          api.attr(element, key, resolvedValue);
        }
      }),
    );
  } else {
    // @ts-expect-error type casting
    api.attr(element, key, result);
  }
}

const EVENT_TYPE = {
  ON_CREATED: '0',
  TEXT_CONTENT: '1',
};

function $ev(
  api: DOMApi,
  element: HTMLElement,
  eventName: string,
  fn: EventListener | ModifierFn,
  destructors: DestructorFn[],
) {
  if (eventName === EVENT_TYPE.TEXT_CONTENT) {
    const result = $_TO_VALUE(fn);
    if (isEmpty(result)) {
      return;
    }
    if (isPrimitive(result)) {
      api.textContent(element, result as string);
    } else {
      destructors.push(
        opcodeFor(result as AnyCell, (value) => {
          api.textContent(element, String(value));
        }),
      );
    }
  } else if (eventName === EVENT_TYPE.ON_CREATED) {
    if (REACTIVE_MODIFIERS) {
      let destructor = () => void 0;
      let isDestroying = false;
      const updatingCell = formula(() => {
        if (isDestroying) {
          return undefined;
        }
        destructor();
        return (fn as ModifierFn)(element);
      }, `${element.tagName}.modifier`);
      const opcodeDestructor = opcodeFor(updatingCell, (dest: any) => {
        if (isFn(dest)) {
          destructor = dest as any;
        }
      });
      if (updatingCell.isConst) {
        updatingCell.destroy();
        opcodeDestructor();
        destructors.push(() => {
          return destructor();
        });
      } else {
        destructors.push(
          () => {
            isDestroying = true;
            updatingCell.destroy();
          },
          opcodeDestructor,
          () => {
            return destructor();
          },
        );
      }
    } else {
      const destructor = (fn as ModifierFn)(element);
      if (isFn(destructor)) {
        destructors.push(destructor);
      }
    }
  } else {
    if (RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES) {
      destructors.push(
        api.addEventListener(element, eventName, fn as EventListener)!,
      );
    } else {
      api.addEventListener(element, eventName, fn as EventListener);
    }
  }
}

let NODE_COUNTER = 0;

export function incrementNodeCounter() {
  NODE_COUNTER++;
}

export function resetNodeCounter() {
  NODE_COUNTER = 0;
}

export function getNodeCounter() {
  return NODE_COUNTER;
}

export function $_hasBlock(slots: Record<string, unknown>, name = 'default') {
  return name in slots && slots[name] !== undefined;
}

export function $_hasBlockParams(
  slots: Record<string, unknown>,
  slotName = 'default',
) {
  return slots[`${slotName}_`];
}

function addAttrs(
  api: DOMApi,
  arr: TagAttr[],
  element: HTMLElement,
  seenKeys: Set<string>,
  destructors: Destructors,
) {
  for (let i = 0; i < arr.length; i++) {
    const key = arr[i][0];
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.push(`[${key}]`);
    }
    $attr(api, element, key, arr[i][1], destructors);
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.pop();
    }
  }
}

function addProperties(
  api: DOMApi,
  properties: TagProp[],
  element: Node,
  seenKeys: Set<string>,
  destructors: Destructors,
  classNameModifiers: Attr[],
  setShadowMode: (value: NonNullable<ShadowRootMode>) => void,
) {
  for (let i = 0; i < properties.length; i++) {
    const key = properties[i][0];
    const value = properties[i][1];
    if (key === '') {
      classNameModifiers.push(value);
      continue;
    }
    if (SUPPORT_SHADOW_DOM) {
      if (key === 'shadowrootmode') {
        setShadowMode(value as NonNullable<ShadowRootMode>);
        continue;
      }
    }
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.push(`[${key}]`);
    }
    $prop(api, element, key, value, destructors);
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.pop();
    }
  }
}

function _DOM(
  tag: string | (() => string),
  tagProps: Props,
  children: (ComponentReturnType | string | Cell | MergedCell | Function)[],
  ctx: any,
): Node {
  NODE_COUNTER++;
  const api = initDOM(ctx);
  if (import.meta.env.DEV) {
    if (!api) {
      console.error('Unable to resolve root rendering context');
    }
  }
  const resolvedTag = typeof tag === 'function' ? tag() : tag;
  const element = api.element(resolvedTag) as HTMLElement;
  if (IS_DEV_MODE) {
    $DEBUG_REACTIVE_CONTEXTS.push(`${resolvedTag}`);
  }
  if (IN_SSR_ENV) {
    api.attr(element, 'data-node-id', String(NODE_COUNTER));
  }
  const destructors: Destructors = [];
  const seenKeys = new Set<string>();
  const classNameModifiers: Attr[] = [];
  let hasShadowMode: ShadowRootMode = null;

  const setShadowNode = (value: ShadowRootMode) => {
    hasShadowMode = value;
  };

  if ($_edp !== tagProps) {
    const hasSplatAttrs = typeof tagProps[3] === 'object';

    if (hasSplatAttrs === true) {
      for (let i = 0; i < tagProps[3]![2].length; i++) {
        $ev(
          api,
          element,
          tagProps[3]![2][i][0],
          tagProps[3]![2][i][1],
          destructors,
        );
      }
    }

    for (let i = 0; i < tagProps[2].length; i++) {
      $ev(api, element, tagProps[2][i][0], tagProps[2][i][1], destructors);
    }

    if (hasSplatAttrs === true) {
      addAttrs(api, tagProps[3]![1], element, seenKeys, destructors);
    }
    addAttrs(api, tagProps[1], element, seenKeys, destructors);

    if (hasSplatAttrs === true) {
      addProperties(
        api,
        tagProps[3]![0],
        element,
        seenKeys,
        destructors,
        classNameModifiers,
        setShadowNode,
      );
    }
    addProperties(
      api,
      tagProps[0],
      element,
      seenKeys,
      destructors,
      classNameModifiers,
      setShadowNode,
    );
  }

  mergeClassModifiers(api, element, classNameModifiers, destructors);

  if (SUPPORT_SHADOW_DOM) {
    let appendRef =
      hasShadowMode !== null
        ? isRehydrationScheduled()
          ? element.shadowRoot
          : element.attachShadow({ mode: hasShadowMode }) || element.shadowRoot
        : element;
    if (import.meta.env.SSR) {
      if (hasShadowMode) {
        const tpl = api.element('template');
        api.attr(tpl, 'shadowrootmode', 'open');
        api.insert(element, tpl);
        renderElement(api, ctx, tpl, children as any, null, true);
      } else {
        renderElement(api, ctx, appendRef!, children as any, null, true);
      }
    } else {
      for (let i = 0; i < children.length; i++) {
        renderElement(api, ctx, appendRef!, children[i] as any, null, true);
      }
    }
  } else {
    for (let i = 0; i < children.length; i++) {
      renderElement(api, ctx, element, children[i] as any, null, true);
    }
  }

  if (destructors.length) {
    registerDestructor(ctx, ...destructors);
  }

  if (IS_DEV_MODE) {
    $DEBUG_REACTIVE_CONTEXTS.pop();
  }
  return element;
}

export function $_inElement(
  elementRef: HTMLElement | Cell<HTMLElement> | InElementFnArg,
  roots: (context: Component<any>) => (Node | ComponentReturnType)[],
  ctx: any,
) {
  const api = initDOM(ctx);
  return component(
    function UnstableChildWrapper(this: Component<any>) {
      $_GET_ARGS(this, arguments);
      if (IS_DEV_MODE) {
        // @ts-expect-error construct signature
        this.debugName = `InElement-${unstableWrapperId++}`;
      }
      // Propagate $_eval from parent context for deferred rendering
      if (WITH_DYNAMIC_EVAL) {
        // @ts-ignore $_eval may exist on ctx
        if (ctx?.$_eval) { this.$_eval = ctx.$_eval; }
      }
      let appendRef!: HTMLElement;
      if (isFn(elementRef)) {
        let result = elementRef();
        if (isFn(result)) {
          result = result();
        }
        if (isTagLike(result)) {
          appendRef = result.value;
        } else {
          appendRef = result;
        }
      } else if (isTagLike(elementRef)) {
        appendRef = elementRef.value;
      } else {
        appendRef = elementRef;
      }
      if (!appendRef) {
        if (IS_DEV_MODE) {
          const errMsg = `in-element: target element is null or undefined. isFn: ${isFn(elementRef)}, isTagLike: ${isTagLike(elementRef)}, fnResult: ${isFn(elementRef) ? String(elementRef()) : 'N/A'}`;
          console.error(errMsg);
        }
        return $_fin([], this);
      }
      const nodes = roots(ctx);
      renderElement(api, ctx, appendRef, nodes);
      registerDestructor(ctx, () => {
        unregisterFromParent(nodes as ComponentLike[]);
        appendRef.innerHTML = '';
      });
      return $_fin([], this);
    } as unknown as Component<any>,
    {},
    ctx,
  );
}

export function $_ucw(
  roots: (context: Component<any>) => (Node | ComponentReturnType)[],
  ctx: any,
): ComponentReturnType {
  return component(
    function UnstableChildWrapper(this: Component<any>) {
      $_GET_ARGS(this, arguments);
      if (IS_DEV_MODE) {
        // @ts-expect-error construct signature
        this.debugName = `UnstableChildWrapper-${unstableWrapperId++}`;
      }
      // Propagate $_eval from parent context for deferred rendering
      // This ensures eval-based bindings work inside control flow blocks
      if (WITH_DYNAMIC_EVAL) {
        // @ts-ignore $_eval may exist on ctx
        if (ctx?.$_eval) { this.$_eval = ctx.$_eval; }
      }
      try {
        setParentContext(this);
        return $_fin(roots(this), this);
      } finally {
        setParentContext(null);
      }
    } as unknown as Component<any>,
    {},
    ctx,
  ) as ComponentReturnType;
}

if (IS_DEV_MODE) {
  function buildGraph(
    obj: Record<string, unknown>,
    root: any,
    children: Set<number>,
  ) {
    if (root === null) {
      console.info('root is null', TREE);
      return obj;
    }
    const name =
      root.debugName || root?.constructor?.name || root?.tagName || 'unknown';
    if (children.size === 0) {
      obj[name] = null;
      return obj;
    }
    obj[name] = Array.from(children).map((child) => {
      return buildGraph({}, child, new Set(CHILD.get(child) ?? []));
    });
    return obj;
  }

  function drawTreeToConsole() {
    const rootIds: number[] = [];
    PARENT.forEach((ref, id) => {
      if (ref === null) {
        rootIds.push(id);
      }
    });
    const roots = rootIds.map((id) => TREE.get(id)!);
    const ref = buildGraph(
      {} as Record<string, unknown>,
      roots[0],
      new Set(CHILD.get(roots[0]![COMPONENT_ID_PROPERTY]) ?? []),
    );
    console.log(JSON.stringify(ref, null, 2));
  }
  if (!import.meta.env.SSR) {
    window.drawTreeToConsole = drawTreeToConsole;
  }
}

if (!import.meta.env.SSR) {
  if (IS_DEV_MODE) {
    // @ts-expect-error global
    window.utils = {
      runDestructors,
    };
    window.hotReload = createHotReload(component);
  }
}

export function $_GET_SCOPES(hashOrCtx: Record<string, unknown> | any, ctx?: any) {
  // If context is provided, get scope from ctx[$args].$_scope
  if (ctx) {
    const scopeValue = ctx[$args]?.[CONSTANTS.SCOPE_KEY];
    // Support both function-based scope (() => [scope]) and direct scope objects
    if (typeof scopeValue === 'function') {
      return scopeValue() || [];
    }
    return scopeValue ? [scopeValue] : [];
  }
  // Legacy: get scope from hash getter
  return hashOrCtx[CONSTANTS.SCOPE_KEY]?.() || [];
}

export const $_maybeHelper = (
  value: any,
  args: any[],
  _hashOrCtx?: Record<string, unknown> | any, // Hash object for known bindings, context for unknown, or undefined
  _maybeCtx?: any, // Optional 4th arg: context when 3rd arg is hash for unknown bindings
) => {
  // Determine context and hash based on arguments:
  // - 4 args: _hashOrCtx is hash, _maybeCtx is context (unknown binding with named args)
  // - 3 args with context: _hashOrCtx is context (unknown binding without named args)
  // - 3 args with hash: _hashOrCtx is hash (known binding)
  // - 2 args: no hash or context
  const isCtxIn3rd = !_maybeCtx
    && _hashOrCtx
    && typeof _hashOrCtx === 'object'
    && (_hashOrCtx.hasOwnProperty('$_eval')
      || _hashOrCtx.hasOwnProperty($args)
      || _hashOrCtx[$args] !== undefined);
  const _ctx = _maybeCtx ?? (isCtxIn3rd ? _hashOrCtx : undefined);
  // Default _hash to empty object when not provided
  const _hash = _maybeCtx ? _hashOrCtx : (isCtxIn3rd ? {} : (_hashOrCtx ?? {}));
  if (typeof value === 'function') {
    if (value.helperType === 'ember') {
      // @ts-expect-error amount of args
      const hash = $_args(_hash, false);
      const helper = new value();
      return (...runtimeArgs: any[]) => {
        return helper.compute.call(helper, $_unwrapArgs(runtimeArgs), hash);
      };
    }
    // @ts-expect-error EmberFunctionalHelpers global
    if (typeof EmberFunctionalHelpers !== 'undefined' && EmberFunctionalHelpers.has(value)) {
      // @ts-expect-error amount of args
      const hash = $_args(_hash, false);
      return (...runtimeArgs: any[]) => {
        return value($_unwrapArgs(runtimeArgs), hash);
      };
    }
    return value(...$_unwrapArgs(args));
  }

  if (WITH_EMBER_INTEGRATION) {
    if ($_MANAGERS.helper.canHandle(value)) {
      return $_MANAGERS.helper.handle(value, args, _hash);
    }
  }

  if (typeof value === 'string') {
    // @ts-expect-error amount of args
    const hash = $_args(_hash, false);

    // Dynamic eval - resolve the value directly (tree-shaken when WITH_DYNAMIC_EVAL=false)
    if (WITH_DYNAMIC_EVAL) {
      // The outer getter from compiled code handles reactivity
      // Check ctx.$_eval first (passed directly, avoids closure overhead)
      // Then fall back to globalThis.$_eval for initial render
      // @ts-expect-error $_eval may exist on ctx
      const evalFn = _ctx?.$_eval ?? globalThis.$_eval;
      if (typeof evalFn === 'function') {
        try {
          const result = evalFn(value);
          // If result is a function (helper), call it with args
          return typeof result === 'function'
            ? result(...$_unwrapArgs(args))
            : result;
        } catch (e) {
          // ReferenceError is expected for undefined variables - suppress silently
          // Other errors may indicate bugs - warn in dev mode
          if (IS_DEV_MODE && !(e instanceof ReferenceError)) {
            console.warn(`[gxt] eval resolution error for "${value}":`, e);
          }
          return undefined;
        }
      }
    }

    const scopes = $_GET_SCOPES(hash, _ctx);
    for (let i = 0; i < scopes.length; i++) {
      const scope = scopes[i];
      if (value in scope) {
        const scopeVal = scope[value];
        return typeof scopeVal === 'function'
          ? scopeVal(...$_unwrapArgs(args))
          : scopeVal;
      }
    }
  }

  return value;
};

export function $_unwrapArgs(args: any[]): any[] {
  for (let i = 0; i < args.length; i++) {
    args[i] = $_unwrapHelperArg(args[i]);
  }
  return args;
}

function component(
  comp: ComponentReturnType | Component | typeof Component,
  args: Record<string, unknown>,
  ctx: Component<any> | Root,
) {
  let label = IS_DEV_MODE
    ? `${
        // @ts-expect-error debugName may not exist
        comp.debugName || comp.name || comp.constructor.name
      }`
    : '';
  if (TRY_CATCH_ERROR_HANDLING) {
    try {
      if (IS_DEV_MODE) {
        $DEBUG_REACTIVE_CONTEXTS.push(label);
        const getCircularReplacer = () => {
          const seen = new WeakSet();
          return (_: string, value: unknown) => {
            if (typeof value === 'object' && value !== null) {
              if (seen.has(value)) {
                return;
              }
              seen.add(value);
            }
            return value;
          };
        };
        label = `<${label} ${JSON.stringify(args, getCircularReplacer)} />`;
      }
      // @ts-expect-error uniqSymbol as index
      const fw = args[$PROPS_SYMBOL] as unknown as FwType;
      setParentContext(ctx);
      return _component(comp, args, fw, ctx);
    } catch (e) {
      if (import.meta.env.SSR) {
        throw e;
      }
      if (isRehydrationScheduled()) {
        throw e;
      }
      if (IS_DEV_MODE) {
        debugger;
        let ErrorOverlayClass = customElements.get('vite-error-overlay');
        let errorOverlay!: HTMLElement;
        try {
          // @ts-expect-error message may not exist or be read-only
          e.message = `${label}\n${e.message}`;
        } catch {
          // Some errors have read-only message property
        }
        if (!ErrorOverlayClass) {
          errorOverlay = document.createElement('pre');
          // @ts-expect-error stack may not exit
          errorOverlay.textContent = `${label}\n${e.stack ?? e}`;
          errorOverlay.setAttribute(
            'style',
            'color:red;border:1px solid red;padding:10px;background-color:#333;',
          );
        } else {
          errorOverlay = new ErrorOverlayClass(e, true);
        }
        console.error(label, e);

        return {
          [RENDERED_NODES_PROPERTY]: [errorOverlay],
        };
      } else {
        return {
          [RENDERED_NODES_PROPERTY]: [new HTMLBrowserDOMApi(document).text(String((e as unknown as { message: string}).message))],
        };
      }
    } finally {
      setParentContext(null);
      if (IS_DEV_MODE) {
        $DEBUG_REACTIVE_CONTEXTS.pop();
      }
    }
  } else {
    // @ts-expect-error uniqSymbol as index
    const fw = args[$PROPS_SYMBOL] as unknown as FwType;
    try {
      setParentContext(ctx);
      return _component(comp, args, fw, ctx);
    } finally {
      setParentContext(null);
    }
  }
}

function _component(
  _comp: ComponentReturnType | Component | typeof Component,
  args: Record<string, unknown>,
  fw: FwType,
  ctx: Component<any> | Root,
) {
  let startTagId = 0;
  if (IS_DEV_MODE) {
    startTagId = getTagId();
  }
  let comp = _comp;
  if (WITH_EMBER_INTEGRATION) {
    if ($_MANAGERS.component.canHandle(_comp)) {
      comp = $_MANAGERS.component.handle(_comp, args, fw, ctx)!;
    }
  }
  if (IS_GLIMMER_COMPAT_MODE) {
  } else {
    if (isTagLike(comp)) {
      comp = comp.value;
    }
  }
  if (IS_DEV_MODE) {
    if (!COMPONENTS_HMR.has(comp as any)) {
      COMPONENTS_HMR.set(comp as any, new Set());
    }
  }
  let instance =
    // @ts-expect-error construct signature
    comp.prototype === undefined
      ? // @ts-expect-error construct signature
        comp(args, fw)
      : // @ts-expect-error construct signature
        new (comp as unknown as Component<any>)(args, fw);
  if (isFn(instance)) {
    instance = new instance(args, fw);
  }
  if ($template in instance) {
    addToTree(ctx, instance, 'from $template');
    const result = (
      instance[$template] as unknown as () => ComponentReturnType
    )(
      // @ts-expect-error
      args,
    );
    if (IS_DEV_MODE) {
      // @ts-expect-error new
      instance.debugName = comp.name;
      const bucket = {
        parent: ctx,
        instance: result,
        args,
        tags: tagsFromRange(startTagId),
      };
      COMPONENTS_HMR.get(comp as any)?.add(bucket);
      registerDestructor(ctx, () => {
        COMPONENTS_HMR.get(comp as any)?.delete(bucket);
      });
      setBounds(result);
    }
    return result;
  } else if (instance) {
    addToTree(ctx, instance, 'from !$template');

    if (IS_DEV_MODE) {
      setBounds(instance);
    }
  } else {
    if (IS_DEV_MODE) {
      throw new Error(`Unknown Instance`);
    }
  }
  if (IS_DEV_MODE) {
    COMPONENTS_HMR.get(comp as any)?.add({
      parent: ctx,
      instance: instance,
      args,
      tags: tagsFromRange(startTagId),
    });
  }
  return instance;
}

function createSlot(
  value: Slots[string],
  params: () => unknown[],
  name: string,
  ctx: any,
) {
  if (IS_DEV_MODE) {
    $DEBUG_REACTIVE_CONTEXTS.push(`:${name}`);
  }
  const slotContext = {
    [$args]: {},
    [RENDERED_NODES_PROPERTY]: [],
    [COMPONENT_ID_PROPERTY]: cId(),
    [RENDERING_CONTEXT_PROPERTY]: null,
  };
  // @ts-expect-error slot return type
  addToTree(ctx, slotContext);
  const formulasToDestroy: MergedCell[] = [];
  const paramsArray = params().map((_, i) => {
    const v = formula(() => params()[i], `slot:param:${i}`);
    const value = v.value;
    if (v.isConst || typeof value === 'object') {
      v.destroy();
      return value;
    } else {
      formulasToDestroy.push(v);
      return v;
    }
  });
  if (formulasToDestroy.length > 0) {
    registerDestructor(slotContext, () => {
      for (const f of formulasToDestroy) {
        f.destroy();
      }
    });
  }
  const elements = value ? value(...[slotContext, ...paramsArray]) : [];
  if (IS_DEV_MODE) {
    $DEBUG_REACTIVE_CONTEXTS.pop();
    // @ts-expect-error
    slotContext.debugName = `slot:${name}`;
    // @ts-expect-error
    slotContext.debugInfo = {
      parent: ctx,
      params,
      name,
    };
  }

  // @ts-expect-error slot return type
  return $_fin(elements, slotContext);
}

function slot(name: string, params: () => unknown[], $slot: Slots, ctx: any) {
  if (!(name in $slot)) {
    const api = initDOM(ctx);
    const slotPlaceholder: Comment = IS_DEV_MODE
      ? api.comment(`slot-{{${name}}}-placeholder`)
      : api.comment('');
    let isRendered = false;
    let isSettled = false;
    let slotValue: Slots[string] = () => [];
    Object.defineProperty($slot, name, {
      set(value: Slots[string]) {
        isSettled = true;
        if (IS_DEV_MODE) {
          if (isRendered) {
            throw new Error(`Slot ${name} is already rendered`);
          }
        }
        slotValue = value;

        const slotRoots = createSlot(slotValue, params, name, ctx);
        renderElement(
          api,
          ctx,
          api.parent(slotPlaceholder)!,
          slotRoots as any,
          slotPlaceholder,
        );
        isRendered = true;
      },
      get() {
        if (isSettled) {
          return slotValue;
        }
        return undefined;
      },
    });
    return slotPlaceholder;
  }
  return createSlot($slot[name], params, name, ctx);
}

function getRenderTargets(api: DOMApi, debugName: string) {
  const ifPlaceholder = IS_DEV_MODE ? api.comment(debugName) : api.comment('');
  let outlet = isRehydrationScheduled()
    ? api.parent(ifPlaceholder) || api.fragment()
    : api.fragment();

  if (!ifPlaceholder.isConnected) {
    api.insert(outlet, ifPlaceholder);
  }

  return {
    placeholder: ifPlaceholder,
    outlet,
  };
}

function toNodeReturnType(
  outlet: HTMLElement | DocumentFragment,
  ctx: AsyncListComponent<any> | SyncListComponent<any> | IfCondition,
) {
  return $_fin(Array.from(outlet.childNodes), ctx);
}


function ifCond(
  cell: Cell<boolean> | MergedCell | IfFunction,
  trueBranch: BranchCb,
  falseBranch: BranchCb,
  ctx: Component<any>,
) {
  const api = initDOM(ctx);
  const { outlet, placeholder } = getRenderTargets(api, 'if-entry-placeholder');
  const instance = new IfCondition(
    ctx,
    cell,
    // @ts-expect-error
    outlet,
    placeholder,
    trueBranch,
    falseBranch,
  );
  // @ts-expect-error outlet
  return toNodeReturnType(outlet, instance);
}

export function $_eachSync<T extends { id: number }>(
  items: Cell<T[]> | MergedCell,
  fn: (item: T) => Array<ComponentReturnType | Node>,
  key: string | null = null,
  ctx: Component<any>,
) {
  const api = initDOM(ctx);
  const { outlet, placeholder } = getRenderTargets(
    api,
    'sync-each-placeholder',
  );
  const instance = new SyncListComponent(
    {
      tag: items as Cell<T[]>,
      ItemComponent: fn,
      ctx,
      key,
    },
    // @ts-expect-error outlet
    outlet,
    placeholder,
  );
  // @ts-expect-error outlet
  return toNodeReturnType(outlet, instance);
}

export function $_each<T extends { id: number }>(
  items: Cell<T[]> | MergedCell,
  fn: (item: T) => Array<ComponentReturnType | Node>,
  key: string | null = null,
  ctx: Component<any>,
) {
  const api = initDOM(ctx);
  const { outlet, placeholder } = getRenderTargets(
    api,
    'async-each-placeholder',
  );
  const instance = new AsyncListComponent(
    {
      tag: items as Cell<T[]>,
      ItemComponent: fn,
      key,
      ctx,
    },
    // @ts-expect-error outlet
    outlet,
    placeholder,
  );
  // @ts-expect-error outlet
  return toNodeReturnType(outlet, instance);
}

const ArgProxyHandler: ProxyHandler<{}> = {
  get(target: Record<string, () => unknown>, prop: string) {
    if (prop in target) {
      if (!isFn(target[prop])) {
        return target[prop];
      }
      return target[prop]();
    }
    return undefined;
  },
  set() {
    if (IS_DEV_MODE) {
      throw new Error('args are readonly');
    }
    return false;
  },
};

export function $_GET_ARGS(ctx: Component<any>, args: IArguments) {
  ctx[$args] = ctx[$args] || args[0] || {};
  ctx[RENDERED_NODES_PROPERTY] = ctx[RENDERED_NODES_PROPERTY] ?? [];
  ctx[COMPONENT_ID_PROPERTY] = ctx[COMPONENT_ID_PROPERTY] ?? cId();
  // @ts-expect-error - dynamic property
  if (!ctx[ADDED_TO_TREE_FLAG]) {
    addToTree(getParentContext()!, ctx);
  }
}

export function $_GET_SLOTS(ctx: any, args: any) {
  return (args[0] || {})[$SLOTS_SYMBOL] || ctx[$args]?.[$SLOTS_SYMBOL] || {};
}

export function $_GET_FW(ctx: any, args: any) {
  return (
    (args[0] || {})[$PROPS_SYMBOL] || ctx[$args]?.[$PROPS_SYMBOL] || undefined
  );
}

export function $_args(
  args: Record<string, unknown>,
  slots: Record<string, () => Array<ComponentReturnType | Node>> | false,
  props: FwType,
) {
  if (IS_GLIMMER_COMPAT_MODE) {
    if (IS_DEV_MODE) {
      const newArgs: Record<string, () => unknown> = {
        [$SLOTS_SYMBOL]: slots ?? {},
        [$PROPS_SYMBOL]: props ?? {},
      };
      Object.keys(args).forEach((key) => {
        try {
          Object.defineProperty(newArgs, key, {
            get() {
              if (!isFn(args[key])) {
                return args[key];
              }
              return (args[key] as () => unknown)();
            },
            enumerable: true,
          });
        } catch (e) {
          console.error(e);
        }
      });
      return newArgs;
    } else {
      Object.defineProperty(args, $SLOTS_SYMBOL, {
        value: slots ?? {},
        enumerable: false,
      });
      Object.defineProperty(args, $PROPS_SYMBOL, {
        value: props ?? {},
        enumerable: false,
      });
      return new Proxy(args, ArgProxyHandler);
    }
  } else {
    Object.defineProperty(args, $PROPS_SYMBOL, {
      value: props ?? {},
      enumerable: false,
    });
    Object.defineProperty(args, $SLOTS_SYMBOL, {
      value: slots ?? {},
      enumerable: false,
    });
    return args;
  }
}

export const $_if = ifCond;
export const $_slot = slot;
export const $_c = component;

export function $_dc(
  comp: () => ComponentReturnType | Component,
  args: Record<string, unknown>,
  ctx: Component<any>,
) {
  const api = initDOM(ctx);
  const _cmp = formula(comp, 'dynamic-component');
  let result: ComponentReturnType | null = null;
  let ref: unknown = null;
  const destructor = opcodeFor(_cmp, (value: any) => {
    if (typeof value !== 'function') {
      result = value;
      // @ts-expect-error typings error
      addToTree(ctx, result, 'from Dynamic component opcode');
      return;
    }
    if (value !== ref) {
      ref = value;
    } else {
      return;
    }
    if (result) {
      const target = result[RENDERED_NODES_PROPERTY].pop();
      const newTarget = IS_DEV_MODE
        ? api.comment('placeholder')
        : api.comment();
      const parent = api.parent(target!)!;
      api.insert(parent, newTarget, target);
      unregisterFromParent(result);
      destroyElementSync(result, false, api);
      result = component(value, args, ctx);
      result![RENDERED_NODES_PROPERTY].push(newTarget!);
      renderElement(api, ctx, parent, result, newTarget!);
    } else {
      result = component(value, args, ctx);
    }
  });
  if (!_cmp.isConst) {
    result![RENDERED_NODES_PROPERTY].push(
      IS_DEV_MODE ? api.comment('placeholder') : api.comment(),
    );
    registerDestructor(ctx, destructor);
    registerDestructor(ctx, () => {
      _cmp.destroy();
    });
  } else {
    _cmp.destroy();
    destructor();
  }
  const refResult = {
    get [RENDERING_CONTEXT_PROPERTY]() {
      return result![RENDERING_CONTEXT_PROPERTY];
    },
    set [RENDERING_CONTEXT_PROPERTY](value) {
      result![RENDERING_CONTEXT_PROPERTY] =  value;
    },
    get [COMPONENT_ID_PROPERTY]() {
      return result![COMPONENT_ID_PROPERTY];
    },
    set [COMPONENT_ID_PROPERTY](value) {
      result![COMPONENT_ID_PROPERTY] = value;
    },
    get [RENDERED_NODES_PROPERTY]() {
      return result![RENDERED_NODES_PROPERTY];
    },
    set [RENDERED_NODES_PROPERTY](value) {
      result![RENDERED_NODES_PROPERTY] = value;
    },
  };
  return refResult;
}

export const $_component = (component: any) => {
  return component;
};

export const $_maybeModifier = (
  modifier: any,
  element: HTMLElement,
  props: any[],
  hashArgs: () => Record<string, unknown>,
) => {
  if (WITH_EMBER_INTEGRATION) {
    if ($_MANAGERS.modifier.canHandle(modifier)) {
      return $_MANAGERS.modifier.handle(modifier, element, props, hashArgs);
    }
  }

  if (modifier && typeof modifier === 'function' && 'emberModifier' in modifier) {
    const instance = new modifier();
    instance.modify = instance.modify.bind(instance);
    const destructors: Destructors = [];
    return () => {
      requestAnimationFrame(() => {
        const f = formula(() => {
          const unwrappedProps = $_unwrapArgs([...props]);
          instance.modify(element, unwrappedProps, hashArgs());
        }, 'class-based modifier');
        destructors.push(
          opcodeFor(f, () => {
            // Modifier opcode executed
          }),
        );
      });
      return () => {
        destructors.forEach((fn) => fn());
        if ('willDestroy' in instance) {
          instance.willDestroy();
        }
        runDestructors(instance);
      };
    };
  }

  // @ts-expect-error EmberFunctionalModifiers global
  if (typeof EmberFunctionalModifiers !== 'undefined' && EmberFunctionalModifiers.has(modifier)) {
    return (element: HTMLElement) => {
      const args = hashArgs();
      const newArgs: Record<string, unknown> = {};
      const keys = Object.keys(args);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        Object.defineProperty(newArgs, key, {
          enumerable: true,
          get() {
            return $_unwrapHelperArg(args[key]);
          },
        });
      }
      const unwrappedProps = $_unwrapArgs([...props]);
      return modifier(element, unwrappedProps, newArgs);
    };
  }

  if (typeof modifier === 'function') {
    return (el: HTMLElement) => {
      const unwrappedProps = $_unwrapArgs([...props]);
      const hash = hashArgs();
      const unwrappedHash: Record<string, unknown> = {};
      const keys = Object.keys(hash);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        unwrappedHash[key] = $_unwrapHelperArg(hash[key]);
      }
      return modifier(el, unwrappedProps, unwrappedHash);
    };
  }

  return modifier;
};

export const $_helper = (helper: any) => {
  return helper;
};

export const $_tag = _DOM;
export const $_api = (ctx: any) => initDOM(ctx);

export function $_fin(
  roots: Array<ComponentReturnType | Node>,
  ctx:
    | Component<any>
    | AsyncListComponent<any>
    | SyncListComponent<any>
    | IfCondition,
) {
  if (IS_DEV_MODE) {
    if (!ctx) {
      throw new Error('Components without context is not supported');
    }
  }
  // @ts-expect-error
  ctx[RENDERED_NODES_PROPERTY] = roots;
  return ctx;
}

/**
 * Get the target element for rendering.
 */
export function targetFor(
  outlet: ComponentRenderTarget,
): HTMLElement | DocumentFragment {
  if ('nodeType' in outlet) {
    return outlet as HTMLElement;
  } else {
    return outlet[RENDERED_NODES_PROPERTY][0] as HTMLElement;
  }
}

/**
 * Render a component to a target element.
 * This is the main entry point for rendering an application.
 */
export function renderComponent(
  comp: typeof Component<any>,
  params: {
    owner?: Root;
    args?: Record<string, unknown>;
    element?: ComponentRenderTarget;
  } = {},
): ComponentReturnType {
  const appRoot = params.owner ?? createRoot();
  const target = params.element ?? document.body;
  const componentArgs = params.args ?? {};

  if (import.meta.env.DEV) {
    if (target === undefined) {
      throw new Error(`Trying to render undefined`);
    }
  }
  cleanupFastContext();
  const targetElement = targetFor(target);

  if (!initDOM(appRoot)) {
    // setting default dom api
    provideContext(
      appRoot,
      RENDERING_CONTEXT,
      new HTMLBrowserDOMApi((appRoot as Root).document),
    );
  }

  const instance = component(comp, componentArgs, appRoot) as ComponentReturnType;

  const dom = initDOM(appRoot);
  renderElement(
    dom,
    instance,
    targetElement as unknown as HTMLElement,
    instance as any,
    targetElement.lastChild,
  );

  return instance;
}
