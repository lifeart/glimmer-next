import {
  associateDestroyable,
  Component,
  ComponentReturnType,
  relatedRoots,
} from '@/utils/component';
import { type AnyCell } from './reactive';

export const isTag = Symbol('isTag');
export const $template = 'template' as const;
export const $nodes = 'nodes' as const;
export const $args = 'args' as const;
export const $_debug_args = '_debug_args' as const;
export const $fwProp = '$fw' as const;
export const $node = 'node' as const;
export const $slotsProp = 'slots' as const;
export const $propsProp = 'props' as const;
export const $attrsProp = 'attrs' as const;
export const $eventsProp = 'events' as const;

export function isFn(value: unknown): value is Function {
  return typeof value === 'function';
}
export function isPrimitive(value: unknown): value is string | number {
  const vType = typeof value;
  return (
    vType === 'string' ||
    vType === 'number' ||
    vType === 'boolean' ||
    vType === 'bigint' ||
    vType === 'undefined'
  );
}

export function isTagLike(child: unknown): child is AnyCell {
  return (child as AnyCell)[isTag];
}

export const RENDER_TREE = new WeakMap<Component<any>, Array<Component>>();
export const BOUNDS = new WeakMap<
  Component<any>,
  Array<HTMLElement | Comment>
>();
export function getBounds(ctx: Component<any>) {
  return BOUNDS.get(ctx) ?? [];
}
export function setBounds(component: ComponentReturnType) {
  const ctx = component.ctx;
  if (!ctx) {
    return;
  }
  const maybeBounds: Array<HTMLElement | Comment> = component[$nodes].map(
    (node) => {
      const isHTMLElement = node instanceof HTMLElement;
      if (!isHTMLElement) {
        if (node instanceof Comment) {
          return [node, node.nextSibling];
        } else if (node instanceof DocumentFragment) {
          const roots = relatedRoots.get(node);
          if (roots && !Array.isArray(roots) && $nodes in roots) {
            return roots[$nodes].map((node) => {
              if (node instanceof Comment) {
                return [node, node.nextSibling];
              } else {
                return node;
              }
            });
          }
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
  BOUNDS.set(ctx, flattenBounds);
  associateDestroyable(ctx, [
    () => {
      BOUNDS.delete(ctx);
    },
  ]);
}
export function addToTree(
  ctx: Component<any>,
  node: Component<any>,
  debugName?: string,
) {
  if (IS_DEV_MODE) {
    if (node instanceof Node) {
      throw new Error('invalid node');
    } else if ('ctx' in node && node.ctx === null) {
      // if it's simple node without context, no needs to add it to the tree as well
      // for proper debug this logic need to be removed
      // it's error prone approach because if we had complex component as child will see memory leak
      throw new Error('invalid node');
    }
  }
  // @todo - case 42
  associateDestroyable(node, [
    () => {
      const tree = RENDER_TREE.get(ctx)!;
      const index = tree.indexOf(node);
      if (index !== -1) {
        tree.splice(index, 1);
        if (tree.length === 0) {
          RENDER_TREE.delete(ctx);
        }
      }
    },
  ]);

  if (IS_DEV_MODE) {
    if (debugName) {
      Object.defineProperty(node, 'debugName', {
        value: debugName,
        enumerable: false,
      });
    }
    if (!node) {
      throw new Error('invalid node');
    }
    if (!ctx) {
      throw new Error('invalid ctx');
    }
  } else {
    if (!ctx) {
      console.error('Unable to set child for unknown parent');
    }
  }

  if (!RENDER_TREE.has(ctx)) {
    RENDER_TREE.set(ctx, []);
  }
  RENDER_TREE.get(ctx)!.push(node);
}
