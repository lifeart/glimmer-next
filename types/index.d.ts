import { type ComponentReturnType, type Component } from '@/utils/component';

declare global {
  interface Window {
    getDestructors: () => WeakSet<Node, Array<() => void>>;
    drawTreeToConsole: () => void;
    getRenderTree: () => Set<Component, Array<Component>>;
    getVM: () => any;
    hotReload: (
      oldComponent: Component | ComponentReturnType,
      newComponent: Component | ComponentReturnType,
    ) => void;
  }

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
}

declare module 'glint-environment-gxt/globals' {
  export default interface Globals {
    // used to hang any macros off of that are provided by config.additionalGlobals
  }
}

export {};
