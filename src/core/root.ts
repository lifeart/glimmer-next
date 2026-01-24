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
import { isPrimitive, isEmpty } from './shared';
import { provideContext, ROOT_CONTEXT } from './context';

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
 * Resolve a renderable function to its value, creating a reactive formula if needed.
 * This is used to unwrap function-based templates into their actual renderable content.
 */
export function resolveRenderable(
  child: Function,
  debugName = 'resolveRenderable',
): RenderableType | MergedCell | Cell {
  const f = formula(() => deepFnValue(child), debugName);
  let componentProps: RenderableType = '';
  checkOpcode(f, (value) => {
    componentProps = value as unknown as RenderableType;
  });
  if (f.isConst) {
    f.destroy();
    return componentProps;
  } else {
    if (isPrimitive(componentProps) || isEmpty(componentProps)) {
      return f;
    } else {
      // looks like a component
      return componentProps;
    }
  }
}
