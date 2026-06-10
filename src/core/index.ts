/**
 * Public API - Level 7
 *
 * This module re-exports the public API from all lower-level modules.
 */

export {
  cell,
  cellFor,
  tracked,
  getTracker,
  setTracker,
  type Cell,
  type MergedCell,
  formula,
  cached,
  type CachedCell,
} from '@/core/reactive';

// Keyed selector primitive (O(2) fan-out for `selected === key` bindings)
export { keyedSelector, type KeyedSelector } from '@/core/selector';

// Opt-in row recycling ({{#each items key="@recycle"}}). The compiler emits
// these entry points instead of $_each/$_eachSync when it sees the sentinel
// key, so the recycle runtime stays tree-shakable for apps that never use it.
export {
  $_eachRecycled,
  $_eachSyncRecycled,
  RECYCLE_KEY,
} from '@/core/control-flow/list-recycle';

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
export { setIsRendering, isRendering } from '@/core/reactive';
export { flushCellOpcodes } from '@/core/reactive';
export { setOpcodeErrorReporter, type OpcodeErrorReporter } from '@/core/reactive';
export {
  setCellUpdateDeferralHook,
  applyDeferredCellUpdate,
  type CellUpdateDeferralHook,
} from '@/core/reactive';
export { setComponentRenderErrorReporter, type ComponentRenderErrorReporter } from '@/core/dom';
export {
  setDestructionErrorReporter,
  type DestructionErrorReporter,
} from '@/core/glimmer/destroyable';

// Export decorator-free suspense utilities from suspense-utils
// For Suspense and lazy components, import directly from '@lifeart/gxt/suspense'
// or use the path alias '@/core/suspense'
export {
  followPromise,
  SUSPENSE_CONTEXT,
  type SuspenseContext,
} from '@/core/suspense-utils';

export { configureGXT, type GXTConfig, type GXTConfigInput, type PoolConfig } from '@/core/config';

// Context API exports for Ember integration
export {
  provideContext,
  getContext,
  initDOM,
  cleanupFastContext,
  RENDERING_CONTEXT,
  ROOT_CONTEXT,
} from '@/core/context';

// DOM API exports for custom rendering contexts
export { HTMLBrowserDOMApi, type DOMApi } from '@/core/dom-api';

// Symbol exports for Ember integration
export {
  RENDERING_CONTEXT_PROPERTY,
  RENDERED_NODES_PROPERTY,
  COMPONENT_ID_PROPERTY,
} from '@/core/types';
