import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

/**
 * Regression: kebab-cased names in bare-call positions must never be emitted
 * as a bare JS callee. `my-helper(x)` is parsed by JS as `my - helper(x)`
 * (subtraction), silently breaking the call. Such names must be routed through
 * the string-resolution helpers (`$_maybeHelper` / `$_maybeModifier`) instead.
 */

const EMBER_FLAGS = {
  IS_GLIMMER_COMPAT_MODE: true,
  WITH_EMBER_INTEGRATION: true,
} as const;

/** Replace every JS string/template literal with "" so we can inspect the
 *  *code* (callee positions) without matching hyphenated names that live
 *  inside a legitimate string literal. */
function stripStringLiterals(code: string): string {
  return code.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
}

/** A callee that would be broken by JS as subtraction, e.g. `foo-bar(`. */
function hasHyphenatedBareCallee(code: string): boolean {
  return /[A-Za-z_$][\w$]*-[\w$-]*\s*\(/.test(stripStringLiterals(code));
}

describe('kebab bare-call codegen (Bug 1)', () => {
  describe('yield sub-expression helper', () => {
    test('{{yield (my-helper this.x)}} routes through $_maybeHelper', () => {
      const { code } = compile('{{yield (my-helper this.x)}}', { flags: EMBER_FLAGS });
      expect(code).toContain('$_maybeHelper("my-helper"');
      // No bare `my-helper(` callee (would be `my - helper(...)`).
      expect(stripStringLiterals(code)).not.toContain('my-helper');
      expect(hasHyphenatedBareCallee(code)).toBe(false);
    });

    test.each(['my-helper', 'a-b-c', 'foo-bar-baz', 'x-y'])(
      'kebab helper name %s never emits a bare callee',
      (name) => {
        const { code } = compile(`{{yield (${name} this.x)}}`, { flags: EMBER_FLAGS });
        expect(code).toContain(`$_maybeHelper("${name}"`);
        expect(hasHyphenatedBareCallee(code)).toBe(false);
      },
    );

    test('nested kebab helper inside (fn ...) routes through $_maybeHelper', () => {
      const { code } = compile('{{yield (fn (my-helper this.x))}}', { flags: EMBER_FLAGS });
      expect(code).toContain('$_maybeHelper("my-helper"');
      expect(hasHyphenatedBareCallee(code)).toBe(false);
    });

    test('camelCase helper name is unaffected (bare call kept)', () => {
      const { code } = compile('{{yield (myHelper this.x)}}', { flags: EMBER_FLAGS });
      expect(code).toContain('myHelper(this.x)');
      expect(code).not.toContain('$_maybeHelper("myHelper"');
    });

    test('a known kebab-rooted binding is not rerouted (dotted path stays valid)', () => {
      // `foo` is a known binding; `foo.bar` is a valid member-callee, keep it.
      const { code } = compile('{{yield (foo.bar this.x)}}', {
        bindings: new Set(['foo']),
        flags: EMBER_FLAGS,
      });
      expect(code).toContain('foo.bar(this.x)');
    });
  });

  describe('element modifiers', () => {
    test('<div {{my-mod this.x}}> routes through $_maybeModifier', () => {
      const { code } = compile('<div {{my-mod this.x}}></div>', { flags: EMBER_FLAGS });
      expect(code).toContain('$_maybeModifier("my-mod"');
      expect(stripStringLiterals(code)).not.toContain('my-mod');
      expect(hasHyphenatedBareCallee(code)).toBe(false);
    });

    test('kebab modifier with named args stays valid JS', () => {
      const { code } = compile('<div {{my-mod this.x foo=this.y}}></div>', { flags: EMBER_FLAGS });
      expect(code).toContain('$_maybeModifier("my-mod"');
      expect(hasHyphenatedBareCallee(code)).toBe(false);
      // Emitted array body must parse without a SyntaxError.
      expect(() => new Function(`return (${code})`)).not.toThrow();
    });

    test('camelCase modifier name is unaffected (bare call kept)', () => {
      const { code } = compile('<div {{myMod this.x}}></div>', { flags: EMBER_FLAGS });
      expect(code).toContain('myMod($n, this.x)');
      expect(code).not.toContain('$_maybeModifier("myMod"');
    });
  });
});
