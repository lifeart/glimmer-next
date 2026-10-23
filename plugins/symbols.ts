export const SYMBOLS = {
  HTML_NAMESPACE: '$_HTMLProvider',
  SVG_NAMESPACE: '$_SVGProvider',
  MATH_NAMESPACE: '$_MathMLProvider',
  FINALIZE_COMPONENT: '$_fin',
  TAG: '$_tag',
  IF: '$_if',
  EACH: '$_each',
  EACH_SYNC: '$_eachSync',
  // Opt-in row recycling (key="@recycle") — emitted by the compiler instead
  // of EACH/EACH_SYNC so the recycle runtime stays tree-shakable.
  EACH_RECYCLED: '$_eachRecycled',
  EACH_SYNC_RECYCLED: '$_eachSyncRecycled',
  SLOT: '$_slot',
  EMPTY_DOM_PROPS: '$_edp',
  ARGS: '$_args',
  API: '$_api',
  COMPONENT: '$_c',
  DYNAMIC_COMPONENT: '$_dc',
  $SLOTS_SYMBOL: '$SLOTS_SYMBOL',
  $PROPS_SYMBOL: '$PROPS_SYMBOL',
  $_TO_VALUE: '$_TO_VALUE',
  $_GET_SLOTS: '$_GET_SLOTS',
  $_GET_ARGS: '$_GET_ARGS',
  $_GET_FW: '$_GET_FW',
  COMPONENT_HELPER: '$_componentHelper',
  MODIFIER_HELPER: '$_modifierHelper',
  HELPER_HELPER: '$_helperHelper',
  $template: '$template',
  $_hasBlockParams: '$_hasBlockParams',
  $_hasBlock: '$_hasBlock',
  $args: '$args',
  $_maybeHelper: '$_maybeHelper',
  $_maybeModifier: '$_maybeModifier',
  $_inElement: '$_inElement',
  $_ucw: '$_ucw',
  // Node-thunk marker: the compiler wraps DOM-producing component children in
  // `$_nt(() => …)` so hosts detect them via the runtime `isNodeThunk`
  // predicate instead of `.toString()` source-sniffing. MUST be listed here
  // (the AOT auto-import registry, `Object.values(SYMBOLS)`) — not only in
  // serializers/symbols.ts — or AOT-compiled modules reference an unimported
  // `$_nt` (ReferenceError at render). Resolved from @lifeart/gxt via
  // src/core/index.ts → `export * from '@/core/dom'`.
  NODE_THUNK: '$_nt',
  // Named-block thunk marker ($_nbt) — same AOT auto-import requirement as
  // $_nt: the compiler emits `$_nbt(() => $_tag(':name', …), 'name')` around
  // compat named-block children, so it MUST be in this registry
  // (`Object.values(SYMBOLS)`) too or AOT modules throw `$_nbt is not defined`.
  // Resolved from @lifeart/gxt via src/core/index.ts → `export * from
  // '@/core/dom'`.
  NAMED_BLOCK_THUNK: '$_nbt',
  $_blk: '$_blk',
  $__if: '$__if',
  $__eq: '$__eq',
  $__not: '$__not',
  $__debugger: '$__debugger',
  $__log: '$__log',
  $__array: '$__array',
  $__hash: '$__hash',
  $__fn: '$__fn',
  $__or: '$__or',
  $__and: '$__and',
  // Identity memoization for (hash)/(array) — keeps the produced object/array
  // reference stable across reads/re-renders (classic compute-ref contract).
  $__cached: '$__cached',
  // Ember-dialect {{#each}} row-item reactive tap (compile-time replacement
  // for the runtime per-row tracking Proxy). Only emitted under
  // WITH_EMBER_INTEGRATION; auto-imported here so AOT output resolves it.
  $__cellFor: '$__cellFor',
  // Ember-dialect quoted-attribute concat. Only emitted under the
  // EMBER_ATTR_CONCAT flag (interpolated quoted attrs). MUST be listed here (the
  // AOT auto-import registry, `Object.values(SYMBOLS)`) — not only in
  // serializers/symbols.ts — or a flag-on AOT module references an unimported
  // `$_qStr` (ReferenceError at render). Resolved from @lifeart/gxt via
  // src/core/index.ts → `export * from '@/core/helpers/index'`.
  $_qStr: '$_qStr',
  // Collapsed mixed text (`optimizeTextChild` → `$_txt([...])`). MUST be listed
  // here (the AOT auto-import registry) — not only in serializers/symbols.ts —
  // or AOT modules reference an unimported `$_txt`. Resolved from @lifeart/gxt
  // via src/core/index.ts → `export * from '@/core/helpers/index'`.
  $_txt: '$_txt',
  // Compat-mode `{{unique-id}}` stable-id helper. Emitted as `$_uid(this, N)`
  // under IS_GLIMMER_COMPAT_MODE. MUST be listed here (the AOT auto-import
  // registry, `Object.values(SYMBOLS)`) — not only in serializers/symbols.ts —
  // or an AOT-compiled module references an unimported `$_uid` (ReferenceError
  // at render). Resolved from @lifeart/gxt via src/core/index.ts →
  // `export * from '@/core/helpers/index'`.
  $_uid: '$_uid',
  // Trusted-HTML node helper. A compat-mode trusting mustache (`{{{expr}}}`)
  // emits `$_html(() => expr, this)` under the EMBER_TRUSTED_HTML flag. MUST be
  // listed here (the AOT auto-import registry, `Object.values(SYMBOLS)`) — not
  // only in serializers/symbols.ts — or a flag-on AOT module references an
  // unimported `$_html` (ReferenceError at render). Resolved from @lifeart/gxt
  // via src/core/index.ts → `export * from '@/core/dom'`.
  $_html: '$_html',
};

