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
  // Ember-dialect `{{#in-element}}` insertBefore semantics. When true the
  // control-flow serializer reads the `insertBefore=` hash and emits the render
  // mode as a 4th `$_inElement(target, roots, ctx, MODE)` argument:
  //   no insertBefore / `insertBefore=undefined` → CLEAR (Glimmer/Ember default)
  //   `insertBefore=null`                        → APPEND
  //   `insertBefore=<non-null>`                  → dev assert (Ember allows null only)
  // Off (default): emits the historic 3-arg call (append-into-target). This
  // retires the host-side out-of-band insertBefore signalling channel.
  EMBER_IN_ELEMENT: boolean;
  // Trusted-HTML (triple-mustache) support. When true, a CONTENT-position
  // trusting mustache (`{{{expr}}}`) emits `$_html(() => expr, this)` — the
  // runtime node helper that renders the value as raw, reactive innerHTML with
  // a contextual reparse for table-/select-family parents. Off (default): a
  // trusting mustache keeps gxt's historic behaviour (treated like an escaped
  // `{{expr}}` text interpolation), so standalone gxt output is byte-identical.
  // Hosts wanting Ember `{{{...}}}` semantics (the Ember bridge) opt in. This
  // retires the bridge's `<EmberHtmlRaw>` transform + `$_tag`-wrapper
  // special-case + out-of-band contextual-reparse pass.
  EMBER_TRUSTED_HTML: boolean;
  // Ember NATIVE layer dialect (the Ember build that runs on gxt without the
  // Glimmer VM and without the compat bridge). Compile-time only, emission-
  // affecting, default off (standalone and compat output are byte-identical):
  //   - template-only templates (`const X = <template>…</template>`,
  //     `export default <template>…</template>`) are wrapped in `$_tpl(...)`,
  //     the template-function brand the host checks with `isTemplateFn` (G14);
  //   - block-param member taps emit the non-defining `$__tag(obj, 'k')`
  //     instead of `$__cellFor(obj, 'k')` (which installs an own accessor that
  //     would shadow Ember `@tracked` prototype accessors);
  //   - `$_tpl` / `$__tag` are auto-imported only under this flag.
  EMBER_NATIVE: boolean;
  // Ember `{{outlet}}` keyword (G3; the Ember native layer). Compile-time only,
  // emission-affecting, default off: `{{outlet}}` emits `$_outlet(ctx)` — the
  // runtime renders the host's outlet component (`registerHostHooks({
  // outletComponent })`) as a child of the enclosing template context —
  // instead of the historic `$_slot("default")` (which renders nothing in
  // Ember). A genuine binding named `outlet` (block param / lexical scope)
  // shadows the keyword. `$_outlet` is auto-imported only under this flag, so
  // standalone and compat output are byte-identical.
  EMBER_OUTLET: boolean;
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
    EMBER_IN_ELEMENT: false,
    EMBER_TRUSTED_HTML: false,
    EMBER_NATIVE: false,
    EMBER_OUTLET: false,
  } as Flags;
}
