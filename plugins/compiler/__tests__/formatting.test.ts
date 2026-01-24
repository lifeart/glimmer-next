import { describe, test, expect } from 'vitest';
import {
  formatWithPrettier,
  formatManually,
  isPrettierAvailable,
} from '../formatting';

describe('Formatting Module', () => {
  describe('isPrettierAvailable', () => {
    test('returns a boolean', async () => {
      const result = await isPrettierAvailable();
      expect(typeof result).toBe('boolean');
    });

    test('returns true when Prettier is installed', async () => {
      // Prettier is in devDependencies, so should be available
      const result = await isPrettierAvailable();
      expect(result).toBe(true);
    });

    test('caches result after first check', async () => {
      const result1 = await isPrettierAvailable();
      const result2 = await isPrettierAvailable();
      expect(result1).toBe(result2);
    });
  });

  describe('formatWithPrettier', () => {
    test('formats valid JavaScript code', async () => {
      const code = 'const x=1;const y=2;';
      const result = await formatWithPrettier(code);

      expect(result.code).not.toBe(code);
      expect(result.code).toContain('const x');
      expect(result.code).toContain('const y');
    });

    test('respects singleQuote option', async () => {
      const code = 'const x = "hello";';

      const withSingle = await formatWithPrettier(code, { singleQuote: true });
      const withDouble = await formatWithPrettier(code, { singleQuote: false });

      expect(withSingle.code).toContain("'hello'");
      expect(withDouble.code).toContain('"hello"');
    });

    test('respects semi option', async () => {
      const code = 'const x = 1';

      const withSemi = await formatWithPrettier(code, { semi: true });
      const withoutSemi = await formatWithPrettier(code, { semi: false });

      expect(withSemi.code.trim()).toMatch(/;$/);
      expect(withoutSemi.code.trim()).not.toMatch(/;$/);
    });

    test('respects tabWidth option', async () => {
      const code = 'function foo() { return { a: 1, b: 2 }; }';

      const with2 = await formatWithPrettier(code, { tabWidth: 2, printWidth: 20 });
      const with4 = await formatWithPrettier(code, { tabWidth: 4, printWidth: 20 });

      // Check indentation difference
      expect(with2.code).toContain('  ');
      expect(with4.code).toContain('    ');
    });

    test('respects useTabs option', async () => {
      const code = 'function foo() { return { a: 1, b: 2, c: 3 }; }';

      const withTabs = await formatWithPrettier(code, { useTabs: true, printWidth: 30 });
      const withSpaces = await formatWithPrettier(code, { useTabs: false, printWidth: 30 });

      expect(withTabs.code).toContain('\t');
      expect(withSpaces.code).not.toContain('\t');
    });

    test('handles array expressions', async () => {
      const code = '[$_tag("div",[])]';
      const result = await formatWithPrettier(code);

      expect(result.code).toBeDefined();
      // Should be properly formatted
      expect(result.code.length).toBeGreaterThan(0);
    });

    test('handles compiler output', async () => {
      const code = '[$_tag("div", [[], [], []], ["hello"], this)]';
      const result = await formatWithPrettier(code);

      expect(result.code).toContain('$_tag');
      // Prettier converts to single quotes by default
      expect(result.code).toContain("'div'");
    });
  });

  describe('formatManually', () => {
    test('adds newlines after opening brackets', () => {
      const code = '[a, b]';
      const result = formatManually(code);

      expect(result).toContain('\n');
    });

    test('adds indentation inside brackets', () => {
      const code = '[a, b]';
      const result = formatManually(code);

      expect(result).toContain('  a'); // Default indent is 2 spaces
    });

    test('handles nested brackets', () => {
      const code = '[[a]]';
      const result = formatManually(code);

      // Should have increasing indentation
      expect(result).toContain('\n');
      const lines = result.split('\n');
      expect(lines.length).toBeGreaterThan(2);
    });

    test('preserves strings - no formatting inside quotes', () => {
      const code = '["hello, world"]';
      const result = formatManually(code);

      // The comma inside the string should not cause a newline
      expect(result).toContain('"hello, world"');
    });

    test('preserves strings with brackets inside', () => {
      const code = '["[test]"]';
      const result = formatManually(code);

      expect(result).toContain('"[test]"');
    });

    test('handles empty input', () => {
      const result = formatManually('');
      expect(result).toBe('');
    });

    test('handles empty array', () => {
      const code = '[]';
      const result = formatManually(code);

      // Empty array shouldn't add newlines
      expect(result).toBe('[]');
    });

    test('respects custom indent string', () => {
      const code = '[a, b]';
      const result = formatManually(code, { indent: '\t' });

      expect(result).toContain('\t');
      expect(result).not.toMatch(/^  /m);
    });

    test('respects custom newline string', () => {
      const code = '[a, b]';
      const result = formatManually(code, { newline: '\r\n' });

      expect(result).toContain('\r\n');
    });

    test('handles objects', () => {
      const code = '{ a: 1, b: 2 }';
      const result = formatManually(code);

      expect(result).toContain('\n');
      expect(result).toContain('a: 1');
    });

    test('handles mixed structures', () => {
      const code = '[{ a: [1, 2] }]';
      const result = formatManually(code);

      expect(result).toContain('\n');
      expect(result).toContain('a:');
    });

    test('handles function calls', () => {
      const code = 'foo(a, b, c)';
      const result = formatManually(code);

      expect(result).toContain('\n');
      expect(result).toContain('a');
    });

    test('handles compiler-like output', () => {
      const code = '[$_tag("div", [[], [], []], [], this)]';
      const result = formatManually(code);

      expect(result).toContain('$_tag');
      expect(result).toContain('"div"');
      expect(result).toContain('\n');
    });
  });

  describe('integration', () => {
    test('Prettier and manual produce similar structure', async () => {
      const code = '[a, b, c]';

      const prettier = await formatWithPrettier(code);
      const manual = formatManually(code);

      // Both should have newlines
      expect(prettier.code).toContain('\n');
      expect(manual).toContain('\n');

      // Both should preserve content
      expect(prettier.code).toContain('a');
      expect(manual).toContain('a');
    });
  });
});
