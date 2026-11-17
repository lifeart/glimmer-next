/**
 * Ember compat: the getter of a classic component's argument carries where a
 * write of the argument goes, as Glimmer's reference for it writes
 * (serializers/value.ts `withArgSource`, helpers/-private.ts `argSource`):
 * `this.x`, `this.a.b`, a block param's path, `@x` (the caller's reference)
 * and a `{{#let}}` binding of a path have a source; a literal, a helper's
 * result and a block param itself have none. Not emitted under EMBER_NATIVE
 * (no classic components) nor in standalone gxt.
 */
import { describe, test, expect } from 'vitest';
import { $_argThunk, argSource } from './dom';
import { compile } from '../../plugins/compiler/compile';

const COMPAT = {
  IS_GLIMMER_COMPAT_MODE: true,
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
} as const;
const NATIVE = { ...COMPAT, EMBER_NATIVE: true, EMBER_SELF: true, EMBER_PROPERTY_TAGS: true } as const;

function code(tpl: string, flags: object, bindings: string[] = []) {
  const result = compile(tpl, { flags: flags as never, bindings: new Set(bindings) });
  expect(result.errors).toHaveLength(0);
  return result.code.split('/*#__PURE__*/').join('');
}

describe('compat: a path argument of a component carries where a write of it goes', () => {
  test('this.x, this.a.b, @x, a literal and a helper result (curly, by name)', () => {
    const out = code('{{my-comp a=this.x b=this.a.b c=@x d=(concat "a") e=1}}', COMPAT);
    expect(out).toContain('["@a", $_argThunk(() => this.x, () => this, "x")]');
    expect(out).toMatch(/\["@b", \$_argThunk\(\(\) => this\.a\??\.b, \(\) => this\.a, "b"\)\]/);
    expect(out).toContain('["@c", $_argThunk(() => $a.x, () => $a, "@x")]');
    // not writable: branded, no source
    expect(out).toContain('["@d", $_argThunk(() => $_maybeHelper("concat", ["a"], this), null)]');
    expect(out).toContain('["@e", $_argThunk(() => 1, null)]');
  });

  test('a block param path, a block param itself and a {{#let}} binding', () => {
    const each = code('{{#each this.items as |item|}}{{my-comp a=item.name b=item}}{{/each}}', COMPAT);
    expect(each).toContain('["@a", $_argThunk(() => $__cellFor(item, "name"), () => item, "name")]');
    expect(each).toContain('["@b", $_argThunk(() => item, null)]');
    const alias = code('{{#let this.m as |m|}}{{my-comp a=m b=m.z}}{{/let}}', COMPAT);
    expect(alias).toContain('["@a", $_argThunk(() => m(), () => this, "m")]');
    expect(alias).toMatch(/\["@b", \$_argThunk\(\(\) => m\(\)\??\.z, \(\) => m\(\), "z"\)\]/);
  });

  test('an angle-bracket invocation too', () => {
    const out = code('<MyComp @a={{this.a.b}} />', COMPAT, ['MyComp']);
    expect(out).toMatch(/a: \$_argThunk\(\(\) => this\.a\??\.b, \(\) => this\.a, "b"\)/);
  });

  test('not under EMBER_NATIVE, nor in standalone gxt', () => {
    expect(code('<MyComp @a={{this.a.b}} />', NATIVE, ['MyComp'])).toMatch(
      /a: \$_argThunk\(\(\) => \$__tag\(\$__tag\(\$s, "a"\), "b"\)\) \}/,
    );
    expect(code('{{my-comp a=this.x}}', { IS_GLIMMER_COMPAT_MODE: true })).not.toContain('$_argThunk');
  });
});

describe('argSource', () => {
  test('the source a getter was branded with', () => {
    const parent = () => ({});
    const getter = $_argThunk(() => 1, parent, 'x');
    expect(argSource(getter)).toEqual([parent, 'x']);
    // not writable, as the compiler says
    expect(argSource($_argThunk(() => 1, null))).toBe(null);
    // the compiler said nothing
    expect(argSource($_argThunk(() => 1))).toBe(undefined);
    expect(argSource(() => 1)).toBe(undefined);
    expect(argSource(1)).toBe(undefined);
  });
});
