import { describe, test, expect } from 'vitest';
import {
  // Type guards
  isHBSNode,
  isHBSControlExpression,
  isSerializedValue,
  isTextChild,
  isRuntimeTag,
  getTagName,
  // Value constructors
  literal,
  path,
  spread,
  raw,
  helper,
  runtimeTag,
  // Flags
  createFlags,
  DEFAULT_FLAGS,
  // Types for testing
  type HBSNode,
  type HBSControlExpression,
  type SerializedValue,
  type HBSChild,
  type HBSTag,
} from '../types';

describe('Type Guards', () => {
  describe('isHBSNode', () => {
    test('returns true for valid HBSNode', () => {
      const node: HBSNode = {
        _nodeType: 'element',
        tag: 'div',
        attributes: [],
        properties: [],
        events: [],
        children: [],
        blockParams: [],
        selfClosing: false,
        hasStableChild: false,
      };
      expect(isHBSNode(node)).toBe(true);
    });

    test('returns false for null', () => {
      expect(isHBSNode(null)).toBe(false);
    });

    test('returns false for string', () => {
      expect(isHBSNode('hello')).toBe(false);
    });

    test('returns false for object without _nodeType', () => {
      expect(isHBSNode({ tag: 'div', attributes: [], children: [] })).toBe(false);
    });

    test('returns false for object with wrong _nodeType', () => {
      expect(isHBSNode({ _nodeType: 'control', tag: 'div', attributes: [], children: [] })).toBe(false);
    });

    test('returns false for control expression', () => {
      expect(isHBSNode({ _nodeType: 'control', type: 'if', condition: {}, children: [] })).toBe(false);
    });
  });

  describe('isHBSControlExpression', () => {
    test('returns true for valid control expression', () => {
      const expr: HBSControlExpression = {
        _nodeType: 'control',
        type: 'if',
        condition: literal(true),
        children: [],
        inverse: null,
        blockParams: [],
        key: null,
        isSync: false,
      };
      expect(isHBSControlExpression(expr)).toBe(true);
    });

    test('returns false for null', () => {
      expect(isHBSControlExpression(null)).toBe(false);
    });

    test('returns false for HBSNode', () => {
      const node: HBSNode = {
        _nodeType: 'element',
        tag: 'div',
        attributes: [],
        properties: [],
        events: [],
        children: [],
        blockParams: [],
        selfClosing: false,
        hasStableChild: false,
      };
      expect(isHBSControlExpression(node)).toBe(false);
    });

    test('returns false for object without _nodeType', () => {
      expect(isHBSControlExpression({ type: 'if', condition: true, children: [] })).toBe(false);
    });

    test('returns false for object with wrong _nodeType', () => {
      expect(isHBSControlExpression({ _nodeType: 'element', type: 'if', condition: true, children: [] })).toBe(false);
    });
  });

  describe('isSerializedValue', () => {
    test('returns true for literal value', () => {
      expect(isSerializedValue(literal('test'))).toBe(true);
    });

    test('returns true for path value', () => {
      expect(isSerializedValue(path('this.foo'))).toBe(true);
    });

    test('returns true for spread value', () => {
      expect(isSerializedValue(spread('...attrs'))).toBe(true);
    });

    test('returns true for raw value', () => {
      expect(isSerializedValue(raw('console.log()'))).toBe(true);
    });

    test('returns true for helper value', () => {
      expect(isSerializedValue(helper('concat'))).toBe(true);
    });

    test('returns false for null', () => {
      expect(isSerializedValue(null)).toBe(false);
    });

    test('returns false for plain object without kind', () => {
      expect(isSerializedValue({ value: 'test' })).toBe(false);
    });

    test('returns false for string', () => {
      expect(isSerializedValue('test')).toBe(false);
    });
  });

  describe('isTextChild', () => {
    test('returns true for string', () => {
      expect(isTextChild('hello')).toBe(true);
    });

    test('returns false for SerializedValue', () => {
      expect(isTextChild(literal('hello'))).toBe(false);
    });

    test('returns false for HBSNode', () => {
      const node: HBSNode = {
        _nodeType: 'element',
        tag: 'div',
        attributes: [],
        properties: [],
        events: [],
        children: [],
        blockParams: [],
        selfClosing: false,
        hasStableChild: false,
      };
      expect(isTextChild(node as HBSChild)).toBe(false);
    });
  });
});

