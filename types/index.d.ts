import { type ComponentReturnType, type Component } from '@/utils/component';

declare global {
  interface Window {
    getDestructors: () => WeakSet<Node, Array<() => void>>;
    drawTreeToConsole: () => void;
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
}

declare module 'glint-environment-gxt/globals' {
  export default interface Globals {
    // used to hang any macros off of that are provided by config.additionalGlobals
  }
}

export {};
