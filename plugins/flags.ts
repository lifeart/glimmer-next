export type Flags = {
  IS_GLIMMER_COMPAT_MODE: boolean;
  RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES: boolean;
  TRY_CATCH_ERROR_HANDLING: boolean;
  SUPPORT_SHADOW_DOM: boolean;
  REACTIVE_MODIFIERS: boolean;
  WITH_HELPER_MANAGER: boolean;
  WITH_MODIFIER_MANAGER: boolean;
  WITH_EMBER_INTEGRATION: boolean;
  WITH_CONTEXT_API: boolean;
  ASYNC_COMPILE_TRANSFORMS: boolean;
  WITH_DYNAMIC_EVAL: boolean;
  WITH_TYPE_CHECKER_HINTS: boolean;
  // When true, the host (e.g. Ember) drives DOM updates via a coarse
  // full-template re-render ("the morph"), and GXT skips its fine-grained
  // compensation paths (per-row destructor ownership, control-flow re-anchor,
  // KVO leaf-owner subscription, etc.). When false (the default), GXT owns the
  // DOM with fine-grained reactivity. Build-time const so the unused branch
  // tree-shakes out of the dist. (Replaced the former runtime
  // `globalThis.__GXT_SPIKE_SKIP_MORPH` host-global read — `!WITH_MORPH` is the
  // old `__GXT_SPIKE_SKIP_MORPH === true`.)
  WITH_MORPH: boolean;
};

export function defaultFlags() {
  return {
    IS_GLIMMER_COMPAT_MODE: true,
    RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES: false,
    TRY_CATCH_ERROR_HANDLING: true,
    SUPPORT_SHADOW_DOM: true,
    REACTIVE_MODIFIERS: true,
    WITH_HELPER_MANAGER: false,
    WITH_MODIFIER_MANAGER: false,
    WITH_EMBER_INTEGRATION: false,
    WITH_CONTEXT_API: true,
    ASYNC_COMPILE_TRANSFORMS: true,
    WITH_DYNAMIC_EVAL: false,
    WITH_TYPE_CHECKER_HINTS: false,
    WITH_MORPH: false,
  } as Flags;
}
