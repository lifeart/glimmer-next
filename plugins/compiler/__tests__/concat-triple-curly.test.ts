/**
 * A triple curly inside a quoted attribute (`title="a {{{x}}} b"`) is a
 * concat part, which Glimmer stringifies (a concat ignores trusting). Under
 * EMBER_TRUSTED_HTML the part was lowered to the content-position `$_html`
 * node helper, rendering "a [object Object] b".
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

function code(tpl: string, flags: Record<string, unknown>, bindings: string[] = []) {
  const result = compile(tpl, { flags: flags as never, bindings: new Set(bindings) });
  expect(result.errors).toHaveLength(0);
  return result.code;
}

describe('a triple curly inside a quoted attribute is a concat part', () => {
  test('native: no $_html node helper in a concat', () => {
    const c = code('<p title="a {{{this.x}}} b"></p>', NATIVE);
    expect(c).not.toContain('$_html(');
    expect(c).toContain('this.x');
  });

  test('native: content position still uses $_html', () => {
    expect(code('<p>{{{this.x}}}</p>', NATIVE)).toContain('$_html(');
  });

  test('the same as the double-curly concat part', () => {
    const triple = code('<p title="a {{{this.x}}} b"></p>', NATIVE);
    const double = code('<p title="a {{this.x}} b"></p>', NATIVE);
    expect(triple).toBe(double);
  });
});
