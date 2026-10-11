/**
 * Host-integration hooks.
 *
 * A host renderer embedding GXT (e.g. the Ember dual-backend integration)
 * historically extended the runtime through optional `globalThis.__gxt*`
 * slots — mutable cross-realm state that masks dual-module-copy bugs and is
 * invisible to bundlers. The hooks live here as module-local slots behind an
 * explicit registration API instead. Every runtime call site reads the hook
 * slot FIRST and falls back to the historical global, so hosts running the
 * legacy wiring keep working unchanged.
 *
 * Register once at host module init:
 *
 * ```ts
 * import { registerHostHooks } from '@lifeart/gxt';
 * registerHostHooks({ toBool: emberToBool, scheduleRevalidate: syncNow });
 * ```
 */

/**
 * Metadata passed to {@link HostHooks.onConditionBranchSwap} alongside the
 * freshly-created per-branch render ctx.
 */
export interface ConditionBranchMeta {
  /**
   * The owning `IfCondition` — the SAME object `onRowContextCreated` fires once
   * for at if-construction (the whole-`{{#if}}` render scope). Lets the host
   * correlate a branch ctx back to its conditional.
   */
  if: object;
  /**
   * Which branch this ctx belongs to: `true` = the truthy (then) branch,
   * `false` = the falsy (else / `{{#unless}}`) branch. Lets the host select the
   * matching per-branch teardown bucket (e.g. `trueBranchHelpers` vs
   * `falseBranchHelpers`).
   */
  value: boolean;
}

