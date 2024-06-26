import { registerDestructor } from './glimmer/destroyable';
import { Component } from './component';
import { PARENT_GRAPH } from './shared';
import { getRoot } from './dom';

const CONTEXTS = new WeakMap<Component<any>, Map<symbol, any>>();

export function context(contextKey: symbol): (klass: any, key: string, descriptor?: PropertyDescriptor & { initializer?: () => any } ) => void {
  return function contextDecorator(
    _: any,
    __: string,
    descriptor?: PropertyDescriptor & { initializer?: () => any },
  ) {
    return {
      get() {
        return getContext(this, contextKey) || getContext(getRoot()!, contextKey) || descriptor!.initializer?.call(this);
      },
    }
  }
};

export function getContext<T>(ctx: Component<any>, key: symbol): T | null {
  let current: Component<any> | null = ctx;
  while (current) {
    const context = CONTEXTS.get(current);
    if (context?.has(key)) {
      const value = context.get(key);
      return typeof value === 'function' ? value() : value;
    }

    const parent = findParentComponent(current);
    current = parent;
  }
  return null;
}

export function provideContext<T>(
  ctx: Component<any>,
  key: symbol,
  value: T,
): void {
  if (!CONTEXTS.has(ctx)) {
    CONTEXTS.set(ctx, new Map());
  }

  CONTEXTS.get(ctx)!.set(key, value);

  registerDestructor(ctx, () => {
    CONTEXTS.get(ctx)!.delete(key);
  });
}

function findParentComponent(component: Component<any>): Component<any> | null {
  return PARENT_GRAPH.get(component)! ?? null;
}
