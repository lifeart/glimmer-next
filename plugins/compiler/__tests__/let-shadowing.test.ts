/**
 * `{{#let}}` bindings that shadow a name their own values read.
 *
 * Glimmer evaluates every `{{#let}}` value in the OUTER scope. gxt lowers a let
 * to a block-scoped JS `let`, which is in scope (TDZ) for the WHOLE block — so
 * `{{#let (hash value=1) as |hash|}}` (a lexical `hash` helper) used to emit
 * `let hash = () => $_maybeHelper(hash, …)`: the getter called itself forever
 * ("Maximum call stack size exceeded"). Such a binding is now declared under a
 * fresh per-template name; references in the body follow it. Lets whose values
 * don't mention their own names emit byte-identically (no rename).
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';
import { compileTemplateSource } from '../../runtime-compiler';

const NATIVE = {
  IS_GLIMMER_COMPAT_MODE: true,
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
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

function code(tpl: string, flags: object, bindings: string[] = []) {
  const result = compile(tpl, { flags: flags as never, bindings: new Set(bindings) });
  expect(result.errors).toHaveLength(0);
  return result.code;
}

/** The let IIFE's declarations: `let <name> = …` names in emission order. */
function declaredNames(source: string) {
  return [...source.matchAll(/\blet ([\w$]+) = /g)].map((m) => m[1]);
}

describe('{{#let}} self-shadowing bindings are renamed', () => {
  for (const [label, flags] of [
    ['native', NATIVE],
    ['compat', COMPAT],
  ] as const) {
    test(`${label}: (hash …) as |hash| — the value reads the OUTER hash`, () => {
      const out = code('{{#let (hash value="x") as |hash|}}{{hash.value}}{{/let}}', flags, ['hash']);
      const names = declaredNames(out);
      expect(names).toHaveLength(1);
      expect(names[0]).not.toBe('hash');
      expect(names[0]).toMatch(/^hash\$\d+$/);
      // the initializer calls the lexical helper, never the binding itself
      expect(out).toContain(`let ${names[0]} = () => $_maybeHelper(hash,`);
      // the body reads the renamed getter
      expect(out).toContain(`${names[0]}()`);
      expect(out).not.toMatch(/\bhash\(\)/);
    });

    test(`${label}: (get …) as |get| inside other content`, () => {
      const out = code('x {{#let (get this.o "k") as |get|}}{{get}}{{/let}} y', flags, ['get']);
      const [name] = declaredNames(out);
      expect(name).toMatch(/^get\$\d+$/);
      expect(out).toContain(`${name}()`);
    });

    test(`${label}: a swap {{#let this.b this.a as |a b|}} keeps both outer reads`, () => {
      const out = code('{{#let a b as |b a|}}{{a}}-{{b}}{{/let}}', flags, ['a', 'b']);
      const names = declaredNames(out);
      expect(names).toHaveLength(2);
      expect(names.every((n) => /\$\d+$/.test(n))).toBe(true);
    });

    test(`${label}: no shadowing → byte-identical names`, () => {
      const corpus = [
        '{{#let (hash value="x") as |h|}}{{h.value}}{{/let}}',
        '{{#let this.a "lit" as |a b|}}{{a}}{{b}}{{/let}}',
        '{{#let (concat "a" "b") as |c|}}{{#let c as |d|}}{{d}}{{/let}}{{/let}}',
        '{{#let @arg as |arg|}}{{arg}}{{/let}}',
      ];
      for (const tpl of corpus) {
        const out = code(tpl, flags, ['hash', 'concat']);
        for (const name of declaredNames(out)) {
          expect(name).not.toMatch(/\$\d+$/);
        }
      }
    });
  }

  test('a nested let reading the OUTER let of the same name', () => {
    const out = code(
      '{{#let (hash a=1) as |h|}}{{#let (hash b=h) as |h|}}{{h.b.a}}{{/let}}{{/let}}',
      NATIVE,
      ['hash'],
    );
    const names = declaredNames(out);
    expect(names[0]).toBe('h');
    expect(names[1]).toMatch(/^h\$\d+$/);
    // the inner initializer reads the outer getter, the body the inner one
    expect(out).toMatch(/let h\$\d+ = \(\) => \$_maybeHelper\(hash, \[\], \{\s*b: \(\) => h\(\)/);
  });

  test('a renamed component binding is invoked under its declared name', () => {
    const out = code('{{#let (component Foo) as |Foo|}}<Foo />{{/let}}', NATIVE, ['Foo']);
    const [name] = declaredNames(out);
    expect(name).toMatch(/^Foo\$\d+$/);
    expect(out).toContain(`$_c(${name}()`);
  });

  test('runtime: the renamed getter evaluates the outer helper once (no recursion)', () => {
    const { source, scopeNames, errors } = compileTemplateSource(
      '{{#let (hash value="Hello") as |hash|}}{{hash.value}}{{/let}}',
      { flags: NATIVE, bindings: new Set(['hash']) },
    );
    expect(errors).toHaveLength(0);
    expect(scopeNames).not.toContain('hash'); // a lexical binding, not a gxt symbol
    // The emitted getter, extracted and evaluated against a stand-in helper
    // invoker: it must call the OUTER `hash`, not itself.
    const getter = /let (hash\$\d+) = (\(\) => \$_maybeHelper\(hash, [^;]*?\));/.exec(source);
    expect(getter).not.toBeNull();
    let calls = 0;
    const hash = (named: Record<string, unknown>) => {
      calls++;
      return named;
    };
    // eslint-disable-next-line no-new-func
    const make = new Function(
      'hash',
      '$_maybeHelper',
      `return ${getter![2]};`,
    ) as (h: unknown, mh: unknown) => () => unknown;
    const fn = make(hash, (h: (n: unknown) => unknown, _p: unknown, n: unknown) => h(n));
    expect(fn()).toEqual({ value: 'Hello' });
    expect(calls).toBe(1);
  });
});