export interface HostHooks {
  /**
   * Truthiness override for `{{#if}}`-style conditionals (e.g. Ember's
   * toBool semantics: `[]` is falsy, `isHTMLSafe('')` is truthy, …).
   * Replaces `globalThis.__gxtToBool`.
   */
  toBool?: (value: unknown) => boolean;
  /**
   * Coerce a template-driven attribute / property value at the single point
   * where EVERY such write flows through — the `$attr` / `$prop` effect in
   * `dom.ts`, for BOTH the initial (static) write AND every reactive
   * (cell-driven) re-apply, across HTML/SVG/MathML namespaces.
   *
   * Lets a host (e.g. the Ember dual-backend) implement attribute semantics
   * GXT core does not model:
   *   - SafeString values (`{ toHTML() } / { toString() }`) → their string;
   *   - Symbol / null-prototype / arbitrary object coercion;
   *   - boolean attributes: `disabled={{false}}` must REMOVE the attribute
   *     (return the remove sentinel), not write the string `"false"`;
   *   - `undefined` → remove the attribute;
   *   - URL sanitization (`href` / `src` / …).
   *
   * The host owns any table it needs (e.g. the HTML boolean-attribute set) —
   * GXT core stays table-free and just hands the host the ability to return
   * the remove sentinel.
   *
   * @param name    attribute / property name being written.
   * @param value   the resolved value (already de-celled) about to be applied.
   * @param element the target element — namespace-correct (HTML/SVG/MathML).
   * @param isProp  `true` for a PROPERTY write (`$prop`: `style`, `className`,
   *                form-control `value`/`checked`, …), `false` for an
   *                ATTRIBUTE write (`$attr`). Hosts typically only need
   *                SafeString→string on the prop side.
   * @returns the value to apply. On the ATTR side, returning the remove
   *   sentinel `undefined` REMOVES the attribute instead of writing it; any
   *   other value (including `null` / `''`) is written via the namespace api.
   *   On the PROP side the returned value is assigned as-is (no remove).
   *
   * HOTTEST host seam — see the `hostNormalizeAttrValue` hot-path cache below.
   * Replaces the Ember bridge's ~445-line `$_tag` attr-fixup wrapper + its
   * global `Element.prototype.setAttribute` monkey-patch.
   *
   * COMPILE-FLAG GATED: the dom.ts consult sites read the hook as
   * `WITH_EMBER_INTEGRATION ? hostNormalizeAttrValue : null`, so ONLY
   * host-integration builds carry the seam (and the removeAttribute sentinel
   * branch); standalone builds fold the entire consult away at the consumer's
   * define step — zero branches, zero bytes. Registering the hook in a
   * standalone (flag-off) build is a no-op by design.
   */
  normalizeAttrValue?: (
    name: string,
    value: unknown,
    element: Element,
    isProp: boolean,
  ) => unknown;
  /**
   * When installed, the runtime delegates revalidation scheduling to the
   * host, which becomes responsible for calling `syncDom()` at the right
   * time; the built-in async scheduler is bypassed. Replaces
   * `globalThis.__gxtExternalSchedule` (see also `takeRenderingControl`).
   */
  scheduleRevalidate?: () => void;
  /**
   * Observe keyed-list / const-if anchor markers as they are created so the
   * host can re-associate row state across re-renders. Replaces
   * `globalThis.__gxtRegisterListMarker`.
   */
  registerListMarker?: (marker: Comment) => void;
  /**
   * Unregister keyed-list anchor markers on list teardown (the converse of
   * `registerListMarker`). Replaces `globalThis.__gxtUnregisterListMarker`.
   */
  unregisterListMarker?: (marker: Comment) => void;
  /**
   * Re-bind a keyed row's block param to a NEW object in place when a
   * ref-swap reused the row by a stale key — preserves DOM identity.
   * Replaces `globalThis.__gxtRebindEachItem`.
   */
  rebindEachItem?: (oldItem: unknown, newItem: unknown) => void;
  /**
   * Register a leaf object held by a tracked cell as a value-owner of that
   * cell (host reverse-lookup so `set(leafObj, key, …)` can reach the
   * cell). Replaces `globalThis.__gxtRegisterObjectValueOwner`.
   */
  registerObjectValueOwner?: (
    value: object,
    relatedObj: object,
    relatedKey: string,
  ) => void;
  /**
   * The `this` of the currently-evaluating runtime-compiled template, used
   * to materialize absent-path cells. Replaces
   * `globalThis.__gxtCurrentTemplateThis` (which the host had to mutate
   * around every template evaluation — with the hook the host keeps that
   * state module-local).
   */
  getCurrentTemplateThis?: () => unknown;
  /**
   * Brand check / brand mark for host "functional helpers" — plain
   * functions invoked as `(positional, named) => value` rather than
   * spread-args. Replaces the `EmberFunctionalHelpers` global Set.
   */
  isFunctionalHelper?: (fn: unknown) => boolean;
  markFunctionalHelper?: (fn: unknown) => void;
  /**
   * Dynamic-eval fallback for compiled-template identifier resolution when
   * the render context doesn't carry `$_eval` (initial render). Replaces
   * the `globalThis.$_eval` fallback read.
   */
  dynamicEval?: (value: unknown) => unknown;
  /**
   * Observe a freshly-created per-row / per-branch render context so the host
   * can attach its own pre-destroy work to it via `registerDestructor(ctx, …)`.
   *
   * Fired:
   *   - once per keyed-`{{#each}}` row, immediately after the row's destructor-
   *     owner ctx is allocated + added to the tree (BEFORE the row body renders);
   *   - once per `{{#if}}`/`{{#unless}}` `IfCondition`, at construction (the
   *     branch render scope), BEFORE the first branch renders.
   *
   * Because the runtime fires the row ctx's destructors BEFORE the row DOM is
   * removed (per-row `destroyItem`→`destroyRowCtx`, and the reordered bulk
   * `fastCleanup`), a destructor the host registers here runs while the row DOM
   * is still connected — letting the host run teardown/lifecycle hooks at the
   * Ember-correct moment without re-implementing row ordering. No-op by default
   * (standalone GXT never registers it, so behavior is unchanged).
   */
  onRowContextCreated?: (ctx: object) => void;
  /**
   * The per-BRANCH twin of `onRowContextCreated`. Observe a freshly-created
   * per-branch render ctx — a distinct lightweight object created ONCE for
   * every `{{#if}}`/`{{#unless}}` branch RENDER (initial render AND every
   * true↔false swap) — so the host can attach that branch's pre-swap teardown
   * via `registerDestructor(branchCtx, …)`.
   *
   * Fired from `IfCondition.renderState`, right after the branch ctx is
   * allocated and BEFORE the branch body renders (mirroring how
   * `onRowContextCreated` fires before a row body renders). `branchCtx` is the
   * value `registerDestructor(branchCtx, …)` accepts.
   *
   * The runtime runs that ctx's destructors (via `destroySync`) at the START of
   * the OUTGOING branch's teardown — inside `destroyBranchSync` /
   * `destroyBranch`, BEFORE `destroyElementSync`/`destroyElement` removes the
   * branch DOM — so a destructor the host registers here fires while the
   * outgoing branch's element is still connected. It fires:
   *   - on a true↔false SWAP: the outgoing branch's ctx destructors run, then a
   *     FRESH branch ctx is created for the incoming branch (the hook fires
   *     again);
   *   - on whole-`{{#if}}` DESTROY: the currently-rendered branch's ctx
   *     destructors run (the async `destroy`→`destroyBranch` path and the
   *     sync-cascade self destructor both route through the same teardown).
   *
   * Interplay with `onRowContextCreated`: these are DISTINCT ctxs and never
   * double-fire. `onRowContextCreated` fires ONCE per `IfCondition` (at
   * construction — the whole-if scope; a destructor registered there runs on
   * whole-if destroy). `onConditionBranchSwap` fires once per BRANCH render on a
   * separate `branchCtx`; a destructor registered there runs at the NEXT swap
   * (or whole-if destroy) — the per-branch granularity the whole-if seam cannot
   * express. A host can use either or both. No-op by default (standalone GXT
   * never registers it, so the branch-render path stays a single hook-presence
   * branch and no branch ctx is allocated).
   *
   * @param branchCtx a fresh per-branch destructor-owner object.
   * @param meta      which branch (`value`) + the owning `IfCondition` (`if`).
   */
  onConditionBranchSwap?: (
    branchCtx: object,
    meta: ConditionBranchMeta,
  ) => void;
  /**
   * The COMPONENT twin of `onRowContextCreated`: observe a freshly-created
   * COMPONENT render context so the host can attach its own pre-detach work to
   * it via `registerDestructor(ctx, …)`. This lets an Ember host retire its own
   * component-liveness re-derivation (pool scan + live-instance set + reattach
   * machinery) and instead register one pre-detach destructor per component,
   * exactly as the per-row `onRowContextCreated` delegation already works.
   *
   * Fired once per component instance render — class-based AND template-only —
   * from `$_GET_ARGS` (the seam every compiled component template runs first),
   * AFTER the ctx is allocated (`COMPONENT_ID`, `[$args]`, empty
   * `RENDERED_NODES`) and added to the render tree, but BEFORE the component's
   * own subtree renders. `ctx` is the value `registerDestructor(ctx, …)` /
   * `addToTree(…, ctx)` accept.
   *
   * Ordering: a parent component's hook fires BEFORE any of its child
   * components' hooks (the parent's `$_GET_ARGS` runs before it renders the
   * children that call `$_c`). It does NOT fire for:
   *   - each-`{{#each}}` rows or `{{#if}}`/`{{#unless}}` branches — those have
   *     the dedicated `onRowContextCreated` seam and never call `$_GET_ARGS`;
   *   - internal block wrappers (`$_ucw`/`$_inElement`, marked with the
   *     `gxt-block-wrapper` symbol) — they call `$_GET_ARGS` but are excluded.
   *
   * Destructors the host registers here fire synchronously during teardown
   * (`runDestructorsSync` runs a node's destructors BEFORE removing that node's
   * DOM), so a component that is itself the destroy root (single-component
   * teardown, `{{#if}}` collapse, per-row removal) runs its destructor while its
   * element is still connected. In a whole-subtree cascade (route transition)
   * teardown is deterministic parent-before-child; a descendant's own DOM has
   * already been detached with its ancestor by the time its destructor fires.
   * No-op by default (standalone GXT never registers it, so behavior is
   * unchanged and the create hot path stays a single hook-presence branch).
   */
  onComponentContextCreated?: (ctx: object) => void;
  /**
   * Notify the host that the runtime pushed `ctx` onto its render-scope
   * (parent-context) stack — i.e. children rendered until the matching
   * `onLeaveRenderScope` attach to `ctx` as their tree parent. Fired from every
   * `setParentContext`/`pushParentContext` push (e.g. `{{#each}}` row render,
   * `{{#if}}` branch render, the inverse block). Lets an Ember host ride GXT's
   * scope stack for its own parentView hierarchy instead of re-pushing manually.
   * No-op by default.
   */
  onEnterRenderScope?: (ctx: object) => void;
  /**
   * The converse of `onEnterRenderScope`: the runtime popped the top render
   * scope (`setParentContext(null)`/`popParentContext`). Enter/leave are always
   * balanced, so the host can mirror the stack with a simple push/pop. No-op by
   * default.
   */
  onLeaveRenderScope?: () => void;
  /**
   * Resolve a HUMAN-MEANINGFUL name for a component instance, consulted by the
   * render-tree serializer (`captureRenderTree` / `componentToRenderTree`) that
   * feeds the Ember Inspector.
   *
   * GXT core only has minification-fragile names for a component: `debugName`
   * (DEV-only, itself just `constructor.name`) and `constructor.name` (a
   * minified runtime class name like `xe` / `Factory` in a production build).
   * The stable, registered name (e.g. Ember's `"hello-world"` /
   * `"my-app@component:foo/bar"`) is COMPILE-TIME / registry information that
   * only the HOST owns. This hook lets the host supply it.
   *
   * Consulted FIRST in name resolution: when it returns a non-empty string that
   * becomes the node `name`; when it returns `undefined` / `null` / `''` the
   * serializer falls back to `debugName` → `constructor.name` → `'(unknown)'`.
   *
   * Contract: return `undefined` for components the host does NOT own — in
   * particular GXT-internal control-flow / wrapper instances (`IfCondition`,
   * `SyncListComponent` / `AsyncListComponent`, slot contexts, `SVGProvider`,
   * `UnstableChildWrapper`). The serializer relies on their `debugName` prefixes
   * to reclassify them into the `'if'` / `'each'` / `'yield'` / `'svg'` keyword
   * names, so a host name for them would mask that mapping.
   *
   * No-op by default (standalone GXT never registers it, so the render-tree
   * name resolution is unchanged).
   *
   * @param component the component instance being serialized.
   * @returns the meaningful name, or `undefined` / `null` to fall back.
   */
  resolveComponentName?: (component: object) => string | undefined | null;
  /**
   * The component an Ember `{{outlet}}` renders (G3). Under the EMBER_OUTLET
   * compile flag `{{outlet}}` emits `$_outlet(ctx)`, which renders this
   * definition through the regular component machinery (as `$_c` would, with
   * no args) as a child of the enclosing render context. The host component
   * resolves what to render (the route template for this outlet level) from
   * that context chain and owns its reactivity. gxt has no routing of its own:
   * `$_outlet` throws when no outlet component is registered.
   */
  outletComponent?: unknown;
  /**
   * Property read with tag consumption (G8, the EMBER_PROPERTY_TAGS compile
   * flag; Glimmer's global-context `getProp`). Under the flag every member
   * segment of a `this.*` / `@arg.*` / block-param path compiles to
   * `$__tag(obj, "key")`; for an object / function head the tap delegates to
   * this hook, which must return the property value and consume whatever tags
   * make the read reactive (Ember: metal `_getProp` — `tagFor(obj, key)`,
   * `unknownProperty`, the `[]` tag of an array value). Without the hook the
   * tap consumes gxt's own `tagFor(obj, key)` and reads `obj[key]`. Only
   * reached by EMBER_NATIVE / EMBER_PROPERTY_TAGS output.
   */
  getProp?: (obj: object, key: string) => unknown;
  /**
   * Ember loose-mode ambiguous append (G11, the EMBER_LOOSE_COMPONENTS compile
   * flag). In a LOOSE template a content-position `{{name …}}` whose callee has
   * no lexical binding compiles to `$_looseAppend(name, …)`, which asks this
   * hook — once per render of the call site — what `name` is for the render
   * tree `ctx` belongs to (Glimmer's ResolveComponentOrHelper /
   * ResolveOptionalComponentOrHelper): `'component'` renders it through the
   * component machinery (`$_c(name, …)` → the host component manager resolves
   * the name), `'helper'` renders a reactive helper binding
   * (`$_maybeHelper(name, …)` → the host helper manager), `null` renders
   * nothing. `optional` is true when the call has no arguments at all; for a
   * non-optional miss the host is expected to throw its own "nothing was
   * found" error.
   */
  resolveComponentOrHelper?: (
    name: string,
    ctx: object,
    optional: boolean,
  ) => 'component' | 'helper' | null;
  /**
   * Ember loose-mode built-ins (G11). A LOOSE template lowers the free names
   * `array` / `fn` / `hash` / `unique-id` to gxt's own built-ins, where Glimmer
   * resolves them through the host resolver; such a template calls this once
   * per render (`$_looseBuiltins(ctx, names)`, the wrapper preamble) with the
   * names it used, so the host can apply its resolution-time checks (Ember:
   * "You attempted to overwrite the built-in helper …" when the owner
   * registers a helper with one of those names). Without the hook: nothing.
   */
  looseBuiltins?: (ctx: object, names: readonly string[]) => void;
  /**
   * Glimmer dynamic-content classification (G15; the Ember native layer). A
   * content-position `{{value}}` renders whatever its value IS, re-deciding on
   * every change (Glimmer's dynamic content switch): text, a DOM node, trusted
   * HTML, a component, a helper result. gxt recognizes text and DOM nodes
   * itself; this hook tells it which other values are host constructs:
   *   - `'html'`: trusted HTML (Ember `SafeString`, `htmlSafe(...)`) — its
   *     `toHTML()` is parsed and inserted as nodes, never escaped;
   *   - `'component'`: a component definition (a class with a component
   *     manager, `templateOnly()`, a curried `(component …)`) — rendered as a
   *     component with no arguments;
   *   - `'helper'`: a helper definition with a host helper manager (or a
   *     curried `(helper …)`) — invoked with no arguments, its result rendered
   *     as content;
   *   - `undefined` / `null`: not a host construct (text: `String(value)`; a
   *     plain function keeps being called, as gxt always did).
   * Consulted only once the EMBER_NATIVE runtime registered the dynamic-content
   * binding (dom.ts); a gxt `$_tpl` template function is a component without
   * asking.
   */
  classifyContent?: (value: unknown) => 'html' | 'component' | 'helper' | null | undefined;
  /**
   * Host assertion channel for gxt's host-parity runtime checks (Ember: the
   * `@ember/debug` `assert`, so `expectAssertion` / the Ember assertion stubs
   * see them). Called with the failure message; it is expected to throw. When
   * absent (or when it returns), gxt throws an `Error` with the same message.
   */
  assert?: (message: string) => void;
  /**
   * `{{#each-in obj}}` entries (G5; the EMBER_NATIVE `$__eachIn` iteration
   * source): `[key, value]` pairs in iteration order, read INSIDE the source
   * formula so whatever the host consumes makes the iteration reactive (Ember:
   * Glimmer's `toEachInIterator` — Maps / native iterables of pairs,
   * forEach-ables, arrays, plain objects with per-key and object tags).
   * Without the hook gxt iterates own enumerable keys.
   */
  eachInEntries?: (obj: object) => ReadonlyArray<[unknown, unknown]> | null | undefined;
}

