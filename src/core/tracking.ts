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
import { HOST_HOOKS } from './host-hooks';

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
  // Host render-scope mirror: every push of the scope stack is the host's cue
  // to push its parentView. No-op when no host registered the hook.
  if (HOST_HOOKS.onEnterRenderScope) HOST_HOOKS.onEnterRenderScope(value);
};

/**
 * Pop a component from the parent context stack.
 */
export const popParentContext = (): void => {
  parentContextStack.pop();
  if (HOST_HOOKS.onLeaveRenderScope) HOST_HOOKS.onLeaveRenderScope();
};

/**
 * Set or clear the parent context (backward compatibility wrapper).
 */
export const setParentContext = (value: ComponentLike | null): void => {
  if (value === null) {
    parentContextStack.pop();
    if (HOST_HOOKS.onLeaveRenderScope) HOST_HOOKS.onLeaveRenderScope();
  } else {
    parentContextStack.push(value[COMPONENT_ID_PROPERTY]!);
    if (HOST_HOOKS.onEnterRenderScope) HOST_HOOKS.onEnterRenderScope(value);
  }
};

/**
 * Get the current parent context component.
 * Return type is 'any' to avoid type dependency on Component<any>.
 */
export const getParentContext = (): any => {
  return TREE.get(parentContextStack[parentContextStack.length - 1]!);
};

/**
 * Snapshot the parent-context stack contents (root-boundary only, never per-node).
 */
export function snapshotParentContext(): number[] {
  return parentContextStack.slice();
}

/**
 * Refill the parent-context stack from a snapshot. Keeps the `const` binding
 * (and the dev-mode `window.parentContext` reference) valid by mutating in place
 * rather than reassigning. At a balanced root boundary the depth is ~0.
 */
export function restoreParentContext(s: readonly number[]): void {
  parentContextStack.length = 0;
  for (let i = 0; i < s.length; i++) parentContextStack.push(s[i]!);
}
