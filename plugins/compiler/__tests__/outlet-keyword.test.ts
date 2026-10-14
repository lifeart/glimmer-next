/**
 * G3 — the Ember `{{outlet}}` keyword under the EMBER_OUTLET compile flag.
 *
 * Flag on: `{{outlet}}` emits `$_outlet(ctx)` (the runtime renders the host's
 * outlet component as a child of `ctx`), where `ctx` is the enclosing render
 * context — `this` at template level, the block context inside a block. A
 * genuine binding named `outlet` (block param, lexical scope) shadows the
 * keyword (Ember block-param semantics), so it compiles as an ordinary path.
 *
 * Flag off: the historic `$_slot("default")` lowering, byte-identical.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';
import { SYMBOLS, INTERNAL_HELPERS } from '../serializers/symbols';
import { isReportableRuntimeSymbol } from '../serializers';

const EMBER = { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true } as const;
const ON = { ...EMBER, EMBER_OUTLET: true } as const;

function code(tpl: string, flags: Record<string, unknown>, bindings: string[] = []) {
  const result = compile(tpl, { flags: flags as never, bindings: new Set(bindings) });
  expect(result.errors).toHaveLength(0);
  return result;
}

describe('G3: {{outlet}} under EMBER_OUTLET', () => {
  test('symbol tables: $_outlet is a reportable runtime symbol, $__outlet a compile-time marker', () => {
    expect(SYMBOLS.OUTLET).toBe('$_outlet');
    expect(INTERNAL_HELPERS.OUTLET).toBe('$__outlet');
    expect(isReportableRuntimeSymbol('$_outlet')).toBe(true);
  });

  test('flag on: a top-level {{outlet}} emits $_outlet(this)', () => {
    const r = code('{{outlet}}', ON);
    expect(r.code).toContain('$_outlet(this)');
    expect(r.code).not.toContain('$_slot(');
    expect(r.code).not.toContain('$__outlet');
    expect([...r.emittedSymbols]).toContain('$_outlet');
  });

  test('flag on: {{outlet}} as the only child of an element stays a child (no @textContent fold)', () => {
    const r = code('<main>{{outlet}}</main>', ON);
    expect(r.code).toContain('$_outlet(this)');
    expect(r.code).not.toContain('@textContent');
    expect(r.code).not.toMatch(/\[\s*["']1["']/); // no TEXT_CONTENT event tuple
  });

  test('flag on: inside a block the block context is the parent ({{#if}} branch / yielded block)', () => {
    const inIf = code('{{#if this.show}}{{outlet}}{{/if}}', ON);
    expect(inIf.code).toMatch(/\$_outlet\(ctx\d+\)/);
    const inBlock = code('<Layout>{{outlet}}</Layout>', ON, ['Layout']);
    expect(inBlock.code).toMatch(/\$_outlet\(ctx\d+\)/);
    expect(inBlock.code).not.toContain('$_slot("default", () => [], $slots, ctx');
  });

  test('flag on: a block param named outlet shadows the keyword', () => {
    const viaLet = code('{{#let this.x as |outlet|}}{{outlet}}{{/let}}', ON);
    expect(viaLet.code).not.toContain('$_outlet(');
    expect(viaLet.code).not.toContain('$_slot(');
    expect(viaLet.code).toMatch(/\boutlet\b/);
    const viaEach = code('{{#each this.items as |outlet|}}<li>{{outlet}}</li>{{/each}}', ON);
    expect(viaEach.code).not.toContain('$_outlet(');
    expect(viaEach.code).not.toContain('$_slot(');
  });

  test('flag on: a lexical binding named outlet shadows the keyword', () => {
    const viaBinding = code('<p>{{outlet}}</p>', ON, ['outlet']);
    expect(viaBinding.code).not.toContain('$_outlet(');
    expect(viaBinding.code).not.toContain('$_slot(');
    const viaScope = compile('<p>{{outlet}}</p>', {
      flags: ON as never,
      lexicalScope: (name: string) => name === 'outlet',
    });
    expect(viaScope.code).not.toContain('$_outlet(');
  });

  test('flag on: the keyword still applies after a shadowing block closes', () => {
    const r = code('{{#let this.x as |outlet|}}{{outlet}}{{/let}}{{outlet}}', ON);
    expect(r.code.match(/\$_outlet\(/g)).toHaveLength(1);
  });

  test('flag on: {{yield}} is unaffected', () => {
    const r = code('<div>{{yield}}</div>', ON);
    expect(r.code).toContain('$_slot("default"');
    expect(r.code).not.toContain('$_outlet(');
  });

  test('flag off: {{outlet}} keeps the historic $_slot("default") lowering, byte-identical', () => {
    for (const tpl of [
      '{{outlet}}',
      '<main>{{outlet}}</main>',
      '{{#if this.show}}{{outlet}}{{/if}}',
    ]) {
      const off = code(tpl, EMBER);
      expect(off.code).not.toContain('$_outlet');
      expect(off.code).toContain('$_slot("default"');
      expect(code(tpl, { ...EMBER, EMBER_OUTLET: false }).code).toBe(off.code);
    }
    // A binding named `outlet` shadows the keyword in Ember compat too
    // (keyword-named-block-params.test.ts).
    const shadowed = code('{{#let this.x as |outlet|}}{{outlet}}{{/let}}', EMBER).code;
    expect(shadowed).not.toContain('$_slot("default"');
    expect(shadowed).toContain('() => outlet()');
  });
});
