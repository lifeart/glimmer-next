import { describe, test, expect } from 'vitest';
import {
  serializeJS,
  member,
  id,
} from '../builder';
import { CodeEmitter } from '../tracking/code-emitter';
import type { JSMemberExpression } from '../builder/types';

describe('Serialize source mapping', () => {
  describe('streaming mode with propertySourceRange', () => {
    test('hyphenated property preserves source mapping', () => {
      const emitter = new CodeEmitter(100);

      // Create member expression with propertySourceRange
      const node: JSMemberExpression = {
        type: 'member',
        object: { type: 'identifier', name: 'obj' },
        property: 'my-component',
        optional: false,
        computed: false,
        propertySourceRange: { start: 10, end: 22 },
      };

      // Serialize in streaming mode
      serializeJS(node, {
        streaming: true,
        emitter,
        emitPure: false,
      });

      expect(emitter.getCode()).toBe('obj["my-component"]');

      // Check that mapping was created for the property
      const tree = emitter.getMappingTree();
      const mappings = tree.children;

      // Should have a mapping for the hyphenated property
      const propMapping = mappings.find(
        m => m.sourceRange?.start === 10 && m.sourceRange?.end === 22
      );
      expect(propMapping).toBeDefined();
      expect(propMapping?.name).toBe('my-component');
    });

    test('optional hyphenated property preserves source mapping', () => {
      const emitter = new CodeEmitter(100);

      const node: JSMemberExpression = {
        type: 'member',
        object: { type: 'identifier', name: 'obj' },
        property: 'data-value',
        optional: true,
        computed: false,
        propertySourceRange: { start: 5, end: 15 },
      };

      serializeJS(node, {
        streaming: true,
        emitter,
        emitPure: false,
      });

      expect(emitter.getCode()).toBe('obj?.["data-value"]');

      const tree = emitter.getMappingTree();
      const propMapping = tree.children.find(
        m => m.sourceRange?.start === 5 && m.sourceRange?.end === 15
      );
      expect(propMapping).toBeDefined();
    });

    test('safe property preserves source mapping', () => {
      const emitter = new CodeEmitter(100);

      const node: JSMemberExpression = {
        type: 'member',
        object: { type: 'identifier', name: 'obj' },
        property: 'safeProp',
        optional: false,
        computed: false,
        propertySourceRange: { start: 4, end: 12 },
      };

      serializeJS(node, {
        streaming: true,
        emitter,
        emitPure: false,
      });

      expect(emitter.getCode()).toBe('obj.safeProp');

      const tree = emitter.getMappingTree();
      const propMapping = tree.children.find(
        m => m.sourceRange?.start === 4 && m.sourceRange?.end === 12
      );
      expect(propMapping).toBeDefined();
      expect(propMapping?.name).toBe('safeProp');
    });

    test('hyphenated property without sourceRange still works', () => {
      const emitter = new CodeEmitter(100);

      const node: JSMemberExpression = {
        type: 'member',
        object: { type: 'identifier', name: 'obj' },
        property: 'my-prop',
        optional: false,
        computed: false,
        // No propertySourceRange
      };

      serializeJS(node, {
        streaming: true,
        emitter,
        emitPure: false,
      });

      expect(emitter.getCode()).toBe('obj["my-prop"]');
    });
  });

  describe('non-streaming mode', () => {
    test('hyphenated property serializes correctly', () => {
      const node: JSMemberExpression = {
        type: 'member',
        object: { type: 'identifier', name: 'obj' },
        property: 'my-component',
        optional: false,
        computed: false,
        sourceRange: { start: 0, end: 20 },
      };

      const result = serializeJS(node);
      expect(result).toBe('obj["my-component"]');
    });

    test('optional hyphenated property serializes correctly', () => {
      const node: JSMemberExpression = {
        type: 'member',
        object: { type: 'identifier', name: 'obj' },
        property: 'data-attr',
        optional: true,
        computed: false,
        sourceRange: { start: 0, end: 15 },
      };

      const result = serializeJS(node);
      expect(result).toBe('obj?.["data-attr"]');
    });

    test('safe property serializes correctly', () => {
      const node: JSMemberExpression = {
        type: 'member',
        object: { type: 'identifier', name: 'obj' },
        property: 'safeProp',
        optional: false,
        computed: false,
        sourceRange: { start: 0, end: 12 },
      };

      const result = serializeJS(node);
      expect(result).toBe('obj.safeProp');
    });
  });

  describe('nested member expressions with mixed properties', () => {
    test('nested path with hyphenated segment', () => {
      // a.b["c-d"].e
      const innerMost = member(id('a'), 'b');
      const middle: JSMemberExpression = {
        type: 'member',
        object: innerMost,
        property: 'c-d',
        optional: false,
        computed: false,
        propertySourceRange: { start: 4, end: 7 },
      };
      const outer: JSMemberExpression = {
        type: 'member',
        object: middle,
        property: 'e',
        optional: false,
        computed: false,
      };

      const result = serializeJS(outer);
      expect(result).toBe('a.b["c-d"].e');
    });

    test('nested path with multiple hyphenated segments', () => {
      // obj["a-b"]["c-d"]
      const inner: JSMemberExpression = {
        type: 'member',
        object: { type: 'identifier', name: 'obj' },
        property: 'a-b',
        optional: false,
        computed: false,
      };
      const outer: JSMemberExpression = {
        type: 'member',
        object: inner,
        property: 'c-d',
        optional: false,
        computed: false,
      };

      const result = serializeJS(outer);
      expect(result).toBe('obj["a-b"]["c-d"]');
    });

    test('optional chain with hyphenated property', () => {
      // obj?.["my-prop"]?.value
      const inner: JSMemberExpression = {
        type: 'member',
        object: { type: 'identifier', name: 'obj' },
        property: 'my-prop',
        optional: true,
        computed: false,
      };
      const outer: JSMemberExpression = {
        type: 'member',
        object: inner,
        property: 'value',
        optional: true,
        computed: false,
      };

      const result = serializeJS(outer);
      expect(result).toBe('obj?.["my-prop"]?.value');
    });
  });

  describe('edge cases', () => {
    test('property starting with number uses bracket notation', () => {
      const node: JSMemberExpression = {
        type: 'member',
        object: { type: 'identifier', name: 'obj' },
        property: '123prop',
        optional: false,
        computed: false,
      };

      const result = serializeJS(node);
      expect(result).toBe('obj["123prop"]');
    });

    test('property with special characters uses bracket notation', () => {
      const node: JSMemberExpression = {
        type: 'member',
        object: { type: 'identifier', name: 'obj' },
        property: 'prop:value',
        optional: false,
        computed: false,
      };

      const result = serializeJS(node);
      expect(result).toBe('obj["prop:value"]');
    });

    test('property with quotes is properly escaped', () => {
      const node: JSMemberExpression = {
        type: 'member',
        object: { type: 'identifier', name: 'obj' },
        property: 'prop"value',
        optional: false,
        computed: false,
      };

      const result = serializeJS(node);
      expect(result).toBe('obj["prop\\"value"]');
    });

    test('underscore-prefixed property uses dot notation', () => {
      const node: JSMemberExpression = {
        type: 'member',
        object: { type: 'identifier', name: 'obj' },
        property: '_private',
        optional: false,
        computed: false,
      };

      const result = serializeJS(node);
      expect(result).toBe('obj._private');
    });

    test('dollar-prefixed property uses dot notation', () => {
      const node: JSMemberExpression = {
        type: 'member',
        object: { type: 'identifier', name: 'obj' },
        property: '$special',
        optional: false,
        computed: false,
      };

      const result = serializeJS(node);
      expect(result).toBe('obj.$special');
    });
  });
});
