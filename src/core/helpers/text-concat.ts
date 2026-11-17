/**
 * Mixed static + dynamic text collapsed into ONE text binding.
 *
 * Emitted by the compiler (`optimizeTextChild`, plugins/compiler/visitors/
 * element.ts) for an element whose children are only text and `{{…}}`
 * values — `<span>Count: {{this.count}} of {{@total}}!</span>` becomes
 * `[TEXT_CONTENT, () => $_txt(["Count: ", this.count, " of ", $a.total, "!"])]`:
 * one text node and one binding instead of five text nodes and two bindings.
 *
 * Each part is coerced the way it rendered as a text node of its own
 * (`resolveRenderable` + `String(value ?? '')`): a function is called and
 * unwrapped (`deepFnValue`), a cell is read, null / undefined are ''. An
 * object value rendered as a node or component there; here it is
 * stringified — the compiler keeps Ember builds (where content can be a
 * SafeString or a node) and `COLLAPSE_MIXED_TEXT: false` builds off this
 * path, and DEV warns once.
 */
import { deepFnValue } from '@/core/reactive';
import { isFn, isTagLike } from '@/core/shared';

let warned = false;

export function $_txt(parts: readonly unknown[]): string {
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    let value = parts[i];
    if (isFn(value)) {
      value = deepFnValue(value as () => unknown);
    } else if (value !== null && typeof value === 'object' && isTagLike(value)) {
      value = (value as { value: unknown }).value;
    }
    if (value === null || value === undefined) continue;
    if (IS_DEV_MODE && typeof value === 'object' && !warned) {
      warned = true;
      console.warn(
        '[gxt] an object value in mixed text is rendered as a string (mixed text is one text binding; set COLLAPSE_MIXED_TEXT: false to render such values as nodes):',
        value,
      );
    }
    out += String(value);
  }
  return out;
}
