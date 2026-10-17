/**
 * Root - Level 3
 *
 * Root class and related utilities for application roots.
 * This module was previously named dom-primitives.ts.
 */

import {
  Cell,
  MergedCell,
  formula,
  deepFnValue,
  materializeAbsentPathCell,
  registerLeafOwnersForFormula,
} from '@/core/reactive';
import { checkOpcode } from '@/core/vm';
import { registerDestructor } from './glimmer/destroyable';
import {
  RENDERING_CONTEXT_PROPERTY,
  RENDERED_NODES_PROPERTY,
  COMPONENT_ID_PROPERTY,
  type DOMApi,
} from './types';
import { TREE, CHILD, PARENT, cId } from './tree';
import { isPrimitive, isEmpty, isArray } from './shared';
import { provideContext, ROOT_CONTEXT } from './context';
import { nativeContentBinding, nativeDeepFnValue, stashInitialContent } from './native-content';

type RenderableType = Node | string | number | { [RENDERED_NODES_PROPERTY]: unknown[] };

/**
 * Root is the top-level application context (owner in Ember naming).
 * Acts as main DI container and metadata storage.
 */
export class Root {
  [RENDERED_NODES_PROPERTY]: Array<Node> = [];
  [COMPONENT_ID_PROPERTY] = cId();
  [RENDERING_CONTEXT_PROPERTY]: DOMApi | undefined = undefined;
  declare document: Document;

  constructor(document: Document = globalThis.document) {
    this.document = document;
    provideContext(this, ROOT_CONTEXT, this);
    const id = this[COMPONENT_ID_PROPERTY];
    CHILD.set(id, new Set());
    TREE.set(id, this as any);
    if (WITH_CONTEXT_API) {
      // @ts-expect-error - null parent for root
      PARENT.set(id, null);
    }
    registerDestructor(this, () => {
      CHILD.delete(id);
      TREE.delete(id);
      if (WITH_CONTEXT_API) {
        PARENT.delete(id);
      }
    });
  }
}

/**
 * Create a new Root instance.
 */
export function createRoot(document?: Document): Root {
  const root = new Root(document);
  return root;
}

/**
 * A non-text content value the native dynamic-content binding renders: not a
 * primitive / nullish, and not a gxt renderable (a component instance or a
 * renderable array, which keep their historic static rendering).
 */
function isNativeContentValue(value: unknown): boolean {
  if (isPrimitive(value) || isEmpty(value) || isArray(value)) return false;
  if (typeof value === 'object' && RENDERED_NODES_PROPERTY in (value as object)) return false;
  return true;
}

/**
 * Resolve a renderable function to its value, creating a reactive formula if needed.
 * This is used to unwrap function-based templates into their actual renderable content.
 */
export function resolveRenderable(
  child: Function,
  debugName = 'resolveRenderable',
): RenderableType | MergedCell | Cell {
  // EMBER_NATIVE dynamic content (G15, native-content.ts): a content value
  // may be — or become — a node, trusted HTML or a component; it stays a
  // reactive binding whatever its first value is.
  const native = nativeContentBinding() !== null;
  const f = native
    ? formula(() => nativeDeepFnValue(child), debugName)
    : formula(() => deepFnValue(child), debugName);
  let componentProps: RenderableType = '';
  checkOpcode(f, (value) => {
    componentProps = value as unknown as RenderableType;
  });
  if (f.isConst) {
    // A const formula whose value is empty may be an initially-undefined
    // `this.<path>` binding that read no cell. Materialize the leaf cell and
    // re-wrap; the new formula tracks a real cell so a later
    // `set(context,'<path>',...)` updates the binding.
    if (
      (isPrimitive(componentProps) || isEmpty(componentProps)) &&
      materializeAbsentPathCell(child)
    ) {
      f.destroy();
      const f2 = formula(() => deepFnValue(child), debugName);
      checkOpcode(f2, (value) => {
        componentProps = value as unknown as RenderableType;
      });
      if (!f2.isConst) {
        registerLeafOwnersForFormula(f2);
        return f2;
      }
      f2.destroy();
      return componentProps;
    }
    if (native && isNativeContentValue(componentProps)) {
      // A constant node / SafeString / component definition: rendered by the
      // dynamic-content binding, from the value read above.
      stashInitialContent(f, componentProps);
      return f;
    }
    f.destroy();
    return componentProps;
  } else {
    if (
      isPrimitive(componentProps) ||
      isEmpty(componentProps) ||
      (native && isNativeContentValue(componentProps))
    ) {
      // Register leaf-object owners so a nested-property `set()` on a held
      // object dirties this cell.
      registerLeafOwnersForFormula(f);
      // Ember (native and compat): the binding applies the value read above
      // (one create read; `opcodeForCreatedContent`).
      if (native || WITH_EMBER_INTEGRATION) stashInitialContent(f, componentProps);
      return f;
    } else {
      // looks like a component
      return componentProps;
    }
  }
}
