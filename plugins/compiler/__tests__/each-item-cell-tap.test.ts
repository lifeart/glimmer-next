import { describe, test, expect } from 'vitest';
import { compile } from '../compile';
import { SYMBOLS } from '../serializers';

/**
 * Ember-dialect {{#each}} row-item reactive tap.
 *
 * A reactive member read whose head is a block param (the {{#each as |item|}}
 * row item, or a component-yielded value) is rewritten at compile time into a
 * host `$__cellFor(item, 'key').value` tap, so the read stays reactive on
 * item-property mutation WITHOUT a runtime per-row tracking Proxy. Gated by
 * WITH_EMBER_INTEGRATION + IS_GLIMMER_COMPAT_MODE; gxt-standalone compilation
 * is byte-identical.
 */
describe('{{#each}} row-item cell tap (WITH_EMBER_INTEGRATION)', () => {
  const ember = {
    flags: { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true },
  };
  const compat = { flags: { IS_GLIMMER_COMPAT_MODE: true } };

  test('top-level single-segment read taps the host cell', () => {
    const code = compile(
      '{{#each this.items as |item|}}{{item.text}}{{/each}}',
      ember
    ).code;
    expect(code).toContain(`${SYMBOLS.CELL_FOR}(item, "text")`);
    // No bare `item.text` member read remains for the tapped position.
    expect(code).not.toMatch(/\(\)\s*=>\s*item\.text\b/);
  });

  test('standalone compat compilation is unchanged (bare read, no tap)', () => {
    const code = compile(
      '{{#each this.items as |item|}}{{item.text}}{{/each}}',
      compat
    ).code;
    expect(code).toContain('() => item.text');
    expect(code).not.toContain(SYMBOLS.CELL_FOR);
  });

  test('WITHOUT WITH_EMBER_INTEGRATION there is no tap', () => {
    const code = compile(
      '{{#each this.items as |item|}}{{item.text}}{{/each}}',
      { flags: { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: false } }
    ).code;
    expect(code).not.toContain(SYMBOLS.CELL_FOR);
    expect(code).toContain('() => item.text');
  });

  test('deep path taps each reactive segment', () => {
    const code = compile(
      '{{#each this.items as |item|}}{{item.v.x}}{{/each}}',
      ember
    ).code;
    // Nested: $__cellFor($__cellFor(item, "v"), "x")
    expect(code).toContain(
      `${SYMBOLS.CELL_FOR}(${SYMBOLS.CELL_FOR}(item, "v"), "x")`
    );
  });

  test('the {{#each}} index param is never tapped (it is a reactive Cell)', () => {
    const code = compile(
      '{{#each this.items as |item idx|}}{{idx.foo}}{{/each}}',
      ember
    ).code;
    // idx is a Cell read via `.value`; a member read on it stays a plain read.
    expect(code).not.toContain(SYMBOLS.CELL_FOR);
    expect(code).toContain('idx.foo');
  });

  test('the item param is still tapped when an index param is present', () => {
    const code = compile(
      '{{#each this.items as |item idx|}}{{item.text}}-{{idx}}{{/each}}',
      ember
    ).code;
    expect(code).toContain(`${SYMBOLS.CELL_FOR}(item, "text")`);
    // The bare index still reads through `.value`.
    expect(code).toContain('idx.value');
  });

  test('bare block-param read ({{item}}) is left untapped', () => {
    const code = compile(
      '{{#each this.items as |item|}}{{item}}{{/each}}',
      ember
    ).code;
    expect(code).not.toContain(SYMBOLS.CELL_FOR);
    expect(code).toContain('() => item');
  });

  test('numeric / bracket index segments fall back to the plain read', () => {
    const code = compile(
      '{{#each this.items as |item|}}{{item.list.0.name}}{{/each}}',
      ember
    ).code;
    // Array-index reactivity is owned by gxt's tracked-array machinery, so the
    // tap bails the whole path to the plain optional-chained read.
    expect(code).not.toContain(SYMBOLS.CELL_FOR);
    expect(code).toContain('item.list?.["0"]?.name');
  });

  test('component-yielded block params are tapped (raw values)', () => {
    const code = compile('<Comp as |a b|>{{a.text}}-{{b.label}}</Comp>', {
      flags: { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true },
      bindings: new Set(['Comp']),
    }).code;
    expect(code).toContain(`${SYMBOLS.CELL_FOR}(a, "text")`);
    expect(code).toContain(`${SYMBOLS.CELL_FOR}(b, "label")`);
  });

  test('{{#let}} bindings are NOT tapped (they are thunks, not raw values)', () => {
    const code = compile(
      '{{#let this.foo as |y|}}{{y.text}}{{/let}}',
      ember
    ).code;
    // let-binding `y` is emitted as a getter thunk `() => this.foo`; tapping it
    // would be wrong, so it is excluded.
    expect(code).not.toContain(SYMBOLS.CELL_FOR);
    expect(code).toContain('y().text');
  });

  test('recycled rows (key="@recycle") are NOT tapped (state-object channel)', () => {
    // Recycled rows bind `item` to a per-row state object whose props are
    // forwarding accessors over a re-pointable holder; a cellFor tap would
    // clobber that reference-swap channel.
    const code = compile(
      '{{#each this.items key="@recycle" as |item|}}<td>{{item.label}}</td>{{/each}}',
      ember
    ).code;
    expect(code).not.toContain(SYMBOLS.CELL_FOR);
    expect(code).toContain('item.label');
  });

  test('this.* and @arg reads are not tapped', () => {
    const code = compile(
      '{{#each this.items as |item|}}{{this.title}}-{{@label}}{{/each}}',
      ember
    ).code;
    // Heads that are not block params keep their existing emission.
    expect(code).not.toContain(SYMBOLS.CELL_FOR);
  });
});
