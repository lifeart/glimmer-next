/**
 * Compat-mode `{{unique-id}}` — stable per-(render-context, call-site) id.
 *
 * Ember's `{{unique-id}}` returns a unique identifier string that is STABLE for
 * a given call-site across re-renders of the same component instance, and
 * DISTINCT across instances (and across sibling call-sites). Classic Glimmer
 * gets this for free from its per-instance reference cache; GXT's fine-grained
 * getters re-invoke a helper on every read, so a naive `unique-id()` would mint
 * a fresh id each time.
 *
 * The compiler (serializers/value.ts `buildHelper`) assigns every `{{unique-id}}`
 * / `(unique-id)` call-site a stable per-template site index and emits
 * `$_uid(this, SITE_INDEX)`. This runtime helper keeps a `WeakMap<ctx, string[]>`
 * so:
 *   - the SAME ctx + SAME site index returns the SAME id (stable re-renders),
 *   - a DIFFERENT ctx (a different instance) gets a DIFFERENT id,
 *   - a DIFFERENT site index (a sibling `{{unique-id}}`) gets a DIFFERENT id.
 *
 * This retires the Ember bridge's positional call-site rewrite
 * (`$_maybeHelper("unique-id",…)` → `_uid[N]`) and its `uidOuterScope`
 * pre-computed-array injection — the stability now lives in the emission +
 * runtime, not in a host-side code rewrite.
 */

// Per render-context, a lazily-filled array of ids indexed by the compiler-
// assigned per-template site index. Keyed weakly so ids are collected with the
// instance.
const uidBySite = new WeakMap<object, string[]>();

// Module-global monotonic counter. SSR-safe: the server and the client evaluate
// the same templates in the same order, so both produce the identical id
// sequence — the ids match across a rehydration boundary. (A `Math.random`
// scheme would diverge between server and client.) Follows the monotonic
// `guidFor`/`++guid` id scheme used elsewhere in gxt rather than random UUIDs.
let uidCounter = 0;

/**
 * Generate the next process-unique id. Prefixed with a letter (`gxt`) so the
 * result is a valid HTML `id` / CSS selector, matching Ember's
 * "always starts with a letter" contract.
 */
function generateId(): string {
  return `gxt${(uidCounter++).toString(36)}`;
}

/**
 * Reset the module-global unique-id counter (test hook). Mirrors the
 * `resetNodeCounter` / `resetLogSiteCounter` idioms.
 */
export function resetUniqueIdCounter(): void {
  uidCounter = 0;
}

export function $_uid(ctx: unknown, siteIndex: number): string {
  // A real render context is always an object; guard defensively so unique-id
  // never throws on an unexpected primitive/nullish ctx (returns a fresh,
  // still-unique id — just not memoized).
  if (ctx === null || (typeof ctx !== 'object' && typeof ctx !== 'function')) {
    return generateId();
  }
  let sites = uidBySite.get(ctx as object);
  if (sites === undefined) {
    sites = [];
    uidBySite.set(ctx as object, sites);
  }
  let id = sites[siteIndex];
  if (id === undefined) {
    id = generateId();
    sites[siteIndex] = id;
  }
  return id;
}
