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
import { TREE, PARENT, treeEpoch } from './tree';
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
// `rootRenderingContext` mirrors the most-recent root-level (document-having)
// rendering context. Unlike `fastRenderingContext`, it survives nested
// non-Root `provideContext` calls (e.g. CanvasRenderer / TresCanvas / PdfViewer
// providing inner per-renderer DOM apis to a synthetic root). The latent bug
// it fixes: once a nested renderer resets `fastRenderingContext` to null,
// any later mount of a *function-component* renderer whose constructor body
// calls `$_tag` BEFORE the inner `addToTree` runs (so its `[RENDERING_CONTEXT_PROPERTY]`
// is still undefined) would fall through to the parent-walk in `getContext`.
// On certain SPA navigation patterns the walk hits a node whose PARENT entry
// has been cleared (the previous render's slot/inner-root cleanup), the walk
// dies, `getContext` returns null, `initDOM` returns null, and `_DOM` then
// crashes on `api.element(...)`. Surfacing the last-known root api as a
// fallback unblocks this without changing the (correct) inner-subtree
// behavior, since `initDOM` consults `ctx[RENDERING_CONTEXT_PROPERTY]` first
// for any context that has its own provider.
let rootRenderingContext: unknown = null;

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

// EMBER_NATIVE: memoized context lookups. The Ember native layer reads the
// render tree's owner / interactivity from element modifiers and helper call
// sites (per `{{#each}}` row), and each read walked the ancestor chain up to
// the root that provides them. The walk memoizes its result on every ANCESTOR
// it passed (keyed by the node object, never by a recyclable id; not on the
// starting node, typically a per-row ctx), so the next row's lookup stops one
// level up, at the shared list / component.
//
// A memo is valid for one (context epoch, tree epoch):
//   - `provideContext` of any memoized key, and the teardown of a node's
//     provided contexts, bump the context epoch — a newly provided value is
//     never shadowed by a memo below it;
//   - tearing down a tree node (tree.ts) bumps the tree epoch — a node's
//     parent never changes while it is alive, so a memo can only go stale
//     through a teardown (a recycled id, a node re-added elsewhere).
// RENDERING_CONTEXT keeps its own fast path and is never memoized.
let contextEpoch = 0;
const NOT_FOUND = Symbol('context-not-found');
const UNDEFINED_VALUE = Symbol('context-undefined');
interface ContextMemo {
  contextEpoch: number;
  treeEpoch: number;
  /** key → the value provided above the node (or NOT_FOUND / UNDEFINED_VALUE) */
  values: Map<symbol, unknown>;
}
const CONTEXT_MEMO = new WeakMap<object, ContextMemo>();
// Reused walk buffer (lookups never nest: the walk runs no user code).
const memoPath: object[] = [];

function currentMemo(node: object): ContextMemo | undefined {
  const memo = CONTEXT_MEMO.get(node);
  return memo !== undefined &&
    memo.contextEpoch === contextEpoch &&
    memo.treeEpoch === treeEpoch
    ? memo
    : undefined;
}

