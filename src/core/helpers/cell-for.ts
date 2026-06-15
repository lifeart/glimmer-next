import { cellFor } from '../reactive';

/**
 * Compile-time `{{#each}}` row-item reactive tap.
 *
 * The Ember dialect (WITH_EMBER_INTEGRATION) rewrites a reactive member read
 * whose head is a block param — `{{item.text}}` inside
 * `{{#each items as |item|}}` — into `$__cellFor(item, 'text')`. This routes
 * the read through the row item's GXT cell (`cellFor`), so the value stays
 * reactive when the host mutates `item.text` (e.g. Ember's
 * `set(item, 'text', …)`), WITHOUT wrapping every row item in a runtime
 * tracking Proxy.
 *
 * Deep paths compose: `{{item.v.x}}` →
 * `$__cellFor($__cellFor(item, 'v'), 'x')`. Each reactive segment is tapped.
 *
 * Primitive / nullish heads are not cell-trackable (a `cellFor` on a string or
 * number would throw on the WeakMap key), so they fall back to a plain member
 * read — matching the semantics of the bare `item.text` this replaced.
 */
export function $__cellFor(obj: unknown, key: string): unknown {
  if (obj === null || obj === undefined) {
    return undefined;
  }
  const t = typeof obj;
  if (t !== 'object' && t !== 'function') {
    // Primitive head (string/number/boolean/symbol/bigint) — not cell-
    // trackable; mirror the bare property read the transform replaced.
    return (obj as Record<string, unknown>)[key];
  }
  // `cellFor` installs a reactive accessor on obj[key] and returns its Cell;
  // reading `.value` registers the dependency on the active tracker frame.
  return cellFor(obj as object, key as never).value;
}
