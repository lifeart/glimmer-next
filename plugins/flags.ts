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
  //   - `$_tpl` / `$__tag` are auto-imported only under this flag;
  //   - helper / modifier / curry call sites (G4 / G9): literal-or-thunk
  //     arguments, `$_maybeHelper(ref, [args], {named}, ctx, site)`,
  //     `$_maybeModifier(ref, $n, [args], {named}, ctx)`, an unbound `{{on}}` is
  //     Ember's built-in modifier, `<@comp />` is a dynamic component, yield
  //     params are built against the enclosing render context.
  // Also a RUNTIME build constant (inlined by the consumer's `define`, like the
  // WITH_* flags): the Ember-only runtime branches — the host helper manager
  // owning every helper value (G4), curried values (G9), Ember keyword-helper
  // semantics (G-kw), `$_dc` nullish / definition-object handling, list-tag
  // entanglement with Ember tracked collections — fold away when false.
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
  // Ember property tags (G8; the Ember native layer). Compile-time only,
  // emission-affecting, default off: every MEMBER segment of a `this.*`,
  // `@arg.*`, block-param or let-binding path is read through the non-defining
  // tap `$__tag(obj, "key")` instead of a plain `obj?.key` read. The tap returns
  // the property value AND consumes the per-(obj, key) property tag (through the
  // host `getProp` hook when one is registered — Ember: `_getProp`, which also
  // honours `unknownProperty` and array `[]` tags), so a `set()` /
  // `notifyPropertyChange()` on an UNTRACKED property (controllers, POJOs, test
  // contexts, query params) re-renders exactly the bindings that read it —
  // Glimmer's global-context `getProp` parity. `$__tag` is auto-imported only
  // under this flag (or EMBER_NATIVE), so standalone and compat output are
  // byte-identical.
  EMBER_PROPERTY_TAGS: boolean;
  // Ember template self (G6; the Ember native layer). Compile-time only,
  // emission-affecting, default off: a template reads its `this` (the Ember
  // "self") through `const $s = $_self(this)` — `this.x` emits `$s.x`, `{{this}}`
  // emits `$s` — while `this` stays the RENDER NODE (the ctx passed to `$_tag` /
  // `$_c` / helpers / slots). `$_self(node)` returns `node[$SELF]` when the host
  // set one (a loose route template whose self is its controller, a test
  // context), else the node itself (components: self === node). The render node
  // is never the host object, so gxt never writes `args` / tree ids / rendered
  // nodes onto a controller or a test context. `$_self` is auto-imported only
  // under this flag; standalone and compat output are byte-identical.
  EMBER_SELF: boolean;
  // Ember loose-mode (resolver) resolution (G11; the Ember native layer).
  // Compile-time only, emission-affecting, default off. Applies ONLY to
  // templates compiled with `strictMode: false` (CompileOptions.strictMode — a
  // build-time `precompileTemplate(…, { strictMode: false })` (G10), a host's
  // runtime-compiled loose template); strict templates (`<template>`, the
  // default) are unchanged. In a loose template a free name the template has
  // no lexical binding for is resolved BY NAME by the host, with Glimmer's
  // syntax rules:
  //   - `<FooBar>` / `<Foo::Bar>` (uppercase-first or `::`) is a component:
  //     `$_c("foo-bar", …)` / `$_c("foo/bar", …)` (Ember's component-name
  //     dasherization); a lowercase tag stays an element;
  //   - `{{#foo-bar}}…{{/foo-bar}}` and `{{component "foo-bar"}}` are
  //     components: `$_c("foo-bar", …)`;
  //   - `{{foo-bar …}}` in content position is a component OR a helper:
  //     `$_looseAppend("foo-bar", [args], {named}, ctx, site, optional)` asks the
  //     host (`resolveComponentOrHelper`) once per render; `optional` (no
  //     arguments) renders nothing when neither exists;
  //   - helper (sub-expression / attribute) and modifier positions already
  //     pass the name string to the host managers.
  // `$_looseAppend` is auto-imported only under this flag; standalone and
  // compat output are byte-identical.
  EMBER_LOOSE_COMPONENTS: boolean;
  // Ember template text (the Ember compat build; EMBER_NATIVE implies it).
  // Compile-time only, emission-affecting, default off: a template is parsed
  // as Glimmer parses it — Handlebars standalone-line and `~` whitespace
  // control, HTML entities decoded once by the tokenizer — and every
  // whitespace-only text node that parse produced is kept. gxt's own dialect
  // parses source-preserving and drops whitespace-only text that spans lines
  // or has more than one character, so `{{a}}⏎{{b}}` renders "ab" where
  // Glimmer renders "a⏎b". Whitespace between named blocks is still ignored,
  // as in Glimmer. Standalone and compat output are byte-identical when off.
  EMBER_WHITESPACE: boolean;
  // Ember argument labels (a host's debug builds). Compile-time only,
  // emission-affecting, default off: an Ember helper or modifier call site
  // (`$_maybeHelper` / `$_maybeModifier`) whose arguments include a path passes
  // a trailing labels argument with the source text of each path argument —
  // `{ positional: [null, "this.foo"], named: { once: "this.once" } }` (`null`
  // for an argument that is not a path; a part without labels is left out) —
  // after the call's render context and call-site index (`undefined` where
  // the call has none). The runtime hands the labels to the host helper /
  // modifier manager, so its argument references carry Glimmer's debug labels
  // (`{{on}}` / `{{fn}}` assertion messages: "While rendering: this.foo").
  // Standalone, compat and native output are byte-identical when off.
  EMBER_ARG_LABELS: boolean;
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
    EMBER_PROPERTY_TAGS: false,
    EMBER_SELF: false,
    EMBER_LOOSE_COMPONENTS: false,
    EMBER_WHITESPACE: false,
    EMBER_ARG_LABELS: false,
  } as Flags;
}
