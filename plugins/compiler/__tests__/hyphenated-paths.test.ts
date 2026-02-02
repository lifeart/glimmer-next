import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

describe('Hyphenated path handling', () => {
  describe('property access serialization', () => {
    test('hyphenated component name in scope lookup', () => {
      const result = compile('<div>{{c.my-component}}</div>', {
        bindings: new Set(['c']),
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      console.log('Generated code:', result.code);

      // Should use bracket notation for hyphenated property
      expect(result.code).toContain('["my-component"]');
      // Should NOT use dot notation (which would be invalid JS)
      expect(result.code).not.toContain('.my-component');
    });

    test('multiple hyphenated segments in path', () => {
      const result = compile('<div>{{this.my-data.sub-value}}</div>', {
        bindings: new Set([]),
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      console.log('Generated code:', result.code);

      // Should use bracket notation for both hyphenated segments
      expect(result.code).toContain('["my-data"]');
      expect(result.code).toContain('["sub-value"]');
    });

    test('mixed safe and hyphenated segments', () => {
      const result = compile('<div>{{this.data.my-value.count}}</div>', {
        bindings: new Set([]),
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      console.log('Generated code:', result.code);

      // Safe keys use dot notation
      expect(result.code).toContain('.data');
      expect(result.code).toContain('.count');
      // Hyphenated uses bracket
      expect(result.code).toContain('["my-value"]');
    });
  });

  describe('named arguments with hyphenated keys', () => {
    test('helper with hyphenated named argument', () => {
      const result = compile('{{myHelper data-value="test"}}', {
        bindings: new Set(['myHelper']),
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      console.log('Generated code:', result.code);

      // Named argument key should be quoted
      expect(result.code).toContain('"data-value"');
    });

    test('component with hyphenated argument', () => {
      const result = compile('<MyComponent @data-id={{this.id}} />', {
        bindings: new Set(['MyComponent']),
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      console.log('Generated code:', result.code);

      // The @argument should handle hyphenated names
      expect(result.code).toContain('data-id');
    });
  });

  describe('element attributes', () => {
    test('hyphenated HTML attributes', () => {
      const result = compile('<div data-test-id="foo" aria-label="bar"></div>', {
        bindings: new Set([]),
      });

      console.log('Generated code:', result.code);

      // HTML attributes with hyphens should be properly quoted
      expect(result.code).toContain('"data-test-id"');
      expect(result.code).toContain('"aria-label"');
    });
  });
});
