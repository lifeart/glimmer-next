import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

/**
 * Regression: a JS reserved word used as a block param / let binding
 * (`{{#each x as |if|}}`, `{{#let y as |class|}}`, `<Comp as |return|>`) must
 * not be emitted as a `let`/parameter identifier — `let if = …` / `(if) => …`
 * is a SyntaxError. The name must be escaped to a safe identifier at BOTH the
 * declaration site and every reference so the rename is transparent.
 */

const EMBER_FLAGS = {
  IS_GLIMMER_COMPAT_MODE: true,
  WITH_EMBER_INTEGRATION: true,
} as const;

/** Assert the compiled array body parses as valid JS (no SyntaxError). */
function assertParses(code: string): void {
  expect(() => new Function(`return (${code})`)).not.toThrow();
}

// A representative slice of reserved words across the categories that a
// template might plausibly use as a block param. `else` is intentionally
// excluded here because `{{else}}` is the handlebars inverse-separator and so
// can never be written as a *reference*; its declaration escaping is covered
// separately below.
const RESERVED = [
  'if', 'for', 'let', 'class', 'return', 'function', 'var', 'const', 'in',
  'do', 'new', 'this', 'typeof', 'void', 'yield', 'await', 'static', 'enum',
  'switch', 'default', 'null', 'true', 'false',
];

describe('reserved-word block params (Bug 2)', () => {
  describe('{{#each as |<reserved>|}}', () => {
    test.each(RESERVED)('as |%s| emits valid JS (escaped identifier)', (word) => {
      const { code } = compile(`{{#each this.x as |${word}|}}{{${word}}}{{/each}}`, {
        flags: EMBER_FLAGS,
      });
      assertParses(code);
      expect(code).toContain(`__bp_${word}`);
      // No bare `let <reserved>` / `(<reserved>,` declaration remains.
      expect(code).not.toMatch(new RegExp(`\\(\\s*${word}\\s*,`));
    });

    test('member read on a reserved-word row item taps the escaped name', () => {
      const { code } = compile('{{#each this.x as |if|}}{{if.name}}{{/each}}', {
        flags: EMBER_FLAGS,
      });
      assertParses(code);
      expect(code).toContain('$__cellFor(__bp_if, "name")');
    });

    test('an `else`-named block param is escaped at the declaration site', () => {
      // `{{else}}` is the inverse-separator so it can't be *referenced*, but the
      // `(else, …) =>` declaration would still be a SyntaxError without escaping.
      const { code } = compile('{{#each this.x as |else|}}static{{/each}}', {
        flags: EMBER_FLAGS,
      });
      assertParses(code);
      expect(code).toContain('__bp_else');
    });

    test('a reserved-word INDEX param is escaped and index→.value still matches', () => {
      const { code } = compile('{{#each this.x as |item for|}}{{item}}-{{for}}{{/each}}', {
        flags: EMBER_FLAGS,
      });
      assertParses(code);
      expect(code).toContain('__bp_for');
      // The index→.value rewrite must have targeted the escaped identifier.
      expect(code).toContain('__bp_for.value');
    });
  });

  describe('{{#let as |<reserved>|}}', () => {
    test.each(RESERVED)('as |%s| emits valid JS (escaped identifier)', (word) => {
      const { code } = compile(`{{#let this.y as |${word}|}}{{${word}}}{{/let}}`, {
        flags: EMBER_FLAGS,
      });
      assertParses(code);
      expect(code).toContain(`__bp_${word}`);
      expect(code).not.toMatch(new RegExp(`let\\s+${word}\\b`));
    });

    test('primitive let binding with a reserved name emits `let __bp_return`', () => {
      const { code } = compile('{{#let "hi" as |return|}}{{return}}{{/let}}', {
        flags: EMBER_FLAGS,
      });
      assertParses(code);
      expect(code).toContain('let __bp_return = "hi"');
      expect(code).toContain('__bp_return');
    });
  });

  describe('component / named-block params', () => {
    test('<Comp as |if|> escapes the yielded param', () => {
      const { code } = compile('<Foo as |if|>{{if}}</Foo>', {
        bindings: new Set(['Foo']),
        flags: EMBER_FLAGS,
      });
      assertParses(code);
      expect(code).toContain('__bp_if');
      expect(code).not.toMatch(/\(\s*ctx0\s*,\s*if\s*\)/);
    });
  });

  describe('non-reserved names are unaffected (byte-identical)', () => {
    test('{{#each as |item|}} keeps the bare `item` identifier', () => {
      const { code } = compile('{{#each this.x as |item|}}{{item}}{{/each}}', {
        flags: EMBER_FLAGS,
      });
      expect(code).toContain('(item, $index, ctx0)');
      expect(code).not.toContain('__bp_item');
    });

    test('{{#let as |a|}} keeps the bare `a` identifier', () => {
      const { code } = compile('{{#let this.y as |a|}}{{a}}{{/let}}', {
        flags: EMBER_FLAGS,
      });
      expect(code).toContain('let a =');
      expect(code).not.toContain('__bp_a');
    });

    test('an `if`-named binding is NOT confused with the {{if}} keyword', () => {
      // The built-in {{if}} helper must remain the built-in — only the *block
      // param* named `if` is escaped.
      const { code } = compile('{{#if this.cond}}yes{{else}}no{{/if}}', {
        flags: EMBER_FLAGS,
      });
      assertParses(code);
      expect(code).not.toContain('__bp_if');
    });
  });
});
