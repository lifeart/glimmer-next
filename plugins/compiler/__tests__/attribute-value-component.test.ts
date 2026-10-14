/**
 * `{{component …}}` in a value position (`@comp={{component "foo"}}`,
 * `data-x={{component Foo}}`) is the curried component, exactly as the
 * sub-expression `(component …)` is. The compat rewrite of a content-position
 * `{{component …}}` into a component ELEMENT also ran in a value position,
 * where `visitAttributeValue` dropped the element as `null`, so the receiver
 * got nothing (Glimmer passes the curried component).
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

const COMPAT = {
  IS_GLIMMER_COMPAT_MODE: true,
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
} as const;
const NATIVE = {
  ...COMPAT,
  EMBER_NATIVE: true,
  EMBER_TRUSTED_HTML: true,
  EMBER_ATTR_CONCAT: true,
} as const;
const STANDALONE = { IS_GLIMMER_COMPAT_MODE: true } as const;

function code(tpl: string, flags: Record<string, unknown>, bindings: string[] = []) {
  const result = compile(tpl, { flags: flags as never, bindings: new Set(bindings) });
  expect(result.errors).toHaveLength(0);
  return result.code;
}

describe('{{component …}} in a value position is a curried component', () => {
  for (const [label, flags] of [
    ['compat', COMPAT],
    ['native', NATIVE],
    ['standalone', STANDALONE],
  ] as const) {
    test(`${label}: an argument value`, () => {
      const c = code('<Bar @baz={{component Foo value="x"}} />', flags, ['Bar', 'Foo']);
      expect(c).toContain('$_componentHelper(');
      expect(c).not.toMatch(/"@baz",\s*null/);
    });

    test(`${label}: a by-name argument value`, () => {
      const c = code('<Bar @baz={{component "foo-bar"}} />', flags, ['Bar']);
      expect(c).toContain('$_componentHelper(');
      expect(c).not.toMatch(/"@baz",\s*null/);
    });

    test(`${label}: an attribute value`, () => {
      const c = code('<div data-x={{component "foo"}}></div>', flags);
      expect(c).toContain('$_componentHelper(');
      expect(c).not.toMatch(/"data-x",\s*null/);
    });
  }

  test('the same as the sub-expression form', () => {
    for (const flags of [COMPAT, NATIVE]) {
      const mustache = code('<Bar @baz={{component Foo value=this.v}} />', flags, ['Bar', 'Foo']);
      const sub = code('<Bar @baz={{(component Foo value=this.v)}} />', flags, ['Bar', 'Foo']);
      expect(mustache).toBe(sub);
    }
  });

  test('content position still invokes the component', () => {
    const c = code('{{component "foo-bar" value=1}}', COMPAT);
    expect(c).not.toContain('$_componentHelper(');
  });

  test('a binding named `component` shadows the keyword (native)', () => {
    const c = code('{{#let this.x as |component|}}<Bar @baz={{component 1}} />{{/let}}', NATIVE, [
      'Bar',
    ]);
    expect(c).not.toContain('$_componentHelper(');
  });
});
