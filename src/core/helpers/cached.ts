import { cachedHelper, cachedReference } from '../reactive';

/**
 * `$__cached` — the compiler-emitted wrapper that memoizes the identity of a
 * `(hash)` / `(array)` keyword-helper value so reference-comparing consumers
 * (Ember child components, modifiers) don't see a perpetually-changed arg.
 *
 * The compiler replaces a bare arg getter `() => $__hash({...})` /
 * `() => $__array(...)` with `$__cached(() => $__hash({...}))` /
 * `$__cached(() => $__array(...))`. `$__cached` returns a getter (preserving the
 * arg-getter calling convention) whose value is identity-stable across reads and
 * re-renders while the inputs are unchanged.
 *
 * See `cachedHelper` in src/core/reactive.ts for the memoization semantics.
 */
export function $__cached<T>(factory: () => T): () => T {
  return cachedHelper(factory);
}

/**
 * `$__ref` — the Ember compat `{{#let}}` value of a helper call
 * (`let x = $__ref(() => $_maybeHelper(…))`): a getter with Glimmer reference
 * semantics, so the helper runs when the block first reads the binding and
 * again only when a cell it read changed, however often the block reads it.
 *
 * See `cachedReference` in src/core/reactive.ts.
 */
export function $__ref<T>(factory: () => T): () => T {
  return cachedReference(factory);
}
