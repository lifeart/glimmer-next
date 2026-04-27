/**
 * Tracking - Level 1
 *
 * Parent context stack for tracking component hierarchy during rendering.
 * This module was previously named parent-context.ts.
 */

import {
  COMPONENT_ID_PROPERTY,
  type ComponentLike,
} from './types';
import { TREE } from './tree';

// `parentContextStack.length - 1` IS the active index — keeping a parallel
// `parentContextIndex` doubled the bookkeeping (every push/pop incremented or
// decremented two counters) for no benefit. Single source of truth keeps the
// hot path tighter and reduces ICs that V8 has to track.
const parentContextStack: Array<number> = [];

if (IS_DEV_MODE) {
  try {
    // @ts-expect-error - dev mode debugging
    window.parentContext = parentContextStack;
    // @ts-expect-error - dev mode debugging
    window.resolveParents = () => parentContextStack.map((id) => TREE.get(id));
  } catch (e) {
    // Ignore - may not have window
  }
}

/**
 * Push a component onto the parent context stack.
 * Split into push/pop for hot path performance - avoids null check on every call.
 */
export const pushParentContext = (value: ComponentLike): void => {
  parentContextStack.push(value[COMPONENT_ID_PROPERTY]!);
};

/**
 * Pop a component from the parent context stack.
 */
export const popParentContext = (): void => {
  parentContextStack.pop();
};

/**
 * Set or clear the parent context (backward compatibility wrapper).
 */
export const setParentContext = (value: ComponentLike | null): void => {
  if (value === null) {
    parentContextStack.pop();
  } else {
    parentContextStack.push(value[COMPONENT_ID_PROPERTY]!);
  }
};

/**
 * Get the current parent context component.
 * Return type is 'any' to avoid type dependency on Component<any>.
 */
export const getParentContext = (): any => {
  return TREE.get(parentContextStack[parentContextStack.length - 1]!);
};
