/**
 * Runtime Symbols
 *
 * These are the symbols used in the generated JavaScript code.
 * They map to runtime functions in @lifeart/gxt.
 */

export const SYMBOLS = {
  // Namespace providers
  HTML_NAMESPACE: '$_HTMLProvider',
  SVG_NAMESPACE: '$_SVGProvider',
  MATH_NAMESPACE: '$_MathMLProvider',

  // Core DOM functions
  TAG: '$_tag',
  FINALIZE_COMPONENT: '$_fin',
  EMPTY_DOM_PROPS: '$_edp',
  // Node-thunk marker. Wraps a component-child DOM producer (`$_tag`/`$_c`/
  // `$_dc`/`$_each`…) lazy thunk in compat mode so hosts can detect it via the
  // runtime `isNodeThunk` predicate instead of `.toString()` source-sniffing
  // (which false-negatives under minification). Identity at runtime — sets a
  // marker property and returns the thunk. NOT a pure function (side effect:
  // marking), so it is deliberately absent from PURE_FUNCTIONS below.
  NODE_THUNK: '$_nt',
  // Named-block thunk marker. A specialisation of NODE_THUNK for the compat
  // named-block factory child (`() => $_tag(':name', …)`). `$_nbt(fn, 'name')`
  // records the slot name on `fn` so hosts read `getNamedBlockName(fn)` instead
  // of source-sniffing `$_tag(':` (minification-fragile). Superset of `$_nt`
  // (also sets the node-thunk flag). Side-effecting → absent from
  // PURE_FUNCTIONS below.
  NAMED_BLOCK_THUNK: '$_nbt',
  // Argument-thunk marker. Wraps the reactive getters the compiler emits for a
  // component's named args (`buildArgsObject`) so the arg-access layer
  // (`ArgProxyHandler` / the DEV `$_args` getter) invokes ONLY branded thunks
  // and passes a plain function arg VALUE (a forwarded action, a `{{fn}}`/helper
  // result) through unchanged (ember.js#21340 C38). Hosts read the runtime
  // `isArgThunk` predicate instead of the `fn.length`/`fn.prototype` shape
  // heuristic. Identity at runtime (side effect: marking) — absent from
  // PURE_FUNCTIONS below.
  ARG_THUNK: '$_argThunk',

  // Control flow
  IF: '$_if',
  EACH: '$_each',
  EACH_SYNC: '$_eachSync',
  // Opt-in row recycling (key="@recycle") — dedicated entry points so the
  // recycle runtime module stays tree-shakable (list-recycle.ts).
  EACH_RECYCLED: '$_eachRecycled',
  EACH_SYNC_RECYCLED: '$_eachSyncRecycled',
  SLOT: '$_slot',
  IN_ELEMENT: '$_inElement',

  // Static-block fast path for {{#each}} bodies (cloneNode + slot table)
  BLOCK: '$_blk',

  // Component helpers
  COMPONENT: '$_c',
  DYNAMIC_COMPONENT: '$_dc',
  ARGS: '$_args',
  API: '$_api',

  // Slot/Args accessors
  GET_SLOTS: '$_GET_SLOTS',
  GET_ARGS: '$_GET_ARGS',
  GET_FW: '$_GET_FW',
  TO_VALUE: '$_TO_VALUE',

  // Local variable names (used in generated code)
  LOCAL_FW: '$fw',       // Forwarded attributes/props variable
  LOCAL_SLOTS: '$slots', // Slots object variable
  LOCAL_VALUE: '$v',     // Value parameter in event handlers
  LOCAL_NODE: '$n',      // Node parameter in event handlers

  // Args property accessor (for this[$args].argName)
  ARGS_PROPERTY: '$args',

  // Short alias for this[$args] in compiled output
  ARGS_ALIAS: '$a',

  // EMBER_SELF (G6): the template's self, declared by the wrapper preamble as
  // `const $s = $_self(this)`; `this` path heads read it. `$_self` itself is
  // emitted only in the preamble (module assembler / runtime compiler).
  SELF_ALIAS: '$s',
  SELF: '$_self',

  // Built-in helpers
  COMPONENT_HELPER: '$_componentHelper',
  MODIFIER_HELPER: '$_modifierHelper',
  HELPER_HELPER: '$_helperHelper',
  MAYBE_HELPER: '$_maybeHelper',
  MAYBE_MODIFIER: '$_maybeModifier',
  HAS_BLOCK: '$_hasBlock',
  HAS_BLOCK_PARAMS: '$_hasBlockParams',

  // Built-in subexpressions
  IF_HELPER: '$__if',
  EQ: '$__eq',
  NOT: '$__not',
  OR: '$__or',
  AND: '$__and',
  ARRAY: '$__array',
  HASH: '$__hash',
  FN: '$__fn',
  DEBUGGER: '$__debugger',
  LOG: '$__log',
  // Identity memoization wrapper for (hash)/(array). Emitted around the arg
  // getter so the produced object/array reference stays stable across reads.
  CACHED: '$__cached',
  // Ember compat (WITH_EMBER_INTEGRATION without EMBER_NATIVE): the `{{#let}}`
  // value of a helper call, a cached reference (src/core/helpers/cached.ts).
  REF: '$__ref',
  // Ember-dialect {{#each}} row-item reactive tap. Emitted by the value
  // serializer for a member read whose head is a block param, gated by
  // WITH_EMBER_INTEGRATION + IS_GLIMMER_COMPAT_MODE.
  CELL_FOR: '$__cellFor',
  // Ember NATIVE-layer twin of CELL_FOR (EMBER_NATIVE flag): a non-defining
  // tag-consuming member read (src/core/helpers/tag.ts).
  TAG_TAP: '$__tag',
  // Ember-dialect quoted-attribute concat. Emitted by the concat serializer for
  // interpolated quoted attribute values (`class="a {{b}} c"`) instead of
  // `[...].join('')`, gated by the EMBER_ATTR_CONCAT flag. Applies Ember string
  // coercion and returns null for all-nullish (attribute-removal contract).
  QUOTED_STR: '$_qStr',
  // Compat-mode `{{unique-id}}` — stable per-(render-context, call-site) id.
  // Emitted by the value serializer for `unique-id` under IS_GLIMMER_COMPAT_MODE
  // as `$_uid(this, SITE_INDEX)`, where SITE_INDEX is a per-template call-site
  // index. The runtime helper (WeakMap<ctx, string[]>) keeps the id stable
  // across re-renders of an instance and distinct across instances/sites —
  // replacing the Ember bridge's positional `_uid[N]` rewrite + uidOuterScope.
  UNIQUE_ID: '$_uid',
  // Trusted-HTML node helper. A compat-mode trusting mustache (`{{{expr}}}`) in
  // CONTENT position emits `$_html(() => expr, this)` under the EMBER_TRUSTED_HTML
  // flag (via the internal `$__html` marker below + buildHelper). The runtime
  // helper returns a live comment-anchored DOM range whose content is
  // innerHTML-parsed from the value (SafeString-aware, reactive, contextual
  // reparse for table/select parents) — replacing the Ember bridge's
  // `<EmberHtmlRaw @value={{expr}} />` transform + `$_tag`-wrapper special-case +
  // out-of-band reparse pass. Auto-reportable (in emittedSymbols) via SYMBOLS.
  HTML: '$_html',
  // Ember `{{outlet}}` keyword (EMBER_OUTLET flag, G3). The mustache visitor
  // emits the internal `$__outlet` marker below; buildHelper lowers it to
  // `$_outlet(ctx)`, which renders the host outlet component as a child of the
  // enclosing template context. Auto-reportable (in emittedSymbols) via SYMBOLS.
  OUTLET: '$_outlet',
  // Ember loose-mode ambiguous append (EMBER_LOOSE_COMPONENTS flag, G11). The
  // mustache visitor emits the internal `$__looseAppend` marker below for a
  // content-position `{{name …}}` with no lexical binding in a loose template;
  // buildHelper lowers it to `$_looseAppend("name", [args], {named}, ctx, site,
  // optional)` — the runtime asks the host whether `name` is a component or a
  // helper. Auto-reportable (in emittedSymbols) via SYMBOLS.
  LOOSE_APPEND: '$_looseAppend',
  // Ember `{{#each-in}}` (EMBER_NATIVE, G5): the iteration source of the
  // lowered `each` — `$__eachIn(obj)` returns the object's entries as stable
  // `[key, value]` pairs. Auto-reportable (in emittedSymbols) via SYMBOLS.
  EACH_IN: '$__eachIn',
  // Ember trusting attribute value (EMBER_NATIVE): a trusting `style={{{x}}}`
  // emits `$_trustAttr(x)` (via the internal `$__trusted_attr` marker below) so
  // the host skips its DEV untrusted-style warning (Glimmer's
  // TrustingDynamicAttribute). Auto-reportable (in emittedSymbols) via SYMBOLS.
  TRUST_ATTR: '$_trustAttr',

  // Unstable child wrapper
  UCW: '$_ucw',

  // Template symbol
  TEMPLATE: '$template',

  // Scope key for runtime resolution
  SCOPE_KEY: '$_scope',

  // Eval key for dynamic scope access
  EVAL_KEY: '$_eval',
} as const;

