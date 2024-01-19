export type Flags = {
  IS_GLIMMER_COMPAT_MODE: boolean;
  RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES: boolean;
};

export function defaultFlags() {
  return {
    IS_GLIMMER_COMPAT_MODE: true,
    RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES: false,
  } as Flags;
}
