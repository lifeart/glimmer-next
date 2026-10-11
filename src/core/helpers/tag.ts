import { getTracker } from '../reactive';
import { tagFor } from '../tags';

/**
 * Non-defining member tap (Ember native layer, EMBER_NATIVE compile flag).
 *
 * Under EMBER_NATIVE the compiler emits `$__tag(item, 'k')` where the Ember
 * dialect otherwise emits `$__cellFor(item, 'k')` — a member read whose head is
 * a block param (`{{item.text}}` in an `{{#each}}` row, or a yielded value).
 *
 * Glimmer `getProp` parity WITHOUT touching the object: it consumes the
 * per-(obj, key) tag cell (`tagFor`, the same cell Ember's `@tracked` storage,
 * `set()` and `notifyPropertyChange()` dirty) into the active tracker, then
 * returns the plain `obj[key]`. Unlike `$__cellFor` it never defines an own
 * accessor, so a host `@tracked` prototype accessor is never shadowed (its
 * getter still runs and consumes the same cell), and a POJO row stays a POJO.
 * The tag is consumed directly (never via `.value`), so a lazily-initialized
 * cell is never evaluated.
 *
 * Primitive / nullish heads fall back to a plain member read, exactly like
 * `$__cellFor`.
 */
export function $__tag(obj: unknown, key: string): unknown {
  if (obj === null || obj === undefined) {
    return undefined;
  }
  const t = typeof obj;
  if (t !== 'object' && t !== 'function') {
    return (obj as Record<string, unknown>)[key];
  }
  const tracker = getTracker();
  if (tracker !== null) {
    tracker.add(tagFor(obj as object, key));
  }
  return (obj as Record<string, unknown>)[key];
}
