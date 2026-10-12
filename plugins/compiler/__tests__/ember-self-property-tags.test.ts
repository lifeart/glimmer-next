/**
 * G6 (EMBER_SELF) and G8 (EMBER_PROPERTY_TAGS) emission — the Ember native layer.
 *
 * EMBER_SELF: every `this` path head reads the template self `$s` (declared by
 * the wrapper as `const $s = $_self(this)`); `this` itself stays the render
 * node (the ctx argument of `$_tag` / `$_c` / helpers / slots / blocks).
 *
 * EMBER_PROPERTY_TAGS: every MEMBER segment of a `this.*`, `@arg.*`,
 * block-param or let-binding path is a `$__tag(obj, "key")` tap; the `@arg`
 * read itself stays `$a.name` (gxt args are reactive already).
 *
 * Flags off: byte-identical to the historic output (no `$s`, no new taps).
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

const COMPAT = {
  IS_GLIMMER_COMPAT_MODE: true,
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
} as const;
const NATIVE = { ...COMPAT, EMBER_NATIVE: true } as const;
const SELF = { ...NATIVE, EMBER_SELF: true } as const;
const TAGS = { ...NATIVE, EMBER_PROPERTY_TAGS: true } as const;
const BOTH = { ...NATIVE, EMBER_SELF: true, EMBER_PROPERTY_TAGS: true } as const;

function compiled(tpl: string, flags: Record<string, unknown>, bindings: string[] = []) {
  const result = compile(tpl, { flags: flags as never, bindings: new Set(bindings) });
  expect(result.errors).toHaveLength(0);
  return result;
}
const code = (tpl: string, flags: Record<string, unknown>, bindings: string[] = []) =>
  compiled(tpl, flags, bindings).code;

describe('G6 EMBER_SELF: `this` heads read the template self', () => {
  test('this paths read $s; usedSelf is reported', () => {
    const r = compiled('<p>{{this.name}} {{this.a.b}}</p>', SELF);
    expect(r.code).toContain('() => $s.name');
    expect(r.code).toContain('() => $s.a?.b');
    expect(r.code).not.toMatch(/this\.(name|a)/);
    expect(r.usedSelf).toBe(true);
  });

  test('the render node stays `this` (element / block / helper ctx arguments)', () => {
    const c = code('<div>{{#if this.c}}{{fmt this.v}}{{/if}}</div>', SELF, ['fmt']);
    // no compat `globalThis.__gxtGetCellOrFormula` condition probe under EMBER_NATIVE
    expect(c).toContain('$_if(() => $s.c, ');
    expect(c).not.toContain('__gxtGetCellOrFormula');
    expect(c).toContain('$_maybeHelper(fmt, [() => $s.v], {}, ctx1, 0)');
    expect(c).toMatch(/\$_tag\('div', [^]*, this, /);
  });

  test('`this` inside block-param blocks is still the self', () => {
    const c = code('{{#each this.items as |it|}}{{this.prefix}}{{it}}{{/each}}', SELF);
    expect(c).toContain('$_each(() => $s.items');
    expect(c).toContain('() => $s.prefix');
  });

  test('{{this}} is the self (no compat __gxtSelfString__ property)', () => {
    const c = code('{{this}}', SELF);
    expect(c).toContain('() => $s');
    expect(c).not.toContain('__gxtSelfString__');
  });

  test('this-headed callees: helper, modifier, dynamic component', () => {
    const c = code('{{this.helper 1}}<div {{this.mod 2}}></div><this.Comp @x={{1}} />', SELF);
    expect(c).toContain('$_maybeHelper($s.helper, [1], {}, this, 0)');
    expect(c).toContain('$_maybeModifier($s.mod, $n, [2], {}, this)');
    expect(c).toContain('$_dc(() => $s.Comp');
  });

  test('a template without this paths does not need the self', () => {
    const r = compiled('<p>{{@x}} static</p>', SELF);
    expect(r.code).not.toContain('$s');
    expect(r.usedSelf).toBe(false);
  });

  test('flag off: historic `this` emission, usedSelf false', () => {
    const r = compiled('<p>{{this.name}} {{this}}</p>', NATIVE);
    expect(r.code).toContain('() => this.name');
    expect(r.code).toContain('this.__gxtSelfString__');
    expect(r.code).not.toContain('$s');
    expect(r.usedSelf).toBe(false);
  });
});

describe('G8 EMBER_PROPERTY_TAGS: member segments are property-tag taps', () => {
  test('this.* paths tap every member segment', () => {
    const c = code('{{this.model.first}}', TAGS);
    expect(c).toContain('() => $__tag($__tag(this, "model"), "first")');
  });

  test('@arg.* paths: the arg read stays $a.x, the members are tapped', () => {
    const r = compiled('{{@model.title}} {{@x}} {{@a-b.c}}', TAGS);
    expect(r.code).toContain('() => $__tag($a.model, "title")');
    expect(r.code).toContain('() => $a.x');
    expect(r.code).toContain('$__tag($a["a-b"], "c")');
    expect(r.usedArgsAlias).toBe(true);
  });

  test('block params and let-bindings are tapped', () => {
    const c = code(
      '{{#each this.rows as |row|}}{{row.a.b}}{{/each}}{{#let this.p as |p|}}{{p.name}}{{/let}}',
      TAGS
    );
    expect(c).toContain('$__tag($__tag(row, "a"), "b")');
    expect(c).toContain('$__tag(p(), "name")');
  });

  test('helper / modifier arguments and yield params are tapped thunks', () => {
    const c = code('{{fmt this.a.b}}<i {{on "click" this.go}}></i>{{yield this.v}}', TAGS, ['fmt']);
    expect(c).toContain('[() => $__tag($__tag(this, "a"), "b")]');
    expect(c).toContain('["click", () => $__tag(this, "go")]');
    expect(c).toContain('() => [$__tag(this, "v")]');
  });

  test('with EMBER_SELF the taps start from $s', () => {
    const c = code('{{this.model.first}}', BOTH);
    expect(c).toContain('() => $__tag($__tag($s, "model"), "first")');
  });

  test('flag off: plain (optional-chained) member reads', () => {
    const c = code('{{this.model.first}} {{@m.t}}{{#let this.p as |p|}}{{p.name}}{{/let}}', NATIVE);
    expect(c).toContain('() => this.model?.first');
    expect(c).toContain('() => $a.m?.t');
    expect(c).toContain('() => p().name');
    expect(c).not.toContain('$__tag(this');
  });
});
