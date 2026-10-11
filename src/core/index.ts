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
  cachedHelper,
  type CachedCell,
} from '@/core/reactive';

// Host tag primitives: Glimmer tag protocol on gxt cells (one reactive system
// for hosts such as Ember's native layer). See src/core/tags.ts.
export {
  tagFor,
  tagMetaFor,
  peekTagFor,
  dirtyCell,
  currentRevision,
  UNSET,
  type TagMeta,
} from '@/core/tags';

// Keyed selector primitive (O(2) fan-out for `selected === key` bindings)
export { keyedSelector, type KeyedSelector } from '@/core/selector';

// Opt-in row recycling ({{#each items key="@recycle"}}) lives in its own
// `@lifeart/gxt/recycle` entry (src/core/recycle.ts) so the ~0.95KB-br
// list-recycle.ts runtime tree-shakes OUT of this `.` barrel for apps that
// never use the sentinel key. The compiler emits $_eachRecycled /
// $_eachSyncRecycled; AOT output auto-imports them from that entry (only when a
// template uses key="@recycle"), and runtime-compiled apps call
// registerRecycleRuntime() from '@lifeart/gxt/recycle'.

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

// Render-root isolation (synchronous, opt-in) for SSR drivers.
export {
  withRenderRoot,
  createRenderRootState,
  type RenderRootState,
} from '@/core/render-root';

// Rehydration entry points (close the public-barrel export gap so the ember
// dual-backend delegate can reach them from `@lifeart/gxt`).
export {
  withRehydration,
  isRehydrationScheduled,
  lastItemInStack,
} from '@/core/ssr/rehydration';

export * from '@/core/helpers/index';
export { $template, $args, $fwProp } from '@/core/shared';
export { syncDom, takeRenderingControl, flushRevalidation } from '@/core/runtime';
// Template-function brand (G14): compiler-emitted `$_tpl` + host-side check.
export { $_tpl, isTemplateFn } from '@/core/template-fn';
export {
  getCurried,
  isCurried,
  resolveCurried,
  CURRIED_COMPONENT,
  CURRIED_HELPER,
  CURRIED_MODIFIER,
  type CurriedKind,
  type CurriedState,
  type ResolvedCurried,
} from '@/core/curried';
// Component-tree id allocator: a host manager that constructs a component
// instance itself (not a gxt `Component`) gives it a tree identity before gxt
// adds it to the render tree.
export { cId } from '@/core/tree';
export {
  registerHostHooks,
  type HostHooks,
  type ConditionBranchMeta,
} from '@/core/host-hooks';
// Native `{{#each-in}}` key-SET reactivity primitive. A host that rewrites
// `{{#each-in obj}}` to iterate an object's keys entangles its per-object
// key-set revision via `entangleObjectKeys` and forwards its write add-signal
// via `notifyObjectKeyAdded` (GXT cannot observe plain-object key addition
// itself). No-op / zero-alloc for standalone GXT that never calls them.
export {
  entangleObjectKeys,
  notifyObjectKeyAdded,
} from '@/core/each-in-keyset';
export {
  captureRenderTree,
  componentToRenderTree,
  type CapturedRenderNode,
  type CapturedRenderNodeBounds,
} from '@/core/inspector/capture-render-tree';
export {
  registerHostManagers,
  type HostManagers,
} from '@/core/manager-integration';
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

// Redux DevTools integration (opt-in, dev-only, browser-only). The whole module
// tree-shakes out of production/lib builds because `enableReduxDevtools`'s body
// folds away when IS_DEV_MODE is inlined to false. See `@/core/redux-devtools`.
export {
  enableReduxDevtools,
  disableReduxDevtools,
  isDevToolsRestoring,
  type DevToolsConfig,
} from '@/core/redux-devtools';

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

// Insert a rendered value (component / nodes / text) before an anchor and
// register it with its render context — for host-managed render regions (the
// Ember native outlet swaps route components between its own anchors).
export { renderElement } from '@/core/render-core';

// Symbol exports for Ember integration
export {
  RENDERING_CONTEXT_PROPERTY,
  RENDERED_NODES_PROPERTY,
  COMPONENT_ID_PROPERTY,
} from '@/core/types';
