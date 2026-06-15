import { cachedHelper } from '../reactive';

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
