export type Flags = {
  IS_GLIMMER_COMPAT_MODE: boolean;
  RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES: boolean;
  TRY_CATCH_ERROR_HANDLING: boolean;
  SUPPORT_SHADOW_DOM: boolean;
  REACTIVE_MODIFIERS: boolean;
  WITH_HELPER_MANAGER: boolean;
  WITH_MODIFIER_MANAGER: boolean;
};

export function defaultFlags() {
  return {
    IS_GLIMMER_COMPAT_MODE: true,
    RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES: false,
    TRY_CATCH_ERROR_HANDLING: true,
    SUPPORT_SHADOW_DOM: true,
    REACTIVE_MODIFIERS: true,
    WITH_HELPER_MANAGER: true,
    WITH_MODIFIER_MANAGER: true,
  } as Flags;
}
