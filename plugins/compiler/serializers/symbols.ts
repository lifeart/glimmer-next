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

  // Control flow
  IF: '$_if',
  EACH: '$_each',
  EACH_SYNC: '$_eachSync',
  SLOT: '$_slot',
  IN_ELEMENT: '$_inElement',

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
  SYMBOLS.SLOT,                   // $_slot

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
