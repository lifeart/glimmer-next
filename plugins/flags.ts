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
  /**
   * Force the SYNC list primitives for every `{{#each}}`: the serializer emits
   * `$_eachSync` in place of `$_each` (and `$_eachSyncRecycled` in place of
   * `$_eachRecycled` for `key="@recycle"`), exactly as if every block carried
   * `sync=true`. Hosts whose flush pipeline requires the row DOM to be mutated
   * synchronously (e.g. the Ember bridge's `__gxtSyncDomNow`/morph flush) set
   * this instead of post-processing the emitted JS with a `$_each(` → `$_eachSync(`
   * regex. Default: false (async iteration remains the correct general default).
   */
  FORCE_SYNC_LIST: boolean;
  // Ember-dialect quoted-attribute concat. When true, interpolated quoted
  // attribute values (`class="a {{b}} c"`) emit `$_qStr([...])` — a runtime
  // helper implementing Ember/Glimmer string-coercion semantics (Symbol via
  // String(), object-without-toString → '', all-nullish → null so the attr
  // writer drops the attribute) — instead of the plain `[...].join("")`.
  EMBER_ATTR_CONCAT: boolean;
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
    FORCE_SYNC_LIST: false,
    EMBER_ATTR_CONCAT: false,
  } as Flags;
}
