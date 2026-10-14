/**
 * Ember (compat and native): a static attribute is an attribute.
 *
 * Glimmer writes every static attribute with `setAttribute` (StaticAttr).
 * gxt classified attributes by a small name allow-list and emitted every other
 * one as a DOM property write, static values included: `form="f"` /
 * `list="l"` assigned getter-only properties (a TypeError),
 * `spellcheck="false"` set the boolean property to true, `style="display:
 * flex"` went through CSSOM (re-serialized as `display: flex;`) and
 * `<foo-bar some-attr="1">` became an expando. Under WITH_EMBER_INTEGRATION a
 * static (text) value is now emitted as an attribute; standalone output is
 * unchanged.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

const COMPAT = { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true };
const NATIVE = { ...COMPAT, EMBER_NATIVE: true };
const STANDALONE = { IS_GLIMMER_COMPAT_MODE: true };

function code(tpl: string, flags: Record<string, boolean>) {
  const result = compile(tpl, { flags } as never);
  expect(result.errors).toHaveLength(0);
  return result.code;
}

const TEMPLATE =
  '<button form="f" spellcheck="false" style="display: flex" formnovalidate="" some-attr="1" value="v"></button>';

describe('Ember: static attributes are attributes', () => {
  for (const [label, flags] of [['compat', COMPAT], ['native', NATIVE]] as const) {
    test(`${label}: every static value is in the attribute list`, () => {
      const c = code(TEMPLATE, flags);
      expect(c).toContain(
        '[[], [["form", "f"], ["spellcheck", "false"], ["style", "display: flex"], ["formnovalidate", ""], ["some-attr", "1"], ["value", "v"]], []]',
      );
    });

    test(`${label}: a dynamic value keeps the property / attribute split`, () => {
      const c = code('<input form={{this.f}} value={{this.v}} title={{this.t}} />', flags);
      expect(c).toMatch(/\[\["form", \(\) =>/);
      expect(c).toMatch(/\["value", \(\) =>/);
      expect(c).toMatch(/\["title", \(\) =>/);
    });
  }

  test('standalone gxt is unchanged', () => {
    const c = code(TEMPLATE, STANDALONE);
    expect(c).toContain('["form", "f"]');
    expect(c).toMatch(/\[\[\["form", "f"\]/);
  });
});
