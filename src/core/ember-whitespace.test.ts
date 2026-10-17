/**
 * Ember compat (EMBER_WHITESPACE): a template's text nodes are Glimmer's.
 *
 * gxt's own dialect parses a template source-preserving (no Handlebars
 * whitespace control, entities left encoded) and drops whitespace-only text
 * that spans lines or has more than one character. Glimmer parses with
 * Handlebars' standalone-line and `~` whitespace control, decodes entities in
 * the tokenizer, and keeps every text node that parse produced. So
 * `{{p.name}}⏎  {{p.lastName}}` rendered "SergioArbeo" in compat, where Ember
 * renders "Sergio⏎  Arbeo".
 *
 * The Ember native layer (EMBER_NATIVE) already follows Glimmer. Compat opts in
 * with EMBER_WHITESPACE; without it, compat and standalone output are
 * unchanged.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../../plugins/compiler/compile';
import { COMPAT_FLAGS, compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';

const COMPAT = { IS_GLIMMER_COMPAT_MODE: true, ...COMPAT_FLAGS };
const WHITESPACE = { ...COMPAT, EMBER_WHITESPACE: true };

function code(tpl: string, flags: object, bindings: string[] = []) {
  const result = compile(tpl, { flags: flags as never, bindings: new Set(bindings) });
  expect(result.errors).toHaveLength(0);
  return result.code.split('/*#__PURE__*/').join('');
}

describe('Ember compat: Glimmer template text (EMBER_WHITESPACE)', () => {
  test('newline whitespace between mustaches is kept', () => {
    expect(code('{{a}}\n {{b}}', WHITESPACE, ['a', 'b'])).toBe('[() => a, "\\n ", () => b]');
  });

  test('whitespace between elements is kept', () => {
    const out = code('<p></p>\n<p></p>\n', WHITESPACE);
    expect(out).toMatch(/\$_tag\('p'[^)]*\), "\\n", \$_tag\('p'[^)]*\), "\\n"\]$/);
  });

  test('standalone block lines are stripped like Handlebars', () => {
    const out = code('{{#if a}}\n  yes\n{{else}}\n  no\n{{/if}}', WHITESPACE, ['a']);
    expect(out).toContain('["  yes\\n"]');
    expect(out).toContain('["  no\\n"]');
  });

  test('`~` whitespace control applies', () => {
    expect(code('x  {{~a~}}  y', WHITESPACE, ['a'])).toBe('["x", () => a, "y"]');
    expect(code('{{a}} {{~b}}', WHITESPACE, ['a', 'b'])).toBe('[() => a, () => b]');
  });

  test('entities are decoded once (text and attribute values)', () => {
    expect(code('<p>a &amp;lt; b</p>', WHITESPACE)).toContain('"a &lt; b"');
    expect(code('<div title="a &amp; b"></div>', WHITESPACE)).toContain('["title", "a & b"]');
  });

  test('whitespace between named blocks is still ignored (guard)', () => {
    const out = code('<Foo>\n  <:a>x</:a>\n  <:b>y</:b>\n</Foo>', WHITESPACE, ['Foo']);
    expect(out).toContain('a: ctx0 => ["x"]');
    expect(out).toContain('b: ctx1 => ["y"]');
    expect(out).not.toContain('default');
  });

  test('flag off: compat drops whitespace-only text and keeps the source parse (guard)', () => {
    expect(code('{{a}}\n {{b}}', COMPAT, ['a', 'b'])).toBe('[() => a, () => b]');
    expect(code('{{#if a}}\n  yes\n{{/if}}', COMPAT, ['a'])).toContain('["\\n  yes\\n"]');
    expect(code('<div title="a &amp; b"></div>', COMPAT)).toContain('["title", "a &amp; b"]');
  });

  test('standalone gxt output is unchanged (guard)', () => {
    expect(code('{{a}}\n {{b}}', {}, ['a', 'b'])).toBe(code('{{a}}{{b}}', {}, ['a', 'b']));
  });
});

describe('Ember compat: rendered Glimmer text (EMBER_WHITESPACE)', () => {
  const compat = useEmberCompatRuntime();
  const container = () => compat.fixture.container;
  const whitespace = { EMBER_WHITESPACE: true };

  test('values on separate lines keep the whitespace between them', () => {
    compat.render(
      compileCompat('{{#let this.person as |p|}}\n  {{p.name}}\n  {{p.lastName}}\n{{/let}}\n', {}, whitespace),
      { person: { name: 'Sergio', lastName: 'Arbeo' } },
    );
    expect(container().textContent).toBe('  Sergio\n  Arbeo\n');
  });

  test('a standalone block line adds no newline', () => {
    compat.render(
      compileCompat('<div>\n  {{#let this.v as |foo|}}\n    foo: "{{foo}}";\n  {{/let}}\n</div>', {}, whitespace),
      { v: 'V' },
    );
    expect(container().querySelector('div')!.textContent).toBe('\n    foo: "V";\n');
  });

  test('elements on separate lines keep the newline between them', () => {
    compat.render(compileCompat('<h1>a</h1>\n<h1>b</h1>', {}, whitespace));
    const [first, second] = Array.from(container().querySelectorAll('h1'));
    expect(first.nextSibling?.nodeType).toBe(3);
    expect(first.nextSibling?.textContent).toBe('\n');
    expect(first.nextSibling?.nextSibling).toBe(second);
  });

  test('flag off: compat drops the whitespace (guard)', () => {
    compat.render(compileCompat('{{this.name}}\n{{this.lastName}}'), { name: 'Sergio', lastName: 'Arbeo' });
    expect(container().textContent).toBe('SergioArbeo');
  });
});