describe('Value Constructors', () => {
  describe('literal', () => {
    test('creates string literal', () => {
      const value = literal('hello');
      expect(value).toEqual({
        kind: 'literal',
        value: 'hello',
        sourceRange: undefined,
      });
    });

    test('creates number literal', () => {
      const value = literal(42);
      expect(value).toEqual({
        kind: 'literal',
        value: 42,
        sourceRange: undefined,
      });
    });

    test('creates boolean literal', () => {
      expect(literal(true).value).toBe(true);
      expect(literal(false).value).toBe(false);
    });

    test('creates null literal', () => {
      expect(literal(null).value).toBe(null);
    });

    test('creates undefined literal', () => {
      expect(literal(undefined).value).toBe(undefined);
    });

    test('includes source range when provided', () => {
      const value = literal('test', { start: 0, end: 4 });
      expect(value.sourceRange).toEqual({ start: 0, end: 4 });
    });
  });

  describe('path', () => {
    test('creates path value', () => {
      const value = path('this.foo.bar');
      expect(value).toEqual({
        kind: 'path',
        expression: 'this.foo.bar',
        isArg: false,
        sourceRange: undefined,
      });
    });

    test('creates arg path', () => {
      const value = path('@myArg', true);
      expect(value.isArg).toBe(true);
    });

    test('includes source range when provided', () => {
      const value = path('this.foo', false, { start: 5, end: 13 });
      expect(value.sourceRange).toEqual({ start: 5, end: 13 });
    });
  });

  describe('spread', () => {
    test('creates spread value', () => {
      const value = spread('...attributes');
      expect(value).toEqual({
        kind: 'spread',
        expression: '...attributes',
        sourceRange: undefined,
      });
    });

    test('includes source range when provided', () => {
      const value = spread('...attrs', { start: 0, end: 8 });
      expect(value.sourceRange).toEqual({ start: 0, end: 8 });
    });
  });

  describe('raw', () => {
    test('creates raw code value', () => {
      const value = raw('console.log("test")');
      expect(value).toEqual({
        kind: 'raw',
        code: 'console.log("test")',
        sourceRange: undefined,
      });
    });

    test('includes source range when provided', () => {
      const value = raw('foo()', { start: 10, end: 15 });
      expect(value.sourceRange).toEqual({ start: 10, end: 15 });
    });
  });

  describe('helper', () => {
    test('creates helper with no args', () => {
      const value = helper('now');
      expect(value).toEqual({
        kind: 'helper',
        name: 'now',
        positional: [],
        named: new Map(),
        sourceRange: undefined,
      });
    });

    test('creates helper with positional args', () => {
      const value = helper('concat', [literal('a'), literal('b')]);
      expect(value.positional).toHaveLength(2);
      expect(value.positional[0]).toEqual(literal('a'));
    });

    test('creates helper with named args', () => {
      const namedArgs = new Map<string, SerializedValue>([
        ['separator', literal('-')],
      ]);
      const value = helper('join', [], namedArgs);
      expect(value.named.get('separator')).toEqual(literal('-'));
    });

    test('includes source range when provided', () => {
      const value = helper('test', [], new Map(), { start: 0, end: 10 });
      expect(value.sourceRange).toEqual({ start: 0, end: 10 });
    });
  });
});

