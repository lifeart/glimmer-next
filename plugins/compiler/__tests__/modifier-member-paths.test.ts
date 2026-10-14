/**
 * A modifier whose path has members (`{{@x.foo}}`, `{{x.foo}}` off a
 * `{{#let}}` binding) is invoked.
 *
 * - `{{@x.foo}}` compiled to `$a["x.foo"]`, one bracket key holding the dot,
 *   so the modifier value was undefined and nothing was installed;
 * - `{{#let @x as |x|}}<div {{x.foo}}>` compiled to `x.foo` where `x` is the
 *   let-binding's getter (`let x = () => $a.x`), reading `.foo` off the getter
 *   function instead of the value (`x().foo`), as a bare `{{x}}` already does.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

const COMPAT = { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true, WITH_MODIFIER_MANAGER: true };
const NATIVE = { ...COMPAT, EMBER_NATIVE: true };
const STANDALONE = { IS_GLIMMER_COMPAT_MODE: true };

function code(tpl: string, flags: Record<string, boolean>) {
  const result = compile(tpl, { flags } as never);
  expect(result.errors).toHaveLength(0);
  return result.code;
}

describe('modifier member paths', () => {
  for (const [label, flags] of [['compat', COMPAT], ['native', NATIVE], ['standalone', STANDALONE]] as const) {
    test(`${label}: {{@x.foo}} reads the member of the argument`, () => {
      const c = code('<div {{@x.foo}}></div>', flags);
      expect(c).not.toContain('$a["x.foo"]');
      expect(c).toMatch(/\$a\??\.x\??\.foo/);
    });

    test(`${label}: {{@weird-name.foo}} brackets only the head`, () => {
      const c = code('<div {{@weird-name.foo}}></div>', flags);
      expect(c).toMatch(/\$a\["weird-name"\]\??\.foo/);
    });

    test(`${label}: a member of a let-binding reads the binding's value`, () => {
      const c = code('{{#let @x as |x|}}<div {{x.foo 1}}></div><div {{x}}></div>{{/let}}', flags);
      expect(c).toMatch(/x\(\)\??\.foo/);
      expect(c).not.toMatch(/[^\w$]x\.foo/);
    });
  }

  test('a bare {{@x}} keeps its shape', () => {
    expect(code('<div {{@x}}></div>', COMPAT)).toContain('$_maybeModifier($a.x, $n, [], {})');
  });

  test('evaluated: the let-binding member modifier is invoked with the element', () => {
    const c = code('{{#let @x as |x|}}<div {{x.foo 1}}></div>{{/let}}', STANDALONE);
    const callee = /\["0", \$n => (.+?)\(\$n, 1\)\]/.exec(c)?.[1];
    expect(callee).toBeDefined();
    const calls: unknown[] = [];
    const x = () => ({ foo: (el: unknown, n: number) => calls.push([el, n]) });
    // eslint-disable-next-line no-new-func
    new Function('x', '$n', `${callee}($n, 1);`)(x, 'EL');
    expect(calls).toEqual([['EL', 1]]);
  });
});
