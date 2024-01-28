export type Flags = {
  IS_GLIMMER_COMPAT_MODE: boolean;
  RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES: boolean;
  TRY_CATCH_ERROR_HANDLING: boolean;
  SUPPORT_SHADOW_DOM: boolean;
};

export function defaultFlags() {
  return {
    IS_GLIMMER_COMPAT_MODE: true,
    RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES: false,
    TRY_CATCH_ERROR_HANDLING: true,
    SUPPORT_SHADOW_DOM: true,
  } as Flags;
}
