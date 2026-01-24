/**
 * Context - Level 2
 *
 * Context API for providing and consuming values through the component tree.
 */

import { registerDestructor } from './glimmer/destroyable';
import {
  COMPONENT_ID_PROPERTY,
  RENDERING_CONTEXT_PROPERTY,
  type DOMApi,
  type ComponentLike,
  type RootLike,
} from './types';
import { TREE, PARENT } from './tree';
import { isFn } from './shared';

const CONTEXTS = new WeakMap<ComponentLike | RootLike, Map<symbol, any>>();
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

let fastRenderingContext: unknown = null;

export function initDOM(ctx: ComponentLike | RootLike): DOMApi {
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

export function getDocument(ctx: ComponentLike | RootLike): Document {
  const root = getContext<RootLike>(ctx, ROOT_CONTEXT);
  const document = root!.document;
  return document;
}

export function getContext<T>(
  ctx: ComponentLike | RootLike,
  key: symbol,
  /** Set to false for optional contexts that may not be provided */
  required: boolean = true,
): T | null {
  // Fast path for RENDERING_CONTEXT - most common lookup
  if (key === RENDERING_CONTEXT && fastRenderingContext !== null) {
    return fastRenderingContext as T;
  }
  let current: ComponentLike | RootLike | undefined = ctx;
  let context: Map<symbol, any> | undefined;
  const lookupTree: unknown[] = [];
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
      current = TREE.get(parent) as ComponentLike;
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
  // Warn when required context is not found
  if (import.meta.env.DEV && required && !('document' in ctx)) {
    console.warn('Unable to resolve context for', ctx, key);
    console.warn('Lookup tree:', lookupTree);
  }

  return null;
}

export function cleanupFastContext(): void {
  fastRenderingContext = null;
}

export function provideContext<T>(
  ctx: ComponentLike | RootLike,
  key: symbol,
  value: T,
): void {
  if (key === RENDERING_CONTEXT) {
    if ('document' in ctx) {
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
