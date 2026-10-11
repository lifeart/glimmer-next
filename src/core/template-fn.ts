/**
 * Template-function brand (G14).
 *
 * A compiled template-only template (`const Foo = <template>…</template>` /
 * `export default <template>…</template>` in a `.gjs`/`.gts`) is a plain
 * `function () {…}`. A host that must tell such a function apart from its own
 * function-shaped values (Ember: a route template vs a `TemplateFactory`,
 * `factory(owner) -> template`, or a plain-function helper) cannot do it
 * structurally. Under the EMBER_NATIVE compile flag the compiler wraps every
 * template-only template in `$_tpl(...)`, which brands the function in place;
 * `isTemplateFn` reads the brand.
 *
 * The brand is a registered symbol so it survives duplicated module instances
 * (dev-server chunk duplication). Class-body templates (`[$template] = …`) are
 * not branded: their class carries them.
 */
const TEMPLATE_FN_BRAND: unique symbol = Symbol.for('gxt.template-fn') as never;

/** Compiler-emitted: brand `fn` as a gxt template function and return it. */
export function $_tpl<T extends Function>(fn: T): T {
  (fn as unknown as Record<symbol, boolean>)[TEMPLATE_FN_BRAND] = true;
  return fn;
}

/** True for a function branded by `$_tpl` (a compiled template-only template). */
export function isTemplateFn(value: unknown): value is Function {
  return (
    typeof value === 'function' &&
    (value as unknown as Record<symbol, unknown>)[TEMPLATE_FN_BRAND] === true
  );
}
