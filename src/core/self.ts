/**
 * Template self (G6, EMBER_SELF compile flag; the Ember native layer).
 *
 * Under EMBER_SELF a compiled template reads its `this` paths through
 * `const $s = $_self(this)` while `this` stays the RENDER NODE — the context
 * gxt passes to `$_tag` / `$_c` / helpers / slots, and on which it records the
 * template's args, tree id and rendered nodes. A host that renders a template
 * on behalf of an object it does not want gxt to treat as a node (an Ember
 * loose route template whose self is its controller; a test context) renders
 * a fresh node with `node[$SELF] = self`. Without a `$SELF` the node is its own
 * self (components: `this` === the component instance), so `$_self` is an
 * identity read for every ordinary template.
 *
 * `$SELF` is a registered symbol so it survives duplicated module instances.
 */
export const $SELF: unique symbol = Symbol.for('gxt.self') as never;

/** Compiler-emitted (EMBER_SELF preamble): the self of render node `ctx`. */
export function $_self(ctx: object): unknown {
  const self = (ctx as Record<symbol, unknown>)[$SELF];
  return self === undefined ? ctx : self;
}
