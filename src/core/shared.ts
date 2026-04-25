/**
 * Shared Utilities - Level 0
 *
 * This module contains pure utility functions with minimal dependencies.
 * It re-exports from types.ts and tree.ts for backward compatibility.
 */

import type { AnyCell } from './reactive';

// Re-export from types.ts for backward compatibility
export {
  isTag,
  RENDERING_CONTEXT_PROPERTY,
  RENDERED_NODES_PROPERTY,
  COMPONENT_ID_PROPERTY,
  ADDED_TO_TREE_FLAG,
  type ComponentLike,
  type GenericReturnType,
  type RenderableElement,
  type ComponentRenderTarget,
  type Slots,
  type DOMApi,
  type Props,
  type TOC,
} from './types';

// Re-export from tree.ts for backward compatibility
export {
  TREE,
  CHILD,
  PARENT,
  cId,
  releaseId,
  addToTree,
} from './tree';

// Import isTag for use in isTagLike
import { isTag, RENDERED_NODES_PROPERTY, type ComponentLike } from './types';
import { registerDestructor } from './glimmer/destroyable';

// ============================================
// Constants
// ============================================

export const $template = 'template' as const;
export const $args = 'args' as const;
export const $_debug_args = '_debug_args' as const;
export const $fwProp = '$fw' as const;
export const noop = () => {};

// Same registered symbol that dom.ts publishes as `$SLOTS_SYMBOL`.
// Defined here too so component-class.ts and the template-only-component
// factory in plugins/runtime-compiler.ts can read slots without
// importing from dom.ts (which would form an import cycle through
// component-class -> dom -> component-class).
const SLOTS = Symbol.for('gxt-slots');

/**
 * Backing implementation of `(has-block)` / `this.$_hasBlock(name)`.
 *
 * The compiler emits `(has-block)` in compat mode as a method call on
 * `this`, so both the `Component` base class and the template-only-
 * component instance object need this method bound to themselves.
 *
 * @internal — exported so both invokers share one implementation.
 */
export function $_hasBlockMethod(this: any, name: string = 'default'): boolean {
  const args = this[$args] as undefined | Record<string | symbol, unknown>;
  const slots = (args?.[SLOTS] as Record<string, unknown>) ?? {};
  return name in slots && slots[name] !== undefined;
}

/**
 * Backing implementation of `(has-block-params)` / `this.$_hasBlockParams(name)`.
 *
 * The slot's "has block params" marker lives at `slots[`${name}_`]` —
 * the trailing-underscore convention is set up by `$_args` in dom.ts.
 *
 * @internal — exported so both invokers share one implementation.
 */
export function $_hasBlockParamsMethod(this: any, name: string = 'default'): unknown {
  const args = this[$args] as undefined | Record<string | symbol, unknown>;
  const slots = (args?.[SLOTS] as Record<string, unknown>) ?? {};
  return slots[`${name}_`];
}

export const IN_SSR_ENV =
  import.meta.env.SSR || location.pathname === '/tests.html';
export const $DEBUG_REACTIVE_CONTEXTS: string[] = [];

// ============================================
// Utility Functions
// ============================================

export function debugContext(debugName?: string): string {
  return [
    ...$DEBUG_REACTIVE_CONTEXTS.filter((el) => el !== 'UnstableChildWrapper'),
    debugName,
  ].join(' > ');
}

export function isArray(value: unknown): value is Array<any> {
  return Array.isArray(value);
}

export function isFn(value: unknown): value is Function {
  return typeof value === 'function';
}

export function isEmpty(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

export function isPrimitive(value: unknown): value is string | number {
  const vType = typeof value;
  return (
    vType === 'string' ||
    vType === 'number' ||
    vType === 'boolean' ||
    vType === 'bigint'
  );
}

export function isTagLike(child: unknown): child is AnyCell {
  return (child as AnyCell)[isTag];
}

// ============================================
// Component Bounds Management
// ============================================

export const BOUNDS = new WeakMap<
  ComponentLike,
  Array<HTMLElement | Comment>
>();

export function getBounds(ctx: ComponentLike): Array<HTMLElement | Comment> {
  if (ctx[RENDERED_NODES_PROPERTY].length) {
    return ctx[RENDERED_NODES_PROPERTY].slice(0) as Array<HTMLElement | Comment>;
  }
  return BOUNDS.get(ctx) ?? [];
}

export function setBounds(component: ComponentLike): void {
  if (import.meta.env.SSR) {
    return;
  }
  const ctx = component;
  if (!ctx) {
    return;
  }
  const maybeBounds: Array<HTMLElement | Comment> = component[RENDERED_NODES_PROPERTY].map(
    (node) => {
      const isHTMLElement = node instanceof HTMLElement;
      if (!isHTMLElement) {
        if (node instanceof Comment) {
          return [node, node.nextSibling];
        } else if (node instanceof DocumentFragment) {
          return [];
        }
      }
      if (isHTMLElement) {
        return [node];
      }
      return [];
    },
  ) as unknown as HTMLElement[];

  const flattenBounds = maybeBounds
    .flat(Infinity)
    .filter((node) => node !== null);
  if (flattenBounds.length === 0) {
    return;
  }
  BOUNDS.set(ctx, flattenBounds as Array<HTMLElement | Comment>);
  registerDestructor(ctx, () => {
    BOUNDS.delete(ctx);
  });
}

// ============================================
// HMR Support
// ============================================

import type { Cell } from './reactive';

// Use ComponentLike instead of Component to avoid circular dependency
type BasicListComponentLike = {
  keyMap: Map<string, unknown>;
  indexMap: Map<string, number>;
};

type GenericReturnTypeLike = ComponentLike | Node | Array<ComponentLike | Node> | null | null[];

export const LISTS_FOR_HMR: Set<BasicListComponentLike> = new Set();
export const IFS_FOR_HMR: Set<
  () => { item: GenericReturnTypeLike; set: (item: GenericReturnTypeLike) => void }
> = new Set();
export const COMPONENTS_HMR = new WeakMap<
  ComponentLike | typeof Object,
  Set<{
    parent: any;
    instance: ComponentLike;
    args: Record<string, unknown>;
    tags: Cell[];
  }>
>();