/**
 * Internal read path for runtime call sites. Intentionally a plain mutable
 * object (not getters) — these slots sit on hot paths (per-row list-marker
 * registration, per-conditional toBool).
 */
export const HOST_HOOKS: HostHooks = {};

/**
 * Hot-path cache for {@link HostHooks.normalizeAttrValue}.
 *
 * Attribute / property application is the HOTTEST path in GXT — it runs
 * per-attribute, per-element, on every static write AND every reactive
 * re-apply (krausest-sensitive). So the read at the call site must NOT be an
 * object-property lookup on `HOST_HOOKS`: it is this module-local slot, `null`
 * unless a host registered the hook. Standalone GXT therefore pays exactly one
 * predictable `hook === null` branch per write — no allocation, no call — and
 * falls straight through to the original `api.attr` / `api.prop` write. A
 * registered host pays one branch + one hook call. `registerHostHooks` keeps
 * this in lock-step with `HOST_HOOKS.normalizeAttrValue` (see below), so tests
 * that clear `HOST_HOOKS` and re-`registerHostHooks({})` reset it to `null`.
 */
export let hostNormalizeAttrValue: NonNullable<
  HostHooks['normalizeAttrValue']
> | null = null;

/**
 * Hot-path cache for {@link HostHooks.getProp} (read by every `$__tag` member
 * tap): `null` unless a host registered the hook. Kept in lock-step with
 * `HOST_HOOKS.getProp` by `registerHostHooks`.
 */