function memoizedContext(ctx: ComponentLike | RootLike, key: symbol): unknown {
  let current: ComponentLike | RootLike | undefined = ctx;
  let found: unknown = NOT_FOUND;
  memoPath.length = 0;
  while (current) {
    if (current !== ctx) {
      const memoized = currentMemo(current)?.values.get(key);
      if (memoized !== undefined) {
        found = memoized;
        break;
      }
    }
    const context = CONTEXTS.get(current);
    if (context !== undefined && context.has(key)) {
      const value = context.get(key);
      found = value === undefined ? UNDEFINED_VALUE : value;
      break;
    }
    if (current !== ctx) memoPath.push(current);
    const parent = PARENT.get(current[COMPONENT_ID_PROPERTY]);
    if (parent == null) break;
    // PARENT without TREE: an inconsistent tree — stop, like the plain walk.
    current = TREE.get(parent) as ComponentLike | undefined;
  }
  for (let i = 0; i < memoPath.length; i++) {
    const node = memoPath[i]!;
    let memo = currentMemo(node);
    if (memo === undefined) {
      memo = { contextEpoch, treeEpoch, values: new Map() };
      CONTEXT_MEMO.set(node, memo);
    }
    memo.values.set(key, found);
  }
  memoPath.length = 0;
  return found;
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
  if (EMBER_NATIVE && key !== RENDERING_CONTEXT) {
    const value = memoizedContext(ctx, key);
    if (value === UNDEFINED_VALUE) return undefined as T;
    if (value !== NOT_FOUND) return (isFn(value) ? value() : value) as T;
    if (import.meta.env.DEV && required && !('document' in ctx)) {
      console.warn('Unable to resolve context for', ctx, key);
    }
    return null;
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
    // `PARENT.get(...)` returns `undefined` when the key is missing
    // (which happens for function-component instances whose ctor body
    // ran before `addToTree` registered them, e.g. `new CanvasRenderer()`
    // calling `$_tag` from inside the body). Treat undefined the same as
    // null — there's no parent to walk further. Without this guard the
    // next `TREE.get(undefined)` returns `undefined` and the
    // `current[RENDERING_CONTEXT_PROPERTY]` read crashes the render.
    const parent = PARENT.get(current[COMPONENT_ID_PROPERTY]);
    if (parent != null) {
      const next = TREE.get(parent) as ComponentLike | undefined;
      if (next === undefined) {
        // PARENT had an entry but TREE didn't — tree state is
        // inconsistent (a parent was destroyed without clearing PARENT).
        // Stop walking; fall back to whatever the caller's defaults are.
        if (IS_DEV_MODE) {
          // eslint-disable-next-line no-debugger
          debugger;
        }
        current = undefined;
        continue;
      }
      current = next;
      if (key === RENDERING_CONTEXT && current[RENDERING_CONTEXT_PROPERTY]) {
        return current[RENDERING_CONTEXT_PROPERTY] as T;
      }
    } else {
      current = undefined;
    }
  }
  // Walk failed to find the context anywhere in the parent chain. For
  // RENDERING_CONTEXT specifically, fall back to the most-recent root-level
  // (document-having) rendering context. This handles the case where a
  // nested renderer (CanvasRenderer / TresCanvas / PdfViewer) reset
  // fastRenderingContext but the chain leading back to the appRoot has a
  // broken PARENT link (e.g. a stale slot/inner-root entry from a prior
  // render that recycled IDs). Without this, initDOM returns null and
  // _DOM crashes on `api.element(...)`.
  if (key === RENDERING_CONTEXT && rootRenderingContext !== null) {
    return rootRenderingContext as T;
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
  rootRenderingContext = null;
}

export function snapshotRenderingContext(): { fast: unknown; root: unknown } {
  return { fast: fastRenderingContext, root: rootRenderingContext };
}
export function restoreRenderingContext(s: { fast: unknown; root: unknown }): void {
  fastRenderingContext = s.fast;
  rootRenderingContext = s.root;
}

export function provideContext<T>(
  ctx: ComponentLike | RootLike,
  key: symbol,
  value: T,
): void {
  if (key === RENDERING_CONTEXT) {
    if ('document' in ctx) {
      fastRenderingContext = value;
      // Mirror the resolved api into the root fallback so a later nested
      // provideContext (which sets fastRenderingContext = null) doesn't
      // erase the only reference to the document-bound api.
      rootRenderingContext = isFn(value) ? (value as () => unknown)() : value;
      registerDestructor(ctx, () => {
        fastRenderingContext = null;
        // Keep the rootRenderingContext as-is on per-Root teardown; it gets
        // overwritten on the next root provide, and a transient null there
        // would re-introduce the original crash for renderers mounted in
        // the destruction window.
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
      if (EMBER_NATIVE) contextEpoch++;
    });
  }

  CONTEXTS.get(ctx)!.set(key, value);
  // RENDERING_CONTEXT is never memoized (its own fast path above).
  if (EMBER_NATIVE && key !== RENDERING_CONTEXT) contextEpoch++;
}
