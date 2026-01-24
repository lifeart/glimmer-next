import { describe, test, expect } from 'vitest';
import { templateToTypescript } from '../adapter';
import type { Flags } from '../../flags';

describe('Adapter Layer', () => {
  const defaultFlags: Flags = {
    IS_GLIMMER_COMPAT_MODE: true,
  } as Flags;

  describe('templateToTypescript()', () => {
    test('returns RewriteResult with correct structure', () => {
      const result = templateToTypescript('<div>test</div>', defaultFlags);

      expect(result).toHaveProperty('code');
      expect(result).toHaveProperty('mapping');
      expect(result).toHaveProperty('directives');
      expect(result).toHaveProperty('errors');
    });

    test('generates valid code', () => {
      const result = templateToTypescript('<div>Hello</div>', defaultFlags);

      expect(typeof result.code).toBe('string');
      expect(result.code.length).toBeGreaterThan(0);
      expect(result.code).toContain('$_tag');
    });

    test('returns empty errors for valid template', () => {
      const result = templateToTypescript('<div>test</div>', defaultFlags);
      expect(result.errors).toHaveLength(0);
    });

    test('returns errors for invalid template', () => {
      const result = templateToTypescript('{{/if}}', defaultFlags);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('mapping has old API format', () => {
      const result = templateToTypescript('<div>test</div>', defaultFlags);
      const mapping = result.mapping;

      // Old format uses transformedRange/originalRange
      expect(mapping).toHaveProperty('transformedRange');
      expect(mapping).toHaveProperty('originalRange');
      expect(mapping).toHaveProperty('children');
      expect(mapping).toHaveProperty('sourceNode');

      // Should have methods
      expect(typeof mapping.clone).toBe('function');
      expect(typeof mapping.shiftOriginal).toBe('function');
      expect(typeof mapping.shiftTransformed).toBe('function');
      expect(typeof mapping.addChild).toBe('function');
    });

    test('mapping transformedRange has correct bounds', () => {
      const template = '<div>test</div>';
      const result = templateToTypescript(template, defaultFlags);

      expect(result.mapping.transformedRange.start).toBe(0);
      expect(result.mapping.transformedRange.end).toBe(result.code.length);
    });

    test('mapping originalRange has correct bounds', () => {
      const template = '<div>test</div>';
      const result = templateToTypescript(template, defaultFlags);

      expect(result.mapping.originalRange.start).toBe(0);
      expect(result.mapping.originalRange.end).toBe(template.length);
    });

    test('clone() creates a copy', () => {
      const result = templateToTypescript('<div>test</div>', defaultFlags);
      const cloned = result.mapping.clone();

      expect(cloned).not.toBe(result.mapping);
      expect(cloned.transformedRange).toEqual(result.mapping.transformedRange);
      expect(cloned.originalRange).toEqual(result.mapping.originalRange);
    });

    test('shiftOriginal() shifts all ranges', () => {
      const result = templateToTypescript('<div>test</div>', defaultFlags);
      const originalStart = result.mapping.originalRange.start;
      const originalEnd = result.mapping.originalRange.end;

      result.mapping.shiftOriginal(100);

      expect(result.mapping.originalRange.start).toBe(originalStart + 100);
      expect(result.mapping.originalRange.end).toBe(originalEnd + 100);
    });

    test('shiftTransformed() shifts all ranges', () => {
      const result = templateToTypescript('<div>test</div>', defaultFlags);
      const transformedStart = result.mapping.transformedRange.start;
      const transformedEnd = result.mapping.transformedRange.end;

      result.mapping.shiftTransformed(50);

      expect(result.mapping.transformedRange.start).toBe(transformedStart + 50);
      expect(result.mapping.transformedRange.end).toBe(transformedEnd + 50);
    });

    test('respects bindings', () => {
      const bindings = new Set(['MyComponent']);
      const result = templateToTypescript('<MyComponent />', defaultFlags, bindings);

      expect(result.code).toContain('$_c');
      expect(result.code).toContain('MyComponent');
    });

    test('compiles mustache expressions', () => {
      const result = templateToTypescript('{{this.name}}', defaultFlags);

      expect(result.code).toContain('this.name');
    });

    test('compiles block expressions', () => {
      const result = templateToTypescript('{{#if this.show}}yes{{/if}}', defaultFlags);

      expect(result.code).toContain('$_if');
    });

    test('compiles each blocks', () => {
      const result = templateToTypescript(
        '{{#each this.items as |item|}}{{item}}{{/each}}',
        defaultFlags
      );

      expect(result.code).toContain('$_each');
    });
  });

  describe('directives', () => {
    test('returns empty directives array', () => {
      const result = templateToTypescript('<div>test</div>', defaultFlags);
      expect(result.directives).toEqual([]);
    });
  });
});
