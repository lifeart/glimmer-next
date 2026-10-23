/**
 * G11 (EMBER_LOOSE_COMPONENTS) emission — Ember loose-mode (resolver-mode)
 * resolution, the Ember native layer.
 *
 * Only a template compiled with `strictMode: false` under the flag is loose.
 * Glimmer's loose syntax rules for names WITHOUT a lexical binding:
 *   - `<FooBar>` / `<Foo::Bar>` (uppercase-first or `::`) → a component by
 *     (Ember-dasherized) name: `$_c('foo-bar', …)`; lowercase tags are elements;
 *   - `{{#name …}}` and `{{component "name"}}` → a component by name;
 *   - content `{{name …}}` → `$_looseAppend("name", [args], {named}, ctx, site,
 *     optional)` (component OR helper, decided by the host);
 *   - sub-expressions / attribute values stay helpers (`$_maybeHelper("name")`).
 *
 * Flag off, or a strict template: byte-identical to the historic output.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';
import { dasherizeComponentName } from '../visitors/loose';
import { nativeTemplateSymbols, templateScopeNames } from '../../template-wrapper';
import { compileTemplateSource } from '../../runtime-compiler';

const NATIVE = {
  IS_GLIMMER_COMPAT_MODE: true,
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
  EMBER_NATIVE: true,
  EMBER_SELF: true,
  EMBER_PROPERTY_TAGS: true,
  EMBER_OUTLET: true,
} as const;
const LOOSE_FLAGS = { ...NATIVE, EMBER_LOOSE_COMPONENTS: true } as const;

function looseCompile(tpl: string, bindings: string[] = []) {
  return compile(tpl, { flags: LOOSE_FLAGS as never, strictMode: false, bindings: new Set(bindings) });
}
function loose(tpl: string, bindings: string[] = []) {
  const result = looseCompile(tpl, bindings);
  expect(result.errors).toHaveLength(0);
  return result.code.split('/*#__PURE__*/').join('');
}

const CORPUS = [
  '<Root />',
  '<FooBar @a={{this.x}}>text</FooBar>',
  '<Foo::Bar />',
  '{{foo-bar}}',
  '{{name}}',
  '{{foo-bar 1 a=this.b}}',
  '{{#foo-bar a=1 as |v|}}{{v}}{{/foo-bar}}',
  '{{component "foo-bar" a=1}}',
  '{{#component "foo-bar"}}y{{/component}}',
  '<div>{{x-y}}</div>',
];

describe('flag off / strict templates: byte-identical', () => {
  test('flag off: strictMode:false changes nothing', () => {
    for (const tpl of CORPUS) {
      const before = compile(tpl, { flags: NATIVE as never }).code;
      const after = compile(tpl, { flags: NATIVE as never, strictMode: false }).code;
      expect(after).toBe(before);
      expect(after).not.toContain('$_looseAppend');
    }
  });

  test('flag on, strict template (omitted / true): identical to flag off', () => {
    for (const tpl of CORPUS) {
      const off = compile(tpl, { flags: NATIVE as never }).code;
      expect(compile(tpl, { flags: LOOSE_FLAGS as never }).code).toBe(off);
      expect(compile(tpl, { flags: LOOSE_FLAGS as never, strictMode: true }).code).toBe(off);
    }
  });
});