export let hostGetProp: NonNullable<HostHooks['getProp']> | null = null;

/**
 * Merge the given hooks into the active slot table. Later registrations
 * override earlier ones per-key; passing `undefined` for a key is ignored
 * (use an explicit no-op function to disable a default the host set
 * earlier).
 */
/**
 * Fail a host-parity runtime check: through the host's `assert` hook when one is
 * registered (it throws), else (or if it returns) as an `Error`.
 */
export function hostAssertFailed(message: string): never {
  const hook = HOST_HOOKS.assert;
  if (hook !== undefined) hook(message);
  throw new Error(message);
}

export function registerHostHooks(hooks: HostHooks): void {
  for (const key of Object.keys(hooks) as Array<keyof HostHooks>) {
    const value = hooks[key];
    if (value !== undefined) {
      (HOST_HOOKS as Record<string, unknown>)[key] = value;
    }
  }
  // Refresh the hot-path attr/prop-normalize cache from the (merged) table.
  // Reads `HOST_HOOKS.normalizeAttrValue` so a later `registerHostHooks({})`
  // after tests clear the table resets the cache back to `null`.
  hostNormalizeAttrValue = HOST_HOOKS.normalizeAttrValue ?? null;
  hostGetProp = HOST_HOOKS.getProp ?? null;
  // Cross-instance host-presence sentinel. HOST_HOOKS is module-local, so a
  // consumer bundled into a different entry chunk (e.g. the list frame-mode
  // gate) sees its OWN empty copy. This single globalThis flag — set true the
  // first time any host registers hooks — is visible regardless of how many
  // times the package is instantiated, restoring the cross-instance property
  // the legacy `globalThis.__gxt*` hook slots had.
  (globalThis as Record<string, unknown>).__gxtHostHooksInstalled = true;
}

/**
 * Functional-helper brand check, hook-first with the legacy
 * `EmberFunctionalHelpers` bare-global Set as fallback. Hosts should
 * register `isFunctionalHelper` and `markFunctionalHelper` together.
 */
export function isHostFunctionalHelper(fn: unknown): boolean {
  if (HOST_HOOKS.isFunctionalHelper) {
    return HOST_HOOKS.isFunctionalHelper(fn);
  }
  return (
    // @ts-expect-error EmberFunctionalHelpers legacy global
    typeof EmberFunctionalHelpers !== 'undefined' &&
    // @ts-expect-error EmberFunctionalHelpers legacy global
    EmberFunctionalHelpers.has(fn)
  );
}

export function markHostFunctionalHelper(fn: unknown): void {
  if (HOST_HOOKS.markFunctionalHelper) {
    HOST_HOOKS.markFunctionalHelper(fn);
    return;
  }
  // @ts-expect-error EmberFunctionalHelpers legacy global
  if (typeof EmberFunctionalHelpers !== 'undefined') {
    // @ts-expect-error EmberFunctionalHelpers legacy global
    EmberFunctionalHelpers.add(fn);
  }
}
