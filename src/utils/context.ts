import { registerDestructor } from './glimmer/destroyable';
import { Component } from './component';
import { isFn, PARENT_GRAPH } from './shared';
import { getRoot, Root } from './dom';

const CONTEXTS = new WeakMap<Component<any> | Root, Map<symbol, any>>();

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

const LOOKUP_CACHE: WeakMap<Component<any> | Root, Map<symbol, unknown>> = new WeakMap();

export function getContext<T>(
  ctx: Component<any> | Root,
  key: symbol,
): T | null {
  if (!LOOKUP_CACHE.has(ctx)) {
    LOOKUP_CACHE.set(ctx, new Map());
    registerDestructor(ctx, () => {
      LOOKUP_CACHE.delete(ctx);
    });
  }
  const cache = LOOKUP_CACHE.get(ctx)!;
  if (cache.has(key)) {
    const result = cache.get(key) as T;
    return isFn(result) ? result() : result;
  }
  let current: Component<any> | Root | null = ctx;
  while (current) {
    const context = CONTEXTS.get(current);

    if (context?.has(key)) {
      const value = context.get(key);
      const result = isFn(value) ? value() : value;
      cache.set(key, value);
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
