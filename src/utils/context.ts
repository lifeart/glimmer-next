import { registerDestructor } from './glimmer/destroyable';
import { Component } from './component';
import { isFn, PARENT_GRAPH } from './shared';
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
  return getContext<typeof DOM_API>(ctx, RENDERING_CONTEXT)!;
}

export function getContext<T>(
  ctx: Component<any> | Root,
  key: symbol,
): T | null {
  if (!WITH_CONTEXT_API) {
    ctx = getRoot()!;
  }
  let current: Component<any> | Root | null = ctx;
  while (current) {
    const context = CONTEXTS.get(current);

    if (context?.has(key)) {
      const value = context.get(key);
      const result = isFn(value) ? value() : value;
      return result;
    }

    const parent = findParentComponent(current);
    if (import.meta.env.DEV) {
      if (!parent) {
        console.log('`Unable to resolve parent for ', current);
        debugger;
      }
    }
    current = parent;
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

function findParentComponent(
  component: Component<any> | Root,
): Component<any> | Root | null {
  return PARENT_GRAPH.get(component)! ?? null;
}