export type SymbolName = keyof typeof SYMBOLS;
export type SymbolValue = (typeof SYMBOLS)[SymbolName];

/**
 * Symbol *values* that are compiler-generated LOCALS or property keys rather
 * than runtime imports/functions. These are deliberately excluded from
 * `emittedSymbols` (the ground-truth report) because they are not "a runtime
 * symbol was emitted" facts:
 *   - `$fw` / `$slots` / `$v` / `$n` — function-preamble / handler locals
 *     (their emission is already surfaced via `usedFw` / `usedSlots`),
 *   - `$a` / `$args` — the args-alias local (surfaced via `usedArgsAlias`),
 *   - `$_scope` / `$_eval` — dynamic-scope property keys,
 *   - `$template` — the template symbol.
 */
const NON_REPORTED_SYMBOL_VALUES: ReadonlySet<string> = new Set<string>([
  SYMBOLS.LOCAL_FW,
  SYMBOLS.LOCAL_SLOTS,
  SYMBOLS.LOCAL_VALUE,
  SYMBOLS.LOCAL_NODE,
  SYMBOLS.ARGS_PROPERTY,
  SYMBOLS.ARGS_ALIAS,
  SYMBOLS.SELF_ALIAS,
  SYMBOLS.SCOPE_KEY,
  SYMBOLS.EVAL_KEY,
  SYMBOLS.TEMPLATE,
]);

