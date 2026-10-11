/**
 * G4 / G9 / G-kw emission — helper, modifier and curry call sites under the
 * EMBER_NATIVE compile flag (the Ember native layer).
 *
 * Flag on:
 *   - every helper / modifier / curry argument is a primitive LITERAL or a
 *     zero-arg THUNK — never an eagerly evaluated value (nested
 *     sub-expressions included), so the host unwraps exactly;
 *   - `$_maybeHelper(ref, [args], {named}, ctx, site)` — one shape for known
 *     and unknown helpers; `ctx` is the enclosing render context, `site` a
 *     per-template call-site index;
 *   - `$_maybeModifier(ref, $n, [args], {named}, ctx)`; an unbound `{{on}}`
 *     is Ember's built-in modifier (`$_maybeModifier("on", …)`), not gxt's
 *     native event binding;
 *   - `$_componentHelper` / `$_helperHelper` / `$_modifierHelper` get
 *     literal-or-thunk arguments (the definition included);
 *   - `<@comp />` is a dynamic component (`$_dc`);
 *   - `{{yield …}}` params are built against the enclosing render context.
 *
 * Flag off: byte-identical to the historic output.
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

function code(tpl: string, flags: Record<string, unknown>, bindings: string[] = []) {
  const result = compile(tpl, { flags: flags as never, bindings: new Set(bindings) });
  expect(result.errors).toHaveLength(0);
  return result.code;
}

describe('EMBER_NATIVE: helper call sites (G4)', () => {
  test('known helper: thunked path args, literal args, named object, ctx + site', () => {
    const c = code('<span>{{fmt this.a 2 currency="USD" other=this.b}}</span>', NATIVE, ['fmt']);
    expect(c).toContain(
      '$_maybeHelper(fmt, [() => this.a, 2], { currency: "USD", other: () => this.b }, this, 0)'
    );
  });

  test('nested sub-expressions are thunks, not eager calls', () => {
    const c = code('{{fmt (concat "a" this.b)}}', NATIVE, ['fmt', 'concat']);
    expect(c).toContain(
      '$_maybeHelper(fmt, [() => $_maybeHelper(concat, ["a", () => this.b], {}, this, 0)], {}, this, 1)'
    );
  });

  test('site indices are distinct per call site and the block ctx is passed inside blocks', () => {
    const c = code(
      '{{fmt 1}}{{#if this.c}}{{fmt 2}}{{/if}}{{#each this.items as |it|}}{{fmt it}}{{/each}}',
      NATIVE,
      ['fmt']
    );
    expect(c).toContain('$_maybeHelper(fmt, [1], {}, this, 0)');
    expect(c).toMatch(/\$_maybeHelper\(fmt, \[2\], \{\}, ctx\d+, 1\)/);
    expect(c).toMatch(/\$_maybeHelper\(fmt, \[\(\) => it\], \{\}, ctx\d+, 2\)/);
  });

  test('an unknown (unbound) helper name uses the same 5-argument shape', () => {
    const c = code('{{neq this.a this.b}}', NATIVE);
    expect(c).toContain('$_maybeHelper("neq", [() => this.a, () => this.b], {}, this, 0)');
  });

  test('yield params: helper calls go through $_maybeHelper with the block ctx', () => {
    const c = code('{{#each this.items as |it|}}{{yield it.y (fmt this.a)}}{{/each}}', NATIVE, ['fmt']);
    expect(c).toMatch(/\$_slot\("default", \(\) => \[[\s\S]*\$__tag\(it, "y"\)/);
    expect(c).toMatch(/\$_maybeHelper\(fmt, \[\(\) => this\.a\], \{\}, ctx\d+, 0\)/);
    expect(c).not.toContain('fmt(this.a)');
  });
});

describe('EMBER_NATIVE: modifier call sites', () => {
  test('known modifier: thunked positional + named, render ctx as 5th argument', () => {
    const c = code('<div {{tagIt this.a "x" k=this.b n=1}}></div>', NATIVE, ['tagIt']);
    expect(c).toContain(
      '$n => $_maybeModifier(tagIt, $n, [() => this.a, "x"], { k: () => this.b, n: 1 }, this)'
    );
  });

  test('imported on: handler is a thunk (never read by the element-creation formula)', () => {
    const c = code('<button {{on "click" this.inc}}></button>', NATIVE, ['on']);
    expect(c).toContain('$_maybeModifier(on, $n, ["click", () => this.inc], {}, this)');
  });

  test('unbound on is the Ember built-in modifier, not a native event binding', () => {
    const c = code('<button {{on "click" this.inc once=true}}></button>', NATIVE);
    expect(c).toContain('$_maybeModifier("on", $n, ["click", () => this.inc], { once: true }, this)');
    // not gxt's native event tuple `["click", ($e, $n) => handler($e, $n)]`
    expect(c).not.toContain('($e, $n)');
  });

  test('a nested (fn …) in modifier args is a thunk', () => {
    const c = code('<button {{on "click" (fn this.go 1)}}></button>', NATIVE, ['on', 'fn']);
    expect(c).toContain(
      '$_maybeModifier(on, $n, ["click", () => $_maybeHelper(fn, [() => this.go, 1], {}, this, 0)], {}, this)'
    );
  });

  test('dynamic modifier: eager definition, thunked extra args, plain named object, ctx', () => {
    const c = code('<div {{(if this.c (modifier tagIt 1)) this.x k=this.y}}></div>', NATIVE, ['tagIt']);
    expect(c).toMatch(
      /\$_maybeModifier\(\$__if\([^\n]*\), \$n, \[\(\) => this\.x\], \{ k: \(\) => this\.y \}, this\)/
    );
    expect(c).toContain('$_modifierHelper([() => tagIt, 1], {})');
  });
});

describe('EMBER_NATIVE: curry sites (G9) and dynamic components', () => {
  test('(component …): definition and args are literal-or-thunk', () => {
    const c = code('{{#let (component Cmp a=this.x b=1) as |C|}}<C />{{/let}}', NATIVE, ['Cmp']);
    expect(c).toContain('$_componentHelper([() => Cmp], { a: () => this.x, b: 1 })');
  });

  test('(helper …) / (modifier …) curry with thunked positional args', () => {
    const c = code(
      '{{#let (helper fmt this.a) (modifier tagIt (concat "a" this.b)) as |H M|}}{{H 3}}<p {{M}}></p>{{/let}}',
      NATIVE,
      ['fmt', 'tagIt', 'concat']
    );
    expect(c).toContain('$_helperHelper([() => fmt, () => this.a], {})');
    expect(c).toMatch(
      /\$_modifierHelper\(\[\(\) => tagIt, \(\) => \$_maybeHelper\(concat, \["a", \(\) => this\.b\], \{\}, this, \d+\)\], \{\}\)/
    );
    // the curried helper's invocation is itself a helper call site
    expect(c).toMatch(/\$_maybeHelper\(H\(\), \[3\], \{\}, this, \d+\)/);
    expect(c).toContain('$_maybeModifier(M(), $n, [], {}, this)');
  });

  test('a curried component inside a yielded (hash) keeps thunked args', () => {
    const c = code('{{yield (hash title=(component Cmp a=2))}}', NATIVE, ['Cmp']);
    expect(c).toContain('$_componentHelper([() => Cmp], { a: 2 })');
  });

  test('<@comp /> and {{component @comp}} are dynamic components', () => {
    const angle = code('<@comp @a={{this.x}} />', NATIVE);
    expect(angle).toContain('$_dc(');
    expect(angle).toContain('() => $a.comp');
    expect(angle).not.toContain("$_tag('@comp'");
    const curly = code('{{component @comp a=1}}', NATIVE);
    expect(curly).toContain('$_dc(');
    expect(curly).not.toContain("$_tag('@comp'");
  });
});

describe('EMBER_NATIVE: dynamic component blocks', () => {
  test('a single text child of a path-tag component is its default block, not textContent', () => {
    const c = code('{{#let (hash t=this.c) as |card|}}<card.t>Hello</card.t>{{/let}}', NATIVE, ['hash']);
    expect(c).toMatch(/default: ctx\d+ => \[\s*"Hello"\s*\]/);
    expect(c).not.toMatch(/\["1", "Hello"\]/);
    const arg = code('<@comp>Hi</@comp>', NATIVE);
    expect(arg).toMatch(/default: ctx\d+ => \[\s*"Hi"\s*\]/);
  });

  test('flag off: the historic textContent fold is kept', () => {
    const c = code('{{#let (hash t=this.c) as |card|}}<card.t>Hello</card.t>{{/let}}', COMPAT, ['hash']);
    expect(c).toMatch(/\["1", "Hello"\]/);
  });
});

describe('EMBER_NATIVE off: historic output', () => {
  const SHAPES: Array<[string, string[]]> = [
    ['<span>{{fmt this.a 2 currency="USD"}}</span>', ['fmt']],
    ['{{fmt (concat "a" this.b)}}', ['fmt', 'concat']],
    ['{{neq this.a this.b}}', []],
    ['<div {{tagIt this.a k=this.b}}></div>', ['tagIt']],
    ['<button {{on "click" this.inc}}></button>', []],
    ['<button {{on "click" this.inc}}></button>', ['on']],
    ['{{#let (component Cmp a=this.x) as |C|}}<C />{{/let}}', ['Cmp']],
    ['{{yield (hash title=(component Cmp a=2)) (fmt this.a)}}', ['Cmp', 'fmt']],
    ['<@comp @a={{this.x}} />', []],
  ];
  for (const [tpl, bindings] of SHAPES) {
    test(`unchanged: ${tpl}`, () => {
      const off = code(tpl, COMPAT, bindings);
      const explicitOff = code(tpl, { ...COMPAT, EMBER_NATIVE: false }, bindings);
      expect(explicitOff).toBe(off);
      // the native-only 5-argument helper shape never leaks into flag-off output
      expect(off).not.toMatch(/\$_maybeHelper\([^\n]*, (this|ctx\d+), \d+\)/);
    });
  }

  test('flag-off pinned shapes (the historic eager forms)', () => {
    expect(code('<div {{tagIt this.a}}></div>', COMPAT, ['tagIt'])).toContain(
      '$_maybeModifier(tagIt, $n, [this.a], {})'
    );
    expect(code('{{fmt (concat "a" this.b)}}', COMPAT, ['fmt', 'concat'])).toContain(
      '$_maybeHelper(fmt, [$_maybeHelper(concat, ["a", () => this.b], {})], {})'
    );
    expect(code('<@comp />', COMPAT)).toContain("$_tag('@comp'");
  });
});
