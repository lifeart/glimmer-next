/**
 * Ember-dialect quoted-attribute concat helper.
 *
 * Emitted by the concat serializer (under the `EMBER_ATTR_CONCAT` flag) for
 * interpolated quoted attribute values — `class="a {{b}} c"` /
 * `title="{{x}}{{y}}"` — in place of the default `[...].join('')`. The parts
 * array is built identically (each dynamic part is read, tracking its reactive
 * dependency, while the array literal is constructed); this helper only changes
 * how the already-resolved parts are coerced and joined.
 *
 * Ember's `[...].join('')` differs from plain string concat in three ways this
 * helper mirrors — the exact contract of the Ember bridge's inlined
 * `__qaNorm` / `__gxtQuotedAttr`
 * (packages/@ember/-internals/gxt-backend/compile.ts):
 *
 *   1. Per-part coercion follows Glimmer's `normalizeStringValue`:
 *      - null / undefined  → ''    (but the read already tracked the dep)
 *      - object without a `toString` (e.g. `Object.create(null)`) → ''
 *      - everything else   → `String(part)`, inside a defensive try/catch that
 *        yields '' if a custom `toString` throws. `String()` (not implicit `+`)
 *        is what lets Symbol parts coerce instead of throwing a TypeError.
 *   2. If EVERY part is nullish, the whole value is `null` (not '') so the
 *      attribute writer removes the attribute — matching Ember's "missing
 *      attribute" behaviour for `<img src="{{this.src}}">` with `src=null`,
 *      rather than writing `src=""`.
 *   3. A single-element array whose one part is nullish also returns `null`
 *      (the length-1 early return in `__gxtQuotedAttr`) — same net result as
 *      the all-nullish rule, kept for byte-for-byte contract parity.
 *
 * Functions / cells are NOT expected in `parts`: the outer getter has already
 * resolved every part to a value by the time the array is constructed, exactly
 * as `.join('')` received them. This helper stays deliberately dumb.
 */

/**
 * Glimmer `normalizeStringValue` semantics for a single resolved part.
 * Mirrors the Ember bridge's inlined `__qaNorm`.
 */
function normalizeAttrPart(v: unknown): string {
  if (v === null || v === undefined) return '';
  // `Object.create(null)` and other prototype-less values have no `toString`;
  // implicit coercion would throw, so Glimmer treats them as ''.
  if (typeof (v as { toString?: unknown }).toString !== 'function') return '';
  try {
    // `String()` (not `'' + v`) so Symbol parts coerce instead of throwing.
    return String(v);
  } catch {
    // A custom `toString` that throws normalizes to '' (defensive parity).
    return '';
  }
}

/**
 * Ember-dialect quoted-attribute concat. Coerces each part via
 * `normalizeAttrPart` and joins them, but returns `null` when every part is
 * nullish so the attribute writer drops the attribute.
 *
 * @param parts - Already-resolved concat parts.
 * @returns The joined string, or `null` when all parts are nullish.
 */
export function $_qStr(parts: unknown[]): string | null {
  // `__gxtQuotedAttr` accepts a non-array single value (normalizes directly);
  // the compiler only ever emits an array, but keep parity with the bridge.
  if (!Array.isArray(parts)) return normalizeAttrPart(parts);
  if (parts.length === 1) {
    const v0 = parts[0];
    if (v0 === null || v0 === undefined) return null;
  }
  let allNullish = true;
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p !== null && p !== undefined) {
      allNullish = false;
    }
    out += normalizeAttrPart(p);
  }
  return allNullish ? null : out;
}