export const CONSTANTS = {
  SCOPE_KEY: '$_scope',
  EVAL_KEY: '$_eval',
};

export const EVENT_TYPE = {
  ON_CREATED: '0',
  TEXT_CONTENT: '1',
};

export const MAIN_IMPORT = '@lifeart/gxt';

// Dedicated entry for the opt-in row-recycling runtime (key="@recycle"). The
// recycle symbols live here instead of the main barrel so list-recycle.ts
// tree-shakes out of apps that never use the sentinel key. AOT output imports
// the recycle symbols from this entry, and only when a template uses them.
export const RECYCLE_IMPORT = '@lifeart/gxt/recycle';

// The compiler-emitted recycle entry points. Auto-imported from RECYCLE_IMPORT
// (not MAIN_IMPORT) and gated on actual key="@recycle" usage in the module.
// Ember NATIVE-layer symbols (EMBER_NATIVE compile flag): the template-function
// brand and the non-defining member tap. Deliberately NOT in SYMBOLS (the
// always-on barrel auto-import) so compat / standalone output stays
// byte-identical; the module assembler (plugins/test.ts) imports them from
// MAIN_IMPORT only when the flag is on.
export const NATIVE_SYMBOLS: readonly string[] = ['$_tpl', '$__tag', '$__eachIn', '$_trustAttr'];

// Ember `{{outlet}}` keyword (EMBER_OUTLET compile flag, G3). Same rule as
// NATIVE_SYMBOLS: outside the always-on barrel import (flag-off output stays
// byte-identical); the module assembler imports it only under the flag.
export const OUTLET_SYMBOLS: readonly string[] = ['$_outlet'];

// Ember property tags (EMBER_PROPERTY_TAGS, G8): member taps use `$__tag`
// (also a NATIVE_SYMBOLS member). Ember template self (EMBER_SELF, G6): the
// wrapper preamble `const $s = $_self(this)`. Same rule as NATIVE_SYMBOLS.
export const PROPERTY_TAG_SYMBOLS: readonly string[] = ['$__tag'];
export const SELF_SYMBOLS: readonly string[] = ['$_self'];

// Ember loose-mode resolution (EMBER_LOOSE_COMPONENTS, G11): the ambiguous
// append `$_looseAppend`. Same rule as NATIVE_SYMBOLS (imported only under the
// flag; flag-off output stays byte-identical).
// The loose wrapper preamble `$_looseBuiltins(this, [names])` (see
// template-wrapper.ts looseBuiltinsPreamble) is part of the same set.
export const LOOSE_BUILTINS_SYMBOL = '$_looseBuiltins';
export const LOOSE_SYMBOLS: readonly string[] = ['$_looseAppend', LOOSE_BUILTINS_SYMBOL];

// Ember compat (WITH_EMBER_INTEGRATION without EMBER_NATIVE): the `{{#let}}`
// value of a helper call is a cached reference, `$__ref(() => …)`. Same rule
// as NATIVE_SYMBOLS (imported only under the flags; flag-off output stays
// byte-identical).
export const COMPAT_SYMBOLS: readonly string[] = ['$__ref'];

export const RECYCLE_SYMBOLS: readonly string[] = [
  SYMBOLS.EACH_RECYCLED,
  SYMBOLS.EACH_SYNC_RECYCLED,
];