describe('Compiler Flags', () => {
  describe('DEFAULT_FLAGS', () => {
    test('has expected defaults', () => {
      expect(DEFAULT_FLAGS.IS_GLIMMER_COMPAT_MODE).toBe(true);
      expect(DEFAULT_FLAGS.WITH_HELPER_MANAGER).toBe(false);
      expect(DEFAULT_FLAGS.WITH_MODIFIER_MANAGER).toBe(false);
    });

    test('is frozen', () => {
      expect(Object.isFrozen(DEFAULT_FLAGS)).toBe(true);
    });
  });

  describe('createFlags', () => {
    test('returns default flags when no overrides', () => {
      const flags = createFlags();
      expect(flags).toEqual(DEFAULT_FLAGS);
    });

    test('overrides specific flags', () => {
      const flags = createFlags({ IS_GLIMMER_COMPAT_MODE: false });
      expect(flags.IS_GLIMMER_COMPAT_MODE).toBe(false);
      expect(flags.WITH_HELPER_MANAGER).toBe(false); // Not overridden
    });

    test('returns frozen object', () => {
      const flags = createFlags({ IS_GLIMMER_COMPAT_MODE: false });
      expect(Object.isFrozen(flags)).toBe(true);
    });

    test('does not modify DEFAULT_FLAGS', () => {
      createFlags({ IS_GLIMMER_COMPAT_MODE: false });
      expect(DEFAULT_FLAGS.IS_GLIMMER_COMPAT_MODE).toBe(true);
    });
  });
});

describe('RuntimeTag', () => {
  describe('runtimeTag()', () => {
    test('creates RuntimeTag with valid symbol', () => {
      const tag = runtimeTag('$_SVGProvider');
      expect(tag).toEqual({
        type: 'runtime',
        symbol: '$_SVGProvider',
      });
    });

    test('throws for empty string symbol', () => {
      expect(() => runtimeTag('')).toThrow('RuntimeTag symbol cannot be empty');
    });

    test('throws for whitespace-only symbol', () => {
      expect(() => runtimeTag('   ')).toThrow('RuntimeTag symbol cannot be empty');
    });

    test('throws for newline-only symbol', () => {
      expect(() => runtimeTag('\n\t')).toThrow('RuntimeTag symbol cannot be empty');
    });

    test('allows symbol with leading/trailing whitespace (trimmed for check only)', () => {
      // The validation uses trim() for check but preserves original
      const tag = runtimeTag(' $_Valid ');
      expect(tag.symbol).toBe(' $_Valid ');
    });
  });

  describe('isRuntimeTag()', () => {
    test('returns true for RuntimeTag', () => {
      const tag = runtimeTag('$_Test');
      expect(isRuntimeTag(tag)).toBe(true);
    });

    test('returns false for string', () => {
      expect(isRuntimeTag('div')).toBe(false);
    });

    test('returns false for object without type property', () => {
      expect(isRuntimeTag({ symbol: 'test' } as unknown as HBSTag)).toBe(false);
    });

    test('returns false for object with wrong type', () => {
      expect(isRuntimeTag({ type: 'other', symbol: 'test' } as unknown as HBSTag)).toBe(false);
    });

    test('returns false for null (defensive)', () => {
      expect(isRuntimeTag(null as unknown as HBSTag)).toBe(false);
    });
  });

  describe('getTagName()', () => {
    test('returns string for string tag', () => {
      expect(getTagName('div')).toBe('div');
    });

    test('returns symbol for RuntimeTag', () => {
      const tag = runtimeTag('$_SVGProvider');
      expect(getTagName(tag)).toBe('$_SVGProvider');
    });

    test('returns empty string for empty string tag', () => {
      expect(getTagName('')).toBe('');
    });
  });

  describe('HBSNode with RuntimeTag', () => {
    test('HBSNode can have string tag', () => {
      const node: HBSNode = {
        _nodeType: 'element',
        tag: 'div',
        attributes: [],
        properties: [],
        events: [],
        children: [],
        blockParams: [],
        selfClosing: false,
        hasStableChild: false,
      };
      expect(isRuntimeTag(node.tag)).toBe(false);
      expect(getTagName(node.tag)).toBe('div');
    });

    test('HBSNode can have RuntimeTag', () => {
      const node: HBSNode = {
        _nodeType: 'element',
        tag: runtimeTag('$_SVGProvider'),
        attributes: [],
        properties: [],
        events: [],
        children: [],
        blockParams: [],
        selfClosing: false,
        hasStableChild: false,
      };
      expect(isRuntimeTag(node.tag)).toBe(true);
      if (isRuntimeTag(node.tag)) {
        expect(node.tag.symbol).toBe('$_SVGProvider');
      }
    });
  });
});
