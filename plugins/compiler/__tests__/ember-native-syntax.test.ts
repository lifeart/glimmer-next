/**
 * Ember native layer (EMBER_NATIVE) template syntax parity with Glimmer:
 *   - whitespace: every text node Glimmer keeps is kept (gxt's own dialect
 *     drops multi-line / multi-char whitespace-only text); the template is
 *     parsed like Glimmer parses it (Handlebars standalone-line and `~`
 *     whitespace control, entities decoded by the tokenizer);
 *   - G15: a dynamic `{{value}}` child of an element stays a child (dynamic
 *     content), it is not folded into a `textContent` binding;
 *   - G5: `{{#each-in obj as |k v|}}` lowers to an `each` over `$__eachIn(obj)`
 *     with a destructuring row callback.
 * Flag off: gxt's historic output.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';
import { nativeTemplateSymbols } from '../../template-wrapper';

const NATIVE = {
  IS_GLIMMER_COMPAT_MODE: true,
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
  FORCE_SYNC_LIST: true,
  EMBER_NATIVE: true,
  EMBER_SELF: true,
  EMBER_PROPERTY_TAGS: true,
} as const;
const COMPAT = {
  IS_GLIMMER_COMPAT_MODE: true,
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
} as const;

function code(tpl: string, flags: object = NATIVE, bindings: string[] = []) {
  const result = compile(tpl, { flags: flags as never, bindings: new Set(bindings) });
  expect(result.errors).toHaveLength(0);
  return result.code.split('/*#__PURE__*/').join('');
}

describe('whitespace (Glimmer text nodes)', () => {
  test('newline whitespace between mustaches is kept', () => {
    expect(code('{{a}}\n {{b}}', NATIVE, ['a', 'b'])).toBe('[() => a, "\\n ", () => b]');
  });

  test('whitespace between elements is kept', () => {
    const out = code('<p></p>\n<p></p>\n');
    expect(out).toMatch(/\$_tag\('p'[^)]*\), "\\n", \$_tag\('p'[^)]*\), "\\n"\]$/);
  });

  test('standalone block lines are stripped like Handlebars', () => {
    const out = code('{{#if a}}\n  yes\n{{else}}\n  no\n{{/if}}', NATIVE, ['a']);
    expect(out).toContain('["  yes\\n"]');
    expect(out).toContain('["  no\\n"]');
  });

  test('`~` whitespace control applies', () => {
    expect(code('{{~a~}}  \n {{b}}', NATIVE, ['a', 'b'])).toBe('[() => a, () => b]');
  });

  test('entities are decoded once (text and attribute values)', () => {
    expect(code('<p>a &amp;lt; b</p>')).toContain('"a &lt; b"');
    expect(code('<div title="a &amp; b"></div>')).toContain('["title", "a & b"]');
  });

  test('whitespace between named blocks is still ignored', () => {
    const out = code('<Foo>\n  <:a>x</:a>\n  <:b>y</:b>\n</Foo>', NATIVE, ['Foo']);
    expect(out).toContain('a: ctx0 => ["x"]');
    expect(out).toContain('b: ctx1 => ["y"]');
    expect(out).not.toContain('default');
  });

  test('flag off: whitespace-only text is dropped (historic)', () => {
    expect(code('{{a}}\n {{b}}', COMPAT, ['a', 'b'])).toBe('[() => a, () => b]');
    expect(code('<p>a &amp; b</p>', COMPAT)).toContain('"a & b"');
  });
});

describe('G15: dynamic element children are content', () => {
  test('a dynamic single child is not folded into textContent', () => {
    expect(code('<span>{{this.v}}</span>')).toContain(`$_tag('span', $_edp, this, [() => $__tag($s, "v")])`);
  });

  test('a static single child still folds', () => {
    expect(code('<span>hi</span>')).toContain('["1", "hi"]');
  });

  test('flag off: the dynamic child folds (historic)', () => {
    expect(code('<span>{{this.v}}</span>', COMPAT)).toMatch(/\["1", \(\) => this\.v\]/);
  });
});

describe('G5: {{#each-in}}', () => {
  test('lowers to an each over $__eachIn with a destructuring row', () => {
    const out = code('{{#each-in this.obj as |k v|}}[{{k}}:{{v}}]{{else}}none{{/each-in}}');
    expect(out).toContain('$_eachSync(() => $__eachIn($__tag($s, "obj")), ([k, v], $index, ctx0) =>');
    expect(out).toContain('"@identity"');
    expect(out).toContain('["none"]');
  });

  test('one block param, reserved-word params, a key', () => {
    expect(code('{{#each-in o as |key|}}{{key}}{{/each-in}}', NATIVE, ['o'])).toContain(
      '$_eachSync(() => $__eachIn(o), ([key], $index, ctx0) =>',
    );
    const out = code('{{#each-in o key="@identity" as |if v|}}{{if}}{{v.x}}{{/each-in}}', NATIVE, ['o']);
    expect(out).toContain('([__bp_if, v], $index, ctx0)');
    expect(out).toContain('$__tag(v, "x")');
  });

  test('a sub-expression source is evaluated inside the each source getter', () => {
    expect(code('{{#each-in (hash a=1) as |k|}}{{k}}{{/each-in}}', NATIVE, ['hash'])).toContain(
      '$_eachSync(() => $__eachIn($_maybeHelper(hash, [], { a: 1 }, this, 0))',
    );
  });

  test('a binding named each-in shadows the keyword', () => {
    expect(code('{{#each-in o}}x{{/each-in}}', NATIVE, ['each-in', 'o'])).not.toContain('$__eachIn');
  });

  test('$__eachIn is a native template symbol', () => {
    expect(nativeTemplateSymbols({ EMBER_NATIVE: true })).toContain('$__eachIn');
    expect(nativeTemplateSymbols({})).not.toContain('$__eachIn');
  });

  test('flag off: historic (component) emission', () => {
    expect(code('{{#each-in o as |k|}}{{k}}{{/each-in}}', COMPAT, ['o'])).not.toContain('$__eachIn');
  });
});

describe('strict-mode free helper names (EMBER_LOOSE_COMPONENTS + strictMode: true)', () => {
  const FLAGS = { ...NATIVE, EMBER_LOOSE_COMPONENTS: true } as const;
  const errorsOf = (tpl: string, strictMode: boolean | undefined, bindings: string[] = []) =>
    compile(tpl, { flags: FLAGS as never, strictMode, bindings: new Set(bindings) }).errors.map(
      (e) => e.message,
    );

  test('a free name resolved by name is Glimmer\'s compile error', () => {
    expect(errorsOf('{{a-helper "hi"}}', true).join('\n')).toMatch(
      /Attempted to resolve a helper in a strict mode template, but that value was not in scope: a-helper/,
    );
    expect(errorsOf('<p title={{(x-y 1)}}></p>', true).join('\n')).toMatch(/not in scope: x-y/);
  });

  test('bindings, keywords and built-ins are fine; non-explicit strictness is unchanged', () => {
    expect(errorsOf('{{a-helper "hi"}}', true, ['a-helper'])).toEqual([]);
    expect(errorsOf('{{#if true}}{{concat "a" "b"}}{{/if}}{{yield}}', true, ['concat'])).toEqual([]);
    // Glimmer strict mode has no implicit built-in helpers: a free `concat` errors too.
    expect(errorsOf('{{concat "a" "b"}}', true).join('\n')).toMatch(/not in scope: concat/);
    expect(errorsOf('{{a-helper "hi"}}', undefined)).toEqual([]);
    expect(errorsOf('{{a-helper "hi"}}', false)).toEqual([]);
  });
});
