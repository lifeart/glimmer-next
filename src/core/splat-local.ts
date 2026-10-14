// Ember (EMBER_NATIVE or WITH_EMBER_INTEGRATION runtime constant): Glimmer's
// `...attributes` precedence on an element.
//
// Glimmer applies an element's attributes in SOURCE order with `...attributes`
// expanded in place: an attribute written AFTER `...attributes` overrides the
// forwarded one, an attribute written BEFORE it is overridden, and class values
// concatenate in source order (`<a class="x" ...attributes>` invoked with
// `class="y"` → `class="x y"`).
//
// `_DOM` applies the forwarded tuple first and skips later duplicate keys
// (forwarded always wins) and puts forwarded classes first. The compiler
// (Glimmer compat mode) lists the attribute names written after `...attributes`
// in a `__splatLocal__` marker attribute (`__class__` for a class after it).
// Compat Ember's runtime-template `$_tag` wrapper resolves the marker itself
// and strips it; everywhere else (the native layer, and compat build-time
// templates, whose `$_tag` is gxt's) `_DOM` consumes it through
// `splatLocalPlan`: the listed LOCAL entries are applied before the forwarded
// ones and claim their keys.
//
// Deliberately NOT re-exported from the package index (`export * from dom`):
// compat consumers import the runtime as a namespace and would retain it.

type Entry = [string, unknown];

export const SPLAT_LOCAL_MARKER = '__splatLocal__';
const CLASS_AFTER_SPLAT = '__class__';

export interface SplatLocalPlan {
  /** Local attributes to apply before the forwarded ones. */
  attrs: Entry[];
  /** Local properties to apply before the forwarded ones. */
  props: Entry[];
  /** Keys the regular (forwarded, then local) passes must skip. */
  keys: string[];
  /** A local class follows `...attributes` (forwarded classes come first). */
  classAfterSplat: boolean;
}

function markerOf(entries: Entry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]![0] === SPLAT_LOCAL_MARKER) {
      const value = entries[i]![1];
      return typeof value === 'function' ? String(value()) : String(value);
    }
  }
  return undefined;
}

function claim(entries: Entry[], name: string, into: Entry[], keys: string[]): void {
  for (let i = 0; i < entries.length; i++) {
    const key = entries[i]![0];
    // '' = class (merged, never claimed); a property key may differ in case
    // from the attribute name (`tabindex` → `tabIndex`).
    if (key !== '' && key !== SPLAT_LOCAL_MARKER && key.toLowerCase() === name) {
      into.push(entries[i]!);
      keys.push(key);
    }
  }
}

/**
 * The precedence plan for one element's local `[props, attrs]`, or `undefined`
 * when nothing follows `...attributes` (forwarded attributes win over every
 * local one; local classes precede forwarded ones).
 */
export function splatLocalPlan(props: Entry[], attrs: Entry[]): SplatLocalPlan | undefined {
  const names = markerOf(props) ?? markerOf(attrs);
  if (names === undefined) return undefined;
  const plan: SplatLocalPlan = {
    attrs: [],
    props: [],
    keys: [SPLAT_LOCAL_MARKER],
    classAfterSplat: false,
  };
  const list = names.split(',');
  for (let i = 0; i < list.length; i++) {
    const name = list[i]!;
    if (name === '') continue;
    if (name === CLASS_AFTER_SPLAT) {
      plan.classAfterSplat = true;
      continue;
    }
    const lower = name.toLowerCase();
    plan.keys.push(name);
    claim(attrs, lower, plan.attrs, plan.keys);
    claim(props, lower, plan.props, plan.keys);
  }
  return plan;
}
