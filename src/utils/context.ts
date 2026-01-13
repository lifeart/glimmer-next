import { registerDestructor } from './glimmer/destroyable';
import { Component } from './component';
import {
  COMPONENT_ID_PROPERTY,
  isFn,
  PARENT,
  RENDERING_CONTEXT_PROPERTY,
  TREE,
} from './shared';
import { Root } from './dom';
import type { DOMApi } from './dom-api';

const CONTEXTS = new WeakMap<Component<any> | Root, Map<symbol, any>>();
export const RENDERING_CONTEXT = Symbol('RENDERING_CONTEXT');
export const ROOT_CONTEXT = Symbol('ROOT');
export const API_FACTORY_CONTEXT = Symbol('API_FACTORY');

export function context(
  contextKey: symbol,
): (
  klass: any,
  key: string,
  descriptor?: PropertyDescriptor & { initializer?: () => any },
) => void {
  return function contextDecorator(
    _: any,
    __: string,
    descriptor?: PropertyDescriptor & { initializer?: () => any },
  ) {
    return {
      get() {
        return (
          getContext(this, contextKey) || descriptor!.initializer?.call(this)
        );
      },
    };
  };
}

export function initDOM(ctx: Component<any> | Root) {
  if (fastRenderingContext !== null) {
    return fastRenderingContext as DOMApi;
  }
  const renderingContext = ctx[RENDERING_CONTEXT_PROPERTY];
  if (renderingContext) {
    return renderingContext;
  }
  return (ctx[RENDERING_CONTEXT_PROPERTY] = getContext<DOMApi>(
    ctx,
    RENDERING_CONTEXT,
  )!);
}

export function getDocument(ctx: Component<any> | Root) {
  const root = getContext<Root>(ctx, ROOT_CONTEXT);
  const document = root!.document;
  return document;
}

export function getContext<T>(
  ctx: Component<any> | Root,
  key: symbol,
): T | null {
  // console.log('getContext', key);
  let current: Component<any> | Root | undefined = ctx;
  let context: Map<symbol, any> | undefined;
  const lookupTree = [];
  while (current) {
    context = CONTEXTS.get(current);
    if (import.meta.env.DEV) {
      lookupTree.push([current, context]);
    }

    if (context?.has(key)) {
      const value = context.get(key);
      return isFn(value) ? value() : value;
    }
    const parent = PARENT.get(current[COMPONENT_ID_PROPERTY])!;
    if (parent !== null) {
      current = TREE.get(parent) as Component<any>;
      if (IS_DEV_MODE) {
        if (!current) {
          debugger;
        }
      }
      if (key === RENDERING_CONTEXT && current[RENDERING_CONTEXT_PROPERTY]) {
        return current[RENDERING_CONTEXT_PROPERTY] as T;
      }
    } else {
      current = undefined;
    }
  }
  // TODO: add fancy error message about missing provider in dev mode,
  // we may track context usage and provide a better error message
  if (import.meta.env.DEV && !current && !(ctx instanceof Root)) {
    console.log('`Unable to resolve parent for ', ctx, key);
    console.log('Lookup tree:', lookupTree);
    debugger;
  }

  return null;
}

let fastRenderingContext: unknown = null;
export function cleanupFastContext() {
  fastRenderingContext = null;
}

export function provideContext<T>(
  ctx: Component<any> | Root,
  key: symbol,
  value: T,
): void {
  if (key === RENDERING_CONTEXT) {
    if (ctx instanceof Root) {
      fastRenderingContext = value;
      registerDestructor(ctx, () => {
        fastRenderingContext = null;
      });
    } else {
      // if we trying to set more than one contexts, we resetting fast path
      fastRenderingContext = null;
    }
    // Update cached rendering context property to ensure initDOM returns the new value
    // If value is a function, evaluate it (lazy provider pattern)
    ctx[RENDERING_CONTEXT_PROPERTY] = (isFn(value) ? value() : value) as DOMApi;
  }
  if (!CONTEXTS.has(ctx)) {
    if (import.meta.env.DEV) {
      if (!ctx) {
        throw new Error('Unable to provide context to empty root');
      }
    }
    CONTEXTS.set(ctx, new Map());
    registerDestructor(ctx, () => {
      CONTEXTS.delete(ctx);
    });
  }

  CONTEXTS.get(ctx)!.set(key, value);
}
