/**
 * Component Module - Barrel Export
 *
 * This module re-exports from the split component modules for backward compatibility.
 * New code should import directly from the specific modules.
 */

// Re-export Component class and types
export {
  Component,
  type ComponentReturnType,
  type TOC,
  type Props,
} from './component-class';

// Re-export render functions from dom.ts
export {
  renderComponent,
  targetFor,
} from './dom';

// Re-export destruction functions
export {
  destroyElement,
  destroyElementSync,
  unregisterFromParent,
  runDestructors,
} from './destroy';

// Re-export render core functions
export {
  renderElement,
  getFirstNode,
} from './render-core';

// Re-export types from types.ts for backward compatibility
export type {
  GenericReturnType,
  RenderableElement,
  ComponentRenderTarget,
  Slots,
} from './types';
