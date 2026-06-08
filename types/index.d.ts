import { type ComponentReturnType, type Component } from '@/utils/component';

declare global {
  interface Window {
    getDestructors: () => WeakSet<Node, Array<() => void>>;
    drawTreeToConsole: () => void;
    getRenderTree: () => Record<unknown, unknown>;
    getParentGraph: () => Map<number, number>;
    getVM: () => any;
    hotReload: (
      oldComponent: Component | ComponentReturnType,
      newComponent: Component | ComponentReturnType,
    ) => void;
  }

  // Runtime host-detection flag (NOT a build-time const). The published
  // `@lifeart/gxt` library is built ONCE and runs in two contexts: standalone
  // glimmer-next apps (where this is unset/`false`) and embedded inside Ember
  // (where the gxt-backend sets `globalThis.__GXT_MODE__ = true` at runtime).
  // Because the value depends on the host, it must be read FRESH at call time
  // (see `isHostMode()` in control-flow/if.ts) and must never be baked via a
  // `define`. Declared as `var` so `globalThis.__GXT_MODE__` is typed without an
  // `as any` cast.
  var __GXT_MODE__: boolean | undefined;

  const IS_DEV_MODE: boolean;
  const IS_GLIMMER_COMPAT_MODE: boolean;
  const RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES: boolean;
  const TRY_CATCH_ERROR_HANDLING: boolean;
  const SUPPORT_SHADOW_DOM: boolean;
  const REACTIVE_MODIFIERS: boolean;
  const WITH_HELPER_MANAGER: boolean;
  const WITH_MODIFIER_MANAGER: boolean;
  const WITH_EMBER_INTEGRATION: boolean;
  const WITH_CONTEXT_API: boolean;
  const WITH_DYNAMIC_EVAL: boolean;
  const ASYNC_COMPILE_TRANSFORMS: boolean;
  const WITH_TYPE_CHECKER_HINTS: boolean;
}

declare module 'glint-environment-gxt/globals' {
  export default interface Globals {
    // used to hang any macros off of that are provided by config.additionalGlobals
  }
}

export {};