/**
 * The set of runtime symbol *values* that count as "emitted" for the
 * ground-truth `emittedSymbols` report. Computed from `SYMBOLS` minus the
 * non-reported locals/keys above, so any newly-added runtime symbol is
 * automatically reportable (the whole point of the report is that hosts never
 * have to enumerate/regex these by hand).
 */
export const REPORTABLE_RUNTIME_SYMBOLS: ReadonlySet<string> = new Set<string>(
  Object.values(SYMBOLS).filter((v) => !NON_REPORTED_SYMBOL_VALUES.has(v))
);

/**
 * True when an emitted identifier/runtime-ref name is a reportable runtime
 * symbol (a `$_*` / `$__*` runtime function or reference we want in the
 * `emittedSymbols` ground-truth set).
 */
export function isReportableRuntimeSymbol(name: string): boolean {
  return REPORTABLE_RUNTIME_SYMBOLS.has(name);
}

/**
 * Built-in helper name to runtime symbol mapping.
 * This is the single source of truth for built-in helper resolution.
 */
export const BUILT_IN_HELPERS: Readonly<Record<string, string>> = {
  'if': SYMBOLS.IF_HELPER,
  'eq': SYMBOLS.EQ,
  'not': SYMBOLS.NOT,
  'or': SYMBOLS.OR,
  'and': SYMBOLS.AND,
  'array': SYMBOLS.ARRAY,
  'hash': SYMBOLS.HASH,
  'fn': SYMBOLS.FN,
  'debugger': SYMBOLS.DEBUGGER,
  'log': SYMBOLS.LOG,
  'has-block': SYMBOLS.HAS_BLOCK,
  'has-block-params': SYMBOLS.HAS_BLOCK_PARAMS,
  // Special helpers that use different argument format
  'component': SYMBOLS.COMPONENT_HELPER,
  'helper': SYMBOLS.HELPER_HELPER,
  'modifier': SYMBOLS.MODIFIER_HELPER,
} as const;

/**
 * Set of built-in helper names for quick lookup.
 * Use this for O(1) membership checks instead of iterating over BUILT_IN_HELPERS.
 *
 * @example
 * ```typescript
 * if (BUILT_IN_HELPER_NAMES.has('if')) {
 *   // handle built-in
 * }
 * ```
 */
export const BUILT_IN_HELPER_NAMES: ReadonlySet<string> = new Set(Object.keys(BUILT_IN_HELPERS));

/**
 * Check if a name is a built-in helper.
 *
 * @param name - The helper name to check (e.g., 'if', 'eq', 'hash')
 * @returns True if the name is a built-in helper
 *
 * @example
 * ```typescript
 * isBuiltInHelper('if')       // true
 * isBuiltInHelper('custom')   // false
 * ```
 */
export function isBuiltInHelper(name: string): boolean {
  return BUILT_IN_HELPER_NAMES.has(name);
}

/**
 * Get the runtime symbol for a built-in helper.
 *
 * @param name - The helper name (e.g., 'if', 'eq', 'hash')
 * @returns The runtime symbol (e.g., '$__if') or null if not a built-in helper
 *
 * @example
 * ```typescript
 * getBuiltInHelperSymbol('if')      // '$__if'
 * getBuiltInHelperSymbol('hash')    // '$__hash'
 * getBuiltInHelperSymbol('custom')  // null
 * ```
 */
