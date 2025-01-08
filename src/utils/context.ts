import { registerDestructor } from './glimmer/destroyable';
import { Component } from './component';
import { isFn, PARENT_GRAPH, RENDERING_CONTEXT_PROPERTY } from './shared';
import { getRoot, Root } from './dom';
import type { api as DOM_API } from './dom-api';

const CONTEXTS = new WeakMap<Component<any> | Root, Map<symbol, any>>();
export const RENDERING_CONTEXT = Symbol('RENDERING_CONTEXT');

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
          getContext(this, contextKey) ||
          getContext(getRoot()!, contextKey) ||
          descriptor!.initializer?.call(this)
        );
      },
    };
  };
}


export function initDOM(ctx: Component<any> | Root) {
  const renderingContext = ctx[RENDERING_CONTEXT_PROPERTY];
  if (renderingContext) {
    return renderingContext;
  }
  return (ctx[RENDERING_CONTEXT_PROPERTY] = getContext<typeof DOM_API>(ctx, RENDERING_CONTEXT)!);
}

export function getContext<T>(
  ctx: Component<any> | Root,
  key: symbol,
): T | null {
  if (!WITH_CONTEXT_API) {
    ctx = getRoot()!;
  }
  
  let current: Component<any> | Root | undefined = ctx;
  let context: Map<symbol, any> | undefined;
  
  // Direct lookup first
  context = CONTEXTS.get(current);
  if (context?.has(key)) {
    const value = context.get(key);
    return isFn(value) ? value() : value;
  }

  // Parent chain lookup
  while (current = PARENT_GRAPH.get(current)) {
    if ((context = CONTEXTS.get(current))?.has(key)) {
      const value = context.get(key);
      return isFn(value) ? value() : value;
    }
  }

  if (import.meta.env.DEV && !current) {
    console.log('`Unable to resolve parent for ', ctx);
    debugger;
  }

  return null;
}

export function provideContext<T>(
  ctx: Component<any> | Root,
  key: symbol,
  value: T,
): void {
  if (!WITH_CONTEXT_API) {
    ctx = getRoot()!;
  }
  if (!CONTEXTS.has(ctx)) {
    if (import.meta.env.DEV) {
      if (!ctx) {
        throw new Error("Unable to provide context to empty root");
      }
    }
    CONTEXTS.set(ctx, new Map());
    registerDestructor(ctx, () => {
      CONTEXTS.delete(ctx);
    });
  }

  CONTEXTS.get(ctx)!.set(key, value);
}