describe('angle-bracket components by name', () => {
  test('uppercase-first unbound tags are components with the dasherized name', () => {
    expect(loose('<Root />')).toContain("$_c('root', $_args({}, {}, $_edp), this)");
    expect(loose('<FooBar />')).toContain("$_c('foo-bar'");
    expect(loose('<XFoo />')).toContain("$_c('x-foo'");
    expect(loose('<Foo::BarBaz />')).toContain("$_c('foo/bar-baz'");
    expect(loose('<LinkTo @route="a">x</LinkTo>')).toContain("$_c('link-to'");
  });

  test('args, attributes and the default block reach the component (no textContent folding)', () => {
    const code = loose('<FooBar @a={{this.x}} class="c">text</FooBar>');
    expect(code).toContain("$_c('foo-bar'");
    // Ember dialect: reactive arg getters are branded ($_argThunk) so the
    // arg-access layer invokes only compiler thunks, not forwarded functions.
    expect(code).toContain('a: $_argThunk(() => $__tag($s, "x"))');
    expect(code).toContain('default: ctx0 => ["text"]');
    expect(code).not.toMatch(/\$_tag\('foo-bar'/);
  });

  test('the by-name call is a string even without the compat string fallback', () => {
    const result = compile('<FooBar />', {
      flags: { ...LOOSE_FLAGS, IS_GLIMMER_COMPAT_MODE: false } as never,
      strictMode: false,
    });
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain("$_c('foo-bar'");
  });

  test('lowercase tags stay elements; lexical bindings stay lexical', () => {
    expect(loose('<foo-bar />')).toContain("$_tag('foo-bar'");
    expect(loose('<foo::bar></foo::bar>')).not.toContain('$_c(');
    expect(loose('<div />')).toContain("$_tag('div'");
    expect(loose('<Foo />', ['Foo'])).toContain('$_c(Foo, ');
    expect(loose('{{#let this.c as |Item|}}<Item />{{/let}}')).not.toContain("$_c('item'");
  });

  test('a malformed single-colon component name is Ember\'s compile error', () => {
    const result = looseCompile('<Foo:Bar />');
    expect(result.errors.map((e) => e.message)).toEqual([
      'You tried to invoke a component named <Foo:Bar /> in "[NO MODULE]", but that is not a valid name for a component. Did you mean to use the "::" syntax for nested components?',
    ]);
  });

  test('Ember component-name dasherization', () => {
    expect(dasherizeComponentName('FooBar')).toBe('foo-bar');
    expect(dasherizeComponentName('XFoo')).toBe('x-foo');
    expect(dasherizeComponentName('Foo::Bar')).toBe('foo/bar');
    expect(dasherizeComponentName('Foo::BarBaz::Qux')).toBe('foo/bar-baz/qux');
    expect(dasherizeComponentName('Foo1Bar')).toBe('foo1-bar');
  });
});

describe('curly components by name', () => {
  test('{{#name}} blocks (any spelling) are components with named args and blocks', () => {
    const code = loose('{{#foo-bar a=1 as |v|}}{{v}}{{/foo-bar}}');
    expect(code).toContain("$_c('foo-bar', $_args({ a: 1 }, { default_: true, default: (ctx0, v) => [() => v] }, $_edp), this)");
    expect(loose('{{#link-to route="index"}}x{{/link-to}}')).toContain(
      "$_c('link-to', $_args({ route: \"index\" }"
    );
    expect(loose('{{#widget}}x{{/widget}}')).toContain("$_c('widget'");
  });

  test('block keywords are not components', () => {
    expect(loose('{{#if this.a}}x{{/if}}')).toContain('$_if(');
    expect(loose('{{#each this.a as |x|}}{{x}}{{/each}}')).toMatch(/\$_each(Sync)?\(/);
    expect(loose('{{#let 1 as |x|}}{{x}}{{/let}}')).not.toContain('$_c(');
  });

  test('{{component "name"}} / {{#component "name"}} resolve the name', () => {
    expect(loose('{{component "foo-bar" a=1}}')).toContain("$_c('foo-bar', $_args({ a: $_argThunk(() => 1) }, {}, $_edp), this)");
    expect(loose('{{#component "foo-bar"}}y{{/component}}')).toContain("$_c('foo-bar'");
    expect(loose('{{component "foo-bar"}}')).not.toContain('__fromComponentHelper__');
  });
});

describe('ambiguous append: $_looseAppend', () => {
  test('a free name with no arguments is optional', () => {
    expect(loose('{{foo-bar}}')).toContain('$_looseAppend("foo-bar", [], {}, this, 0, true)');
    expect(loose('{{name}}')).toContain('$_looseAppend("name", [], {}, this, 0, true)');
  });

  test('arguments follow the native literal-or-thunk convention; with arguments it is not optional', () => {
    expect(loose('{{foo-bar 1 a=this.b}}')).toContain(
      '$_looseAppend("foo-bar", [1], { a: () => $__tag($s, "b") }, this, 0, false)'
    );
  });

  test('it stays a child node (never a textContent binding), not a reactive getter', () => {
    const code = loose('<div>{{x-y}}</div>');
    expect(code).toContain('$_looseAppend("x-y", [], {}, this, 0, true)');
    expect(code).not.toContain('() => $_looseAppend');
  });

  test('helper positions keep resolving helpers by name', () => {
    expect(loose('<div class={{foo-bar}}></div>')).toContain('$_maybeHelper("foo-bar"');
    const concat = loose('<div data-x="a {{foo-bar}} b"></div>');
    expect(concat).toContain('$_maybeHelper("foo-bar"');
    expect(concat).not.toContain('$_looseAppend');
    const sexp = loose('{{if (x-truthy this.a) "y"}}');
    expect(sexp).toContain('$_maybeHelper("x-truthy"');
    expect(sexp).not.toContain('$_looseAppend');
    expect(loose('<Foo @a={{foo-bar}} />', ['Foo'])).toContain('$_maybeHelper("foo-bar"');
  });

  test('keywords and lexical bindings are not looked up', () => {
    for (const tpl of ['{{yield}}', '{{outlet}}', '{{if this.a "b"}}', '{{log "x"}}', '{{unique-id}}', '{{has-block}}', '{{debugger}}']) {
      expect(loose(tpl)).not.toContain('$_looseAppend');
    }
    expect(loose('{{#let this.a as |item|}}{{item}}{{/let}}')).not.toContain('$_looseAppend');
    expect(loose('{{fmt 1}}', ['fmt'])).toContain('$_maybeHelper(fmt, [1]');
  });

  test('a trusting {{{name}}} stays a helper', () => {
    expect(loose('{{{foo-bar}}}')).not.toContain('$_looseAppend');
  });

  test('the emission report records the runtime symbol', () => {
    const result = looseCompile('{{foo-bar}}');
    expect(result.emittedSymbols).toContain('$_looseAppend');
    expect(result.maybeHelperNames).not.toContain('foo-bar');
  });
});

describe('runtime symbol import', () => {
  test('$_looseAppend is imported / bound only under the flag', () => {
    expect(nativeTemplateSymbols({ EMBER_LOOSE_COMPONENTS: true })).toEqual([
      '$_looseAppend',
      '$_looseBuiltins',
    ]);
    expect(nativeTemplateSymbols({ EMBER_NATIVE: true })).not.toContain('$_looseAppend');
    expect(templateScopeNames({ EMBER_LOOSE_COMPONENTS: true })).toContain('$_looseAppend');
    expect(templateScopeNames({})).not.toContain('$_looseAppend');
  });
});

describe('built-ins Glimmer resolves by name: looseBuiltins + the $_looseBuiltins preamble', () => {
  test('free array / fn / hash / unique-id are recorded (sorted, deduped)', () => {
    expect(looseCompile(`{{array this.foo 'LOL'}}`).looseBuiltins).toEqual(['array']);
    expect(
      looseCompile('{{#let (hash a=(array 1) b=(fn this.f 1)) as |h|}}{{h.a}}{{unique-id}}{{array 2}}{{/let}}')
        .looseBuiltins
    ).toEqual(['array', 'fn', 'hash', 'unique-id']);
    expect(looseCompile('<div class={{concat "a" (array 1)}}></div>').looseBuiltins).toEqual(['array']);
  });

  test('names that reach the host by name, keywords and shadowed names are not recorded', () => {
    expect(looseCompile('{{concat "a" "b"}}{{get this.o "a"}}{{if this.a "b"}}{{eq 1 2}}').looseBuiltins).toEqual([]);
    expect(looseCompile('{{array 1}}{{hash a=1}}', ['array', 'hash']).looseBuiltins).toEqual([]);
    expect(looseCompile('{{#each this.list as |fn|}}{{fn 1}}{{/each}}').looseBuiltins).toEqual([]);
  });

  test('strict templates and the flag off record nothing', () => {
    const tpl = '{{array 1}}{{hash a=1}}{{fn this.f}}{{unique-id}}';
    expect(compile(tpl, { flags: LOOSE_FLAGS as never }).looseBuiltins).toEqual([]);
    expect(compile(tpl, { flags: LOOSE_FLAGS as never, strictMode: true }).looseBuiltins).toEqual([]);
    expect(compile(tpl, { flags: NATIVE as never, strictMode: false }).looseBuiltins).toEqual([]);
  });

  test('the template function hands the names to the host on every render', () => {
    const flags = LOOSE_FLAGS as never;
    const looseSource = compileTemplateSource('{{hash a=1}}{{array 2}}', { flags, strictMode: false }).source;
    expect(looseSource).toContain('$_GET_ARGS(this, arguments);\n      $_looseBuiltins(this, ["array","hash"]);');
    for (const source of [
      compileTemplateSource('{{hash a=1}}{{array 2}}', { flags, strictMode: true }).source,
      compileTemplateSource('{{foo-bar}}', { flags, strictMode: false }).source,
    ]) {
      expect(source).not.toContain('$_looseBuiltins');
    }
  });
});

describe('free paths', () => {
  test('`{{free.path}}` is Glimmer\'s compile error in a loose template', () => {
    expect(looseCompile('{{hello.world}}').errors.map((e) => e.message)).toEqual([
      'You attempted to render a path (`{{hello.world}}`), but hello was not in scope',
    ]);
    expect(looseCompile('{{#each this.a as |hello|}}{{hello.world}}{{/each}}').errors).toHaveLength(0);
    expect(compile('{{hello.world}}', { flags: LOOSE_FLAGS as never }).errors).toHaveLength(0);
  });
});

describe('component `...attributes`: classes in source order (EMBER_NATIVE)', () => {
  test('a class written before ...attributes precedes the forwarded classes', () => {
    const before = loose('<Qux class="bar" ...attributes />');
    expect(before).toMatch(/\[\.\.\.\[\["", "bar"\]\], \.\.\.\$fw\[0\], \.\.\.\[\]\]/);
    const after = loose('<Qux ...attributes class="bar" />');
    expect(after).toMatch(/\[\.\.\.\$fw\[0\], \.\.\.\[/);
    expect(after).not.toMatch(/\[\.\.\.\[\["", "bar"\]\], \.\.\.\$fw/);
    // compat (EMBER_NATIVE off): historic order
    const compat = compile('<Qux class="bar" ...attributes />', { flags: { IS_GLIMMER_COMPAT_MODE: true } as never, bindings: new Set(['Qux']) }).code;
    expect(compat.split('/*#__PURE__*/').join('')).toMatch(/\[\.\.\.\$fw\[0\], \.\.\.\[\["", "bar"\]\]\]/);
  });
});
