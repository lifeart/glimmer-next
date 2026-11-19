/**
 * `@lifeart/gxt/runtime-scope` — the runtime symbol table of the runtime
 * compiler, without the compiler.
 *
 * A template compiled at runtime (`@lifeart/gxt/runtime-compiler`) reads the
 * runtime's symbols as globals; `setupGlobalScope()` installs them on
 * `globalThis` (and the reactive primitives an Ember host reads, the reactive
 * Map/Set patch and the item reference runtime). A host that evaluates compiled
 * templates against those globals, but whose app may never compile a template
 * at runtime, installs them from here: this entry carries no compiler, so an
 * app that imports only it ships none. `@lifeart/gxt/runtime-compiler`
 * re-exports the same three names.
 */
// Import GXT runtime primitives from dom.ts
import {
  $_tag,
  $_c,
  $_if,
  $_each,
  $_eachSync,
  $_slot,
  $_edp,
  $_args,
  $_api,
  $_dc,
  $_TO_VALUE,
  $_GET_SLOTS,
  $_GET_ARGS,
  $_GET_FW,
  $_componentHelper,
  $_modifierHelper,
  $_helperHelper,
  $_hasBlockParams,
  $_hasBlock,
  $_maybeHelper,
  $_maybeModifier,
  $_inElement,
  $_ucw,
  $_nt,
  $_nbt,
  $_argThunk,
  $__bpv,
  $_fin,
  $_html,
  $_outlet,
  $_HTMLProvider,
  $_SVGProvider,
  $_MathMLProvider,
  $SLOTS_SYMBOL,
  $PROPS_SYMBOL,
} from './dom';
// From its own module: dom.ts re-exports it, and the two import each other.
import { $_blk } from './static-block';

// Import reactive primitives for Ember integration
import { cellFor, formula, cell, tagsToRevalidate, cellsMap } from './reactive';

// Opt-in row recycling entry points (key="@recycle") are intentionally NOT
// imported here so list-recycle.ts stays tree-shaken out of the runtime-
// compiler chunk. They live in the dedicated `@lifeart/gxt/recycle` entry;
// runtime-compiled apps that use key="@recycle" call `registerRecycleRuntime()`
// (from '@lifeart/gxt/recycle') to install $_eachRecycled / $_eachSyncRecycled
// on globalThis the same way setupGlobalScope() installs GXT_RUNTIME_SYMBOLS.
import { effect } from './vm';
// The item reference follow runtime: `setupGlobalScope` installs it, with the
// `$_itemRefKey` global a template compiled at runtime keys a list by position
// or an `{{#each-in}}` through.
import {
  $_itemRefKey,
  registerItemReferenceRuntime,
} from './item-references';
import { syncDom } from './runtime';
import { ensureReactiveCollectionsPatched } from './reactive-collections';

// Import helper functions
import {
  $__if,
  $__eq,
  $__not,
  $__debugger,
  $__log,
  $__array,
  $__hash,
  $__fn,
  $__or,
  $__and,
  $__cached,
  $__ref,
  $__cellFor,
  $_qStr,
  $_uid,
} from './helpers/index';

/**
 * All GXT runtime symbols that need to be available globally for compiled templates
 */
export const GXT_RUNTIME_SYMBOLS = {
  $_tag,
  $_c,
  $_if,
  $_each,
  $_eachSync,
  $_slot,
  $_edp,
  $_args,
  $_api,
  $_dc,
  $_TO_VALUE,
  $_GET_SLOTS,
  $_GET_ARGS,
  $_GET_FW,
  $_componentHelper,
  $_modifierHelper,
  $_helperHelper,
  $_hasBlockParams,
  $_hasBlock,
  $_maybeHelper,
  $_maybeModifier,
  $_inElement,
  $_ucw,
  $_nt,
  $_nbt,
  $_argThunk,
  $__bpv,
  $_blk,
  $_fin,
  $_html,
  $_outlet,
  $__if,
  $__eq,
  $__not,
  $__debugger,
  $__log,
  $__array,
  $__hash,
  $__fn,
  $__or,
  $__and,
  $__cached,
  $__ref,
  $__cellFor,
  $_qStr,
  $_uid,
  $_itemRefKey,
  $_HTMLProvider,
  $_SVGProvider,
  $_MathMLProvider,
};

/**
 * Setup global scope with all GXT runtime symbols.
 * This must be called once before using compiled templates.
 */
export function setupGlobalScope(): void {
  const g = globalThis as any;

  // Expose all symbols globally
  Object.entries(GXT_RUNTIME_SYMBOLS).forEach(([name, value]) => {
    g[name] = value;
  });

  // Also set the symbol constants for scope access
  // Import from dom.ts to ensure consistency with the runtime
  g.$SLOTS_SYMBOL = $SLOTS_SYMBOL;
  g.$PROPS_SYMBOL = $PROPS_SYMBOL;
  // $args is a string constant 'args', not a Symbol - must match shared.ts
  g.$args = 'args';

  // Expose reactive primitives for Ember integration.
  // These MUST come from the same module instance as GXT's runtime
  // to share the same currentTracker (formula tracking context).
  g.__gxtCellFor = cellFor;
  g.__gxtFormula = formula;
  g.__gxtCell = cell;
  g.__gxtEffect = effect;
  g.__gxtSyncDom = syncDom;
  g.__gxtClearTagsToRevalidate = () => tagsToRevalidate.clear();
  g.__gxtCellsMap = cellsMap;

  // Opt in to reactive Map/Set tracking. The patch is process-wide and
  // observable to vendor code, so it is *not* applied as an import side-
  // effect — initializing the global scope is the explicit signal that
  // the host wants GXT semantics.
  ensureReactiveCollectionsPatched();

  // A list keyed by position (`key="@index"`) or an `{{#each-in}}` follows the
  // item now at a kept row (`@lifeart/gxt/item-references`).
  registerItemReferenceRuntime();

  // Mark that global scope is set up
  g.__GXT_RUNTIME_INITIALIZED__ = true;
}

/**
 * Check if global scope is already set up
 */
export function isGlobalScopeReady(): boolean {
  return (globalThis as any).__GXT_RUNTIME_INITIALIZED__ === true;
}