export function getBuiltInHelperSymbol(name: string): string | null {
  return Object.prototype.hasOwnProperty.call(BUILT_IN_HELPERS, name)
    ? BUILT_IN_HELPERS[name]
    : null;
}

/**
 * Event type constants for DOM events.
 */
export const EVENT_TYPE = {
  ON_CREATED: '0',
  TEXT_CONTENT: '1',
} as const;

/**
 * Internal helper names used by the compiler.
 * These are not runtime symbols and are intercepted during serialization.
 */
export const INTERNAL_HELPERS = {
  ON_HANDLER: '$__on_handler',
  ON_CREATED_HANDLER: '$__on_created_handler',
  STYLE_SETTER: '$__style_setter',
  ELEMENT_HELPER: '$__element_helper',
  // Sentinel name for element-modifier slots whose modifier reference is a
  // SubExpression (e.g. `<el {{(if c (modifier "on" "click" cb))}}>`). The
  // element serializer detects this name and emits a $_maybeModifier wrap
  // with the SubExpression as the modifier reference.
  DYNAMIC_MODIFIER: '$__dynamic_modifier',
  // Marker for a compat-mode trusting mustache (`{{{expr}}}`) in content
  // position (EMBER_TRUSTED_HTML flag). The mustache visitor wraps the normal
  // (getter-wrapped) inner value in `helper(TRUSTED_HTML, [inner])`; buildHelper
  // intercepts this name and emits `$_html(() => inner, ctx)` (SYMBOLS.HTML).
  // Never a real runtime import — purely a compile-time routing sentinel.
  TRUSTED_HTML: '$__html',
  // Marker for an Ember `{{outlet}}` (EMBER_OUTLET flag, G3) in content
  // position. buildHelper lowers it to `$_outlet(ctx)` (SYMBOLS.OUTLET); like
  // TRUSTED_HTML it produces DOM (a component), so the element visitor keeps it
  // a child instead of folding it into a `@textContent` binding. Never a real
  // runtime import — purely a compile-time routing sentinel.
  OUTLET: '$__outlet',
  // Marker for an Ember loose-mode ambiguous append (EMBER_LOOSE_COMPONENTS
  // flag, G11): positional[0] = the name literal, positional[1] = the
  // `optional` literal, then the call's positional arguments. buildHelper
  // lowers it to `$_looseAppend(…)` (SYMBOLS.LOOSE_APPEND); it may render a
  // component, so (like OUTLET) the element visitor keeps it a child. Never a
  // real runtime import — purely a compile-time routing sentinel.
  LOOSE_APPEND: '$__looseAppend',
  // Marker for the `{{#each-in}}` iteration source (EMBER_NATIVE, G5):
  // positional[0] = the iterated object. buildHelper lowers it to
  // `$__eachIn(obj)` (SYMBOLS.EACH_IN). Never a real runtime import.
  EACH_IN: '$__each_in',
  // Marker for a trusting `style` attribute value (EMBER_NATIVE):
  // positional[0] = the value. buildHelper lowers it to `$_trustAttr(value)`
  // (SYMBOLS.TRUST_ATTR), read in place inside the attribute getter. Never a
  // real runtime import.
  TRUSTED_ATTR: '$__trusted_attr',
} as const;

/**
 * Main import source for runtime functions.
 */
export const MAIN_IMPORT = '@lifeart/gxt';

/**
 * Set of pure functions that can be annotated with \/*#__PURE__*\/ for tree-shaking.
 * These functions are known to have no side effects when called.
 */
export const PURE_FUNCTIONS: ReadonlySet<string> = new Set([
  // Core DOM functions
  SYMBOLS.TAG,                    // $_tag
  SYMBOLS.COMPONENT,              // $_c
  SYMBOLS.DYNAMIC_COMPONENT,      // $_dc
  SYMBOLS.ARGS,                   // $_args

  // Control flow
  SYMBOLS.IF,                     // $_if
  SYMBOLS.EACH,                   // $_each
  SYMBOLS.EACH_SYNC,              // $_eachSync
  SYMBOLS.EACH_RECYCLED,          // $_eachRecycled
  SYMBOLS.EACH_SYNC_RECYCLED,     // $_eachSyncRecycled
  SYMBOLS.SLOT,                   // $_slot
  SYMBOLS.BLOCK,                  // $_blk

  // Built-in helpers (subexpressions)
  SYMBOLS.IF_HELPER,              // $__if
  SYMBOLS.EQ,                     // $__eq
  SYMBOLS.NOT,                    // $__not
  SYMBOLS.OR,                     // $__or
  SYMBOLS.AND,                    // $__and
  SYMBOLS.ARRAY,                  // $__array
  SYMBOLS.HASH,                   // $__hash
  SYMBOLS.FN,                     // $__fn
]);
