/**
 * Public API - Level 7
 *
 * This module re-exports the public API from all lower-level modules.
 */

export {
  cell,
  cellFor,
  tracked,
  type Cell,
  type MergedCell,
  formula,
} from '@/core/reactive';

// Component class and types
export { Component, type ComponentReturnType } from '@/core/component-class';

// Rendering functions
export { renderComponent } from '@/core/dom';

// Destruction functions
export { runDestructors, destroyElementSync } from '@/core/destroy';

export { registerDestructor } from '@/core/glimmer/destroyable';
export { hbs, scope } from '@/core/template';
export { effect } from '@/core/vm';

// Note: dom.ts imports from component modules but component modules no longer import from dom.ts
// (uses direct imports), so this is now a one-way dependency
export * from '@/core/dom';

export { Root, createRoot } from '@/core/root';

export * from '@/core/helpers/index';
export { $template, $args, $fwProp } from '@/core/shared';
export { syncDom, takeRenderingControl } from '@/core/runtime';

// Export decorator-free suspense utilities from suspense-utils
// For Suspense and lazy components, import directly from '@lifeart/gxt/suspense'
// or use the path alias '@/core/suspense'
export {
  followPromise,
  SUSPENSE_CONTEXT,
  type SuspenseContext,
} from '@/core/suspense-utils';

export { configureGXT, type GXTConfig, type GXTConfigInput, type PoolConfig } from '@/core/config';
