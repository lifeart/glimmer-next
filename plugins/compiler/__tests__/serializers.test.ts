import { describe, test, expect, beforeEach } from 'vitest';
import { createContext, type CompilerContext } from '../context';
import {
  serialize,
  serializeNode,
  serializeChildren,
  serializeChildArray,
  serializeElement,
  serializeComponent,
  serializeControl,
  serializeValue,
  escapeString,
  isPath,
  nextCtxName,
  SYMBOLS,
  EVENT_TYPE,
  INTERNAL_HELPERS,
} from '../serializers';
import { buildValue } from '../serializers/value';
import { serializeJS } from '../builder';
import {
  literal,
  path,
  raw,
  helper,
  runtimeTag,
  type HBSNode,
  type HBSControlExpression,
  type SerializedValue,
} from '../types';

describe('Serializers', () => {
  let ctx: CompilerContext;

  beforeEach(() => {
    ctx = createContext('<div>test</div>');
  });

  describe('serialize()', () => {
    test('serializes string literal', () => {
      const result = serialize(ctx, 'Hello World', 'this');
      expect(result).toBe('"Hello World"');
    });

    test('serializes null', () => {
      const result = serialize(ctx, null as any, 'this');
      expect(result).toBeNull();
    });

    test('serializes SerializedValue', () => {
      const value = literal('test');
      const result = serialize(ctx, value, 'this');
      expect(result).toBe('"test"');
    });
  });

  describe('serializeValue()', () => {
    test('serializes literal string', () => {
      const result = serializeValue(ctx, literal('hello'), 'this');
      expect(result).toBe('"hello"');
    });

    test('serializes literal number', () => {
      const result = serializeValue(ctx, literal(42), 'this');
      expect(result).toBe('42');
    });

    test('serializes literal boolean', () => {
      expect(serializeValue(ctx, literal(true), 'this')).toBe('true');
      expect(serializeValue(ctx, literal(false), 'this')).toBe('false');
    });

    test('serializes literal null', () => {
      expect(serializeValue(ctx, literal(null), 'this')).toBe('null');
    });

    test('serializes literal undefined', () => {
      expect(serializeValue(ctx, literal(undefined), 'this')).toBe('undefined');
    });

    test('serializes path expression in compat mode', () => {
      const result = serializeValue(ctx, path('this.foo'), 'this');
      // Note: $: prefix removed as part of Phase 5 improvements
      expect(result).toBe('() => this.foo');
    });

    test('serializes raw code', () => {
      const result = serializeValue(ctx, raw('console.log()'), 'this');
      expect(result).toBe('console.log()');
    });

    test('serializes helper call', () => {
      const result = serializeValue(
        ctx,
        helper('concat', [literal('a'), literal('b')]),
        'this'
      );
      expect(result).toContain('concat');
      expect(result).toContain('"a"');
      expect(result).toContain('"b"');
    });

    test('serializes helper with named args', () => {
      const named = new Map<string, SerializedValue>([['sep', literal('-')]]);
      const result = serializeValue(ctx, helper('join', [literal('a')], named), 'this');
      expect(result).toContain('sep:');
      expect(result).toContain('"-"');
    });

    test('serializes built-in if helper', () => {
      const result = serializeValue(
        ctx,
        helper('if', [literal(true), literal('yes'), literal('no')]),
        'this'
      );
      expect(result).toContain(SYMBOLS.IF_HELPER);
    });

    test('serializes built-in eq helper', () => {
      const result = serializeValue(
        ctx,
        helper('eq', [literal(1), literal(1)]),
        'this'
      );
      expect(result).toContain(SYMBOLS.EQ);
    });
  });

  describe('serializeElement()', () => {
    test('serializes basic element', () => {
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

      const result = serializeElement(ctx, node, 'this');
      expect(result).toContain(SYMBOLS.TAG);
      expect(result).toContain("'div'");
    });

    test('serializes element with class attribute', () => {
      const node: HBSNode = {
        _nodeType: 'element',
        tag: 'div',
        attributes: [['class', literal('foo')]],
        properties: [],
        events: [],
        children: [],
        blockParams: [],
        selfClosing: false,
        hasStableChild: false,
      };

      const result = serializeElement(ctx, node, 'this');
      // Class attributes are moved to properties with empty key for classNameModifiers
      expect(result).toContain('["", "foo"]');
    });

    test('serializes element with event', () => {
      const node: HBSNode = {
        _nodeType: 'element',
        tag: 'button',
        attributes: [],
        properties: [],
        events: [['click', raw('() => {}')]],
        children: [],
        blockParams: [],
        selfClosing: false,
        hasStableChild: false,
      };

      const result = serializeElement(ctx, node, 'this');
      expect(result).toContain('"click"');
    });

    test('serializes element with children', () => {
      const node: HBSNode = {
        _nodeType: 'element',
        tag: 'div',
        attributes: [],
        properties: [],
        events: [],
        children: ['Hello'],
        blockParams: [],
        selfClosing: false,
        hasStableChild: true,
      };

      const result = serializeElement(ctx, node, 'this');
      expect(result).toContain('"Hello"');
    });

    test('uses EMPTY_DOM_PROPS for empty props', () => {
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

      const result = serializeElement(ctx, node, 'this');
      expect(result).toContain(SYMBOLS.EMPTY_DOM_PROPS);
    });
  });

  describe('serializeComponent()', () => {
    test('serializes self-closing component', () => {
      ctx.scopeTracker.addBinding('MyComponent', { kind: 'component', name: 'MyComponent' });

      const node: HBSNode = {
        _nodeType: 'element',
        tag: 'MyComponent',
        attributes: [],
        properties: [],
        events: [],
        children: [],
        blockParams: [],
        selfClosing: true,
        hasStableChild: false,
      };

      const result = serializeComponent(ctx, node, 'this');
      expect(result).toContain(SYMBOLS.COMPONENT);
      expect(result).toContain('MyComponent');
    });

    test('serializes component with @arg', () => {
      ctx.scopeTracker.addBinding('MyComponent', { kind: 'component', name: 'MyComponent' });

      const node: HBSNode = {
        _nodeType: 'element',
        tag: 'MyComponent',
        attributes: [['@name', literal('test')]],
        properties: [],
        events: [],
        children: [],
        blockParams: [],
        selfClosing: true,
        hasStableChild: false,
      };

      const result = serializeComponent(ctx, node, 'this');
      expect(result).toContain('name:');
      expect(result).toContain('"test"');
    });

    test('serializes component with children (default slot)', () => {
      ctx.scopeTracker.addBinding('MyComponent', { kind: 'component', name: 'MyComponent' });

      const node: HBSNode = {
        _nodeType: 'element',
        tag: 'MyComponent',
        attributes: [],
        properties: [],
        events: [],
        children: ['Hello'],
        blockParams: [],
        selfClosing: false,
        hasStableChild: true,
      };

      const result = serializeComponent(ctx, node, 'this');
      expect(result).toContain('default:');
    });
  });

  describe('serializeControl()', () => {
    test('serializes yield', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'yield',
        condition: literal(''),
        children: [],
        inverse: null,
        blockParams: [],
        key: 'default',
        isSync: true,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain(SYMBOLS.SLOT);
      expect(result).toContain('"default"');
    });

    test('serializes yield with params', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'yield',
        condition: literal(''),
        children: [],
        inverse: null,
        blockParams: ['item', 'index'],
        key: 'default',
        isSync: true,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain('item');
      expect(result).toContain('index');
    });

    test('serializes each block', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'each',
        condition: path('this.items'),
        children: ['item'],
        inverse: null,
        blockParams: ['item'],
        key: null,
        isSync: false,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain(SYMBOLS.EACH);
    });

    test('serializes sync each block', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'each',
        condition: path('this.items'),
        children: ['item'],
        inverse: null,
        blockParams: ['item'],
        key: null,
        isSync: true,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain(SYMBOLS.EACH_SYNC);
    });

    test('serializes each with key', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'each',
        condition: path('this.items'),
        children: ['item'],
        inverse: null,
        blockParams: ['item'],
        key: '@identity',
        isSync: false,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain('"@identity"');
    });

    test('serializes if block', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'if',
        condition: path('this.show'),
        children: ['visible'],
        inverse: ['hidden'],
        blockParams: [],
        key: null,
        isSync: false,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain(SYMBOLS.IF);
    });

    test('if block branches use valid context names not this', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'if',
        condition: path('this.show'),
        children: ['yes'],
        inverse: ['no'],
        blockParams: [],
        key: null,
        isSync: false,
      };

      const result = serializeControl(ctx, control, 'this');
      // Branch callbacks must use ctx0, ctx1, etc., not 'this' as parameter
      // 'this =>' is invalid JavaScript syntax
      expect(result).not.toMatch(/this\s*=>/);
      // Should use proper context names like ctx0 =>
      expect(result).toMatch(/ctx\d+\s*=>/);
    });

    test('if block with empty branches uses valid context names', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'if',
        condition: path('this.show'),
        children: [],
        inverse: [],
        blockParams: [],
        key: null,
        isSync: false,
      };

      const result = serializeControl(ctx, control, 'this');
      // Even empty branches should use valid parameter names
      expect(result).not.toMatch(/this\s*=>/);
      expect(result).toMatch(/ctx\d+\s*=>/);
    });

    test('serializes in-element', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'in-element',
        condition: path('this.target'),
        children: ['content'],
        inverse: null,
        blockParams: [],
        key: null,
        isSync: true,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain(SYMBOLS.IN_ELEMENT);
    });
  });

  describe('serializeChildren()', () => {
    test('returns empty string for no children', () => {
      const result = serializeChildren(ctx, [], 'this');
      expect(result).toBe('');
    });

    test('serializes string children', () => {
      const result = serializeChildren(ctx, ['Hello', 'World'], 'this');
      expect(result).toContain('"Hello"');
      expect(result).toContain('"World"');
    });

    test('serializes mixed children', () => {
      const result = serializeChildren(ctx, ['Hello', literal(42)], 'this');
      expect(result).toContain('"Hello"');
      expect(result).toContain('42');
    });
  });

  describe('serializeChildArray()', () => {
    test('returns empty array for null', () => {
      const result = serializeChildArray(ctx, null, 'this');
      expect(result).toBe('[]');
    });

    test('returns empty array for empty children', () => {
      const result = serializeChildArray(ctx, [], 'this');
      expect(result).toBe('[]');
    });

    test('wraps children in array', () => {
      const result = serializeChildArray(ctx, ['Hello'], 'this');
      expect(result).toBe('["Hello"]');
    });
  });

  describe('escapeString()', () => {
    test('escapes simple string', () => {
      expect(escapeString('hello')).toBe('"hello"');
    });

    test('escapes string with quotes', () => {
      expect(escapeString('say "hello"')).toBe('"say \\"hello\\""');
    });

    test('escapes string with newlines', () => {
      expect(escapeString('line1\nline2')).toBe('"line1\\nline2"');
    });
  });

  describe('isPath()', () => {
    test('returns true for this. prefix', () => {
      expect(isPath('this.foo')).toBe(true);
    });

    test('returns true for @ prefix', () => {
      expect(isPath('@arg')).toBe(true);
    });

    test('returns false for plain string', () => {
      expect(isPath('hello')).toBe(false);
    });
  });

  describe('nextCtxName()', () => {
    test('generates sequential names', () => {
      // Create a fresh context for this test
      const freshCtx = createContext('<div />');
      expect(nextCtxName(freshCtx)).toBe('ctx0');
      expect(nextCtxName(freshCtx)).toBe('ctx1');
      expect(nextCtxName(freshCtx)).toBe('ctx2');
    });

    test('each context has independent counter', () => {
      // First context
      const ctx1 = createContext('<div />');
      nextCtxName(ctx1); // ctx0
      nextCtxName(ctx1); // ctx1

      // New context - counter starts at 0 (no shared state)
      const ctx2 = createContext('<span />');
      expect(nextCtxName(ctx2)).toBe('ctx0');

      // Original context continues from where it left off
      expect(nextCtxName(ctx1)).toBe('ctx2');
    });
  });

  describe('SYMBOLS', () => {
    test('has expected symbols', () => {
      expect(SYMBOLS.TAG).toBe('$_tag');
      expect(SYMBOLS.COMPONENT).toBe('$_c');
      expect(SYMBOLS.IF).toBe('$_if');
      expect(SYMBOLS.EACH).toBe('$_each');
      expect(SYMBOLS.SLOT).toBe('$_slot');
    });
  });

  describe('EVENT_TYPE', () => {
    test('has expected event types', () => {
      expect(EVENT_TYPE.ON_CREATED).toBe('0');
      expect(EVENT_TYPE.TEXT_CONTENT).toBe('1');
    });

    test('textContent event is serialized with quoted string "1"', () => {
      const node: HBSNode = {
        _nodeType: 'element',
        tag: 'span',
        attributes: [],
        properties: [],
        events: [['@textContent', literal('Hello')]],
        children: [],
        blockParams: [],
        selfClosing: false,
        hasStableChild: false,
      };

      const result = serializeElement(ctx, node, 'this');
      // Should output ["1", "Hello"] not [1, "Hello"]
      expect(result).toContain('["1", "Hello"]');
    });

    test('oncreated event is serialized with quoted string "0"', () => {
      const node: HBSNode = {
        _nodeType: 'element',
        tag: 'div',
        attributes: [],
        properties: [],
        events: [[
          '@oncreated',
          helper(INTERNAL_HELPERS.ON_CREATED_HANDLER, [path('this.onCreated')], new Map()),
        ]],
        children: [],
        blockParams: [],
        selfClosing: false,
        hasStableChild: false,
      };

      const result = serializeElement(ctx, node, 'this');
      // Should output ["0", ...] not [0, ...]
      expect(result).toContain('["0"');
    });
  });
});

describe('Serializer Edge Cases', () => {
  let ctx: CompilerContext;

  beforeEach(() => {
    ctx = createContext('<div />');
  });

  test('handles element with splat attributes', () => {
    const node: HBSNode = {
      _nodeType: 'element',
      tag: 'div',
      attributes: [['...attributes', literal('')]],
      properties: [],
      events: [],
      children: [],
      blockParams: [],
      selfClosing: false,
      hasStableChild: false,
    };

    const result = serializeElement(ctx, node, 'this');
    expect(result).toContain('$fw');
  });

  test('handles component with multiple @args', () => {
    ctx.scopeTracker.addBinding('Button', { kind: 'component', name: 'Button' });

    const node: HBSNode = {
      _nodeType: 'element',
      tag: 'Button',
      attributes: [
        ['@label', literal('Click me')],
        ['@disabled', literal(false)],
      ],
      properties: [],
      events: [],
      children: [],
      blockParams: [],
      selfClosing: true,
      hasStableChild: false,
    };

    const result = serializeComponent(ctx, node, 'this');
    expect(result).toContain('label:');
    expect(result).toContain('disabled:');
  });

  test('handles deeply nested children', () => {
    const innerNode: HBSNode = {
      _nodeType: 'element',
      tag: 'span',
      attributes: [],
      properties: [],
      events: [],
      children: ['inner'],
      blockParams: [],
      selfClosing: false,
      hasStableChild: true,
    };

    const outerNode: HBSNode = {
      _nodeType: 'element',
      tag: 'div',
      attributes: [],
      properties: [],
      events: [],
      children: [innerNode],
      blockParams: [],
      selfClosing: false,
      hasStableChild: true,
    };

    const result = serializeNode(ctx, outerNode, 'this');
    expect(result).toContain("'div'");
    expect(result).toContain("'span'");
    expect(result).toContain('"inner"');
  });
});

describe('nextCtxName with context parameter', () => {
  test('increments context counter', () => {
    const ctx = createContext('<div />');
    expect(nextCtxName(ctx)).toBe('ctx0');
    expect(ctx.contextCounter).toBe(1);
  });

  test('uses existing context counter', () => {
    const ctx = createContext('<div />');
    ctx.contextCounter = 5; // Pre-set the counter
    expect(nextCtxName(ctx)).toBe('ctx5');
    expect(ctx.contextCounter).toBe(6);
  });

  test('multiple contexts have independent counters', () => {
    const ctx1 = createContext('<div />');
    const ctx2 = createContext('<span />');

    nextCtxName(ctx1); // ctx0
    nextCtxName(ctx1); // ctx1
    expect(ctx1.contextCounter).toBe(2);

    expect(nextCtxName(ctx2)).toBe('ctx0'); // ctx2 starts at 0
    expect(ctx2.contextCounter).toBe(1);

    // ctx1 continues independently
    expect(nextCtxName(ctx1)).toBe('ctx2');
    expect(ctx1.contextCounter).toBe(3);

    // ctx2 is unchanged
    expect(ctx2.contextCounter).toBe(1);
  });
});

describe('buildValue', () => {
  let ctx: CompilerContext;

  beforeEach(() => {
    ctx = createContext('<div>test</div>');
  });

  test('builds literal string to JSExpression', () => {
    const result = buildValue(ctx, literal('hello'), 'this');
    const code = serializeJS(result);
    expect(code).toBe('"hello"');
  });

  test('builds literal number to JSExpression', () => {
    const result = buildValue(ctx, literal(42), 'this');
    const code = serializeJS(result);
    expect(code).toBe('42');
  });

  test('builds literal boolean to JSExpression', () => {
    const result = buildValue(ctx, literal(true), 'this');
    const code = serializeJS(result);
    expect(code).toBe('true');
  });

  test('builds literal null to JSExpression', () => {
    const result = buildValue(ctx, literal(null), 'this');
    const code = serializeJS(result);
    expect(code).toBe('null');
  });

  test('builds literal undefined to JSExpression', () => {
    const result = buildValue(ctx, literal(undefined), 'this');
    const code = serializeJS(result);
    expect(code).toBe('undefined');
  });

  test('builds path expression to JSExpression', () => {
    const result = buildValue(ctx, path('this.foo'), 'this');
    const code = serializeJS(result);
    expect(code).toContain('this.foo');
  });

  test('builds raw code to JSExpression', () => {
    const result = buildValue(ctx, raw('console.log()'), 'this');
    const code = serializeJS(result);
    expect(code).toBe('console.log()');
  });

  test('builds helper call to JSExpression', () => {
    const result = buildValue(ctx, helper('eq', [literal(1), literal(2)]), 'this');
    const code = serializeJS(result);
    expect(code).toContain(SYMBOLS.EQ);
    expect(code).toContain('1');
    expect(code).toContain('2');
  });

  test('result is valid JSExpression object', () => {
    const result = buildValue(ctx, literal('test'), 'this');
    expect(result).toHaveProperty('type');
    // JSExpression objects have a type property from the builder
  });

  test('buildValue is consistent with serializeValue', () => {
    const value = literal('consistency');
    const buildResult = buildValue(ctx, value, 'this');
    const serializedFromBuild = serializeJS(buildResult);
    const directSerialized = serializeValue(ctx, value, 'this');
    expect(serializedFromBuild).toBe(directSerialized);
  });
});

// ============================================================================
// Corner Case Tests
// ============================================================================

describe('Control Flow Corner Cases', () => {
  let ctx: CompilerContext;

  beforeEach(() => {
    ctx = createContext('<div />');
  });

  describe('yield', () => {
    test('yield with no params', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'yield',
        condition: literal(''),
        children: [],
        inverse: null,
        blockParams: [],
        key: null,
        isSync: true,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain(SYMBOLS.SLOT);
      expect(result).toContain('"default"');
      expect(result).toContain('$slots');
    });

    test('yield with named slot', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'yield',
        condition: literal(''),
        children: [],
        inverse: null,
        blockParams: [],
        key: 'header',
        isSync: true,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain('"header"');
    });

    test('yield with multiple block params', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'yield',
        condition: literal(''),
        children: [],
        inverse: null,
        blockParams: ['item', 'index', 'extra'],
        key: 'default',
        isSync: true,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain('item');
      expect(result).toContain('index');
      expect(result).toContain('extra');
    });
  });

  describe('each', () => {
    test('each with empty block params gets default params', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'each',
        condition: path('this.items'),
        children: ['item'],
        inverse: null,
        blockParams: [],
        key: null,
        isSync: false,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain('$noop');
      expect(result).toContain('$index');
    });

    test('each with single block param gets index added', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'each',
        condition: path('this.items'),
        children: ['item'],
        inverse: null,
        blockParams: ['item'],
        key: null,
        isSync: false,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain('item');
      expect(result).toContain('$index');
    });

    test('each with @identity key', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'each',
        condition: path('this.items'),
        children: ['item'],
        inverse: null,
        blockParams: ['item'],
        key: '@identity',
        isSync: false,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain('"@identity"');
    });

    test('each sync uses $_eachSync', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'each',
        condition: path('this.items'),
        children: ['item'],
        inverse: null,
        blockParams: ['item'],
        key: null,
        isSync: true,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain(SYMBOLS.EACH_SYNC);
    });

    test('each with null key', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'each',
        condition: path('this.items'),
        children: ['item'],
        inverse: null,
        blockParams: ['item'],
        key: null,
        isSync: false,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain('null');
    });
  });

  describe('if', () => {
    test('if with empty children', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'if',
        condition: path('this.show'),
        children: [],
        inverse: null,
        blockParams: [],
        key: null,
        isSync: false,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain(SYMBOLS.IF);
      expect(result).toContain('[]');
    });

    test('if with null inverse', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'if',
        condition: path('this.show'),
        children: ['yes'],
        inverse: null,
        blockParams: [],
        key: null,
        isSync: false,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain(SYMBOLS.IF);
    });

    test('if with both branches', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'if',
        condition: path('this.show'),
        children: ['visible'],
        inverse: ['hidden'],
        blockParams: [],
        key: null,
        isSync: false,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain('"visible"');
      expect(result).toContain('"hidden"');
    });
  });

  describe('in-element', () => {
    test('in-element with complex target', () => {
      const control: HBSControlExpression = {
        _nodeType: 'control',
        type: 'in-element',
        condition: path('this.container.element'),
        children: ['portal content'],
        inverse: null,
        blockParams: [],
        key: null,
        isSync: true,
      };

      const result = serializeControl(ctx, control, 'this');
      expect(result).toContain(SYMBOLS.IN_ELEMENT);
      expect(result).toContain('this.container');
    });
  });
});

describe('Component Slot Corner Cases', () => {
  let ctx: CompilerContext;

  beforeEach(() => {
    ctx = createContext('<div />');
    ctx.scopeTracker.addBinding('Card', { kind: 'component', name: 'Card' });
  });

  test('component with empty children', () => {
    const node: HBSNode = {
      _nodeType: 'element',
      tag: 'Card',
      attributes: [],
      properties: [],
      events: [],
      children: [],
      blockParams: [],
      selfClosing: false,
      hasStableChild: false,
    };

    const result = serializeComponent(ctx, node, 'this');
    expect(result).toContain(SYMBOLS.COMPONENT);
    expect(result).toContain('default_:');
  });

  test('component with text child', () => {
    const node: HBSNode = {
      _nodeType: 'element',
      tag: 'Card',
      attributes: [],
      properties: [],
      events: [],
      children: ['Hello World'],
      blockParams: [],
      selfClosing: false,
      hasStableChild: false,
    };

    const result = serializeComponent(ctx, node, 'this');
    expect(result).toContain('"Hello World"');
    expect(result).toContain('default:');
  });

  test('component with multiple @args', () => {
    const node: HBSNode = {
      _nodeType: 'element',
      tag: 'Card',
      attributes: [
        ['@title', literal('My Title')],
        ['@subtitle', literal('Subtitle')],
        ['@isOpen', literal(true)],
      ],
      properties: [],
      events: [],
      children: [],
      blockParams: [],
      selfClosing: true,
      hasStableChild: false,
    };

    const result = serializeComponent(ctx, node, 'this');
    expect(result).toContain('title:');
    expect(result).toContain('"My Title"');
    expect(result).toContain('subtitle:');
    expect(result).toContain('isOpen:');
    expect(result).toContain('true');
  });
});

describe('Element Edge Cases', () => {
  let ctx: CompilerContext;

  beforeEach(() => {
    ctx = createContext('<div />');
  });

  test('element with hyphenated attribute', () => {
    const node: HBSNode = {
      _nodeType: 'element',
      tag: 'div',
      attributes: [['data-test-id', literal('test123')]],
      properties: [],
      events: [],
      children: [],
      blockParams: [],
      selfClosing: false,
      hasStableChild: false,
    };

    const result = serializeElement(ctx, node, 'this');
    expect(result).toContain('"data-test-id"');
    expect(result).toContain('"test123"');
  });

  test('element with multiple events', () => {
    const node: HBSNode = {
      _nodeType: 'element',
      tag: 'button',
      attributes: [],
      properties: [],
      events: [
        ['click', raw('() => this.onClick()')],
        ['mouseenter', raw('() => this.onHover()')],
        ['focus', raw('() => this.onFocus()')],
      ],
      children: [],
      blockParams: [],
      selfClosing: false,
      hasStableChild: false,
    };

    const result = serializeElement(ctx, node, 'this');
    expect(result).toContain('"click"');
    expect(result).toContain('"mouseenter"');
    expect(result).toContain('"focus"');
  });

  test('element with textContent event', () => {
    const node: HBSNode = {
      _nodeType: 'element',
      tag: 'span',
      attributes: [],
      properties: [],
      events: [['1', literal('dynamic text')]],
      children: [],
      blockParams: [],
      selfClosing: false,
      hasStableChild: false,
    };

    const result = serializeElement(ctx, node, 'this');
    expect(result).toContain('"1"');
    expect(result).toContain('"dynamic text"');
  });

  test('element with boolean attribute', () => {
    const node: HBSNode = {
      _nodeType: 'element',
      tag: 'input',
      attributes: [['disabled', literal(true)]],
      properties: [],
      events: [],
      children: [],
      blockParams: [],
      selfClosing: true,
      hasStableChild: false,
    };

    const result = serializeElement(ctx, node, 'this');
    expect(result).toContain('"disabled"');
    expect(result).toContain('true');
  });
});

describe('Value Serialization Edge Cases', () => {
  let ctx: CompilerContext;

  beforeEach(() => {
    ctx = createContext('<div />');
  });

  test('serializes empty string', () => {
    const result = serializeValue(ctx, literal(''), 'this');
    expect(result).toBe('""');
  });

  test('serializes string with special characters', () => {
    const result = serializeValue(ctx, literal('line1\nline2\ttab'), 'this');
    expect(result).toContain('\\n');
    expect(result).toContain('\\t');
  });

  test('serializes negative number', () => {
    const result = serializeValue(ctx, literal(-42), 'this');
    expect(result).toBe('-42');
  });

  test('serializes zero', () => {
    const result = serializeValue(ctx, literal(0), 'this');
    expect(result).toBe('0');
  });

  test('serializes floating point', () => {
    const result = serializeValue(ctx, literal(3.14), 'this');
    expect(result).toBe('3.14');
  });

  test('serializes path with optional chaining', () => {
    const result = serializeValue(ctx, path('this.a.b.c'), 'this');
    expect(result).toContain('this');
  });

  test('helper with empty positional args', () => {
    const result = serializeValue(ctx, helper('log'), 'this');
    expect(result).toContain(SYMBOLS.LOG);
    expect(result).toContain('()');
  });

  test('helper with named args only', () => {
    const named = new Map<string, SerializedValue>();
    named.set('key', literal('value'));
    const result = serializeValue(ctx, helper('hash', [], named), 'this');
    expect(result).toContain('key:');
    expect(result).toContain('"value"');
  });

  test('dotted path helper with known root uses direct call', () => {
    const ctxWithBinding = createContext('', { bindings: new Set(['myObj']) });
    const result = serializeValue(
      ctxWithBinding,
      helper('myObj.method', [path('this.x', true)]),
      'this'
    );
    // Should generate a direct call: myObj.method(...)
    expect(result).toContain('myObj.method(');
    expect(result).not.toContain(SYMBOLS.MAYBE_HELPER);
  });

  test('dotted path helper with unknown root uses maybeHelper', () => {
    const result = serializeValue(
      ctx,
      helper('unknownObj.method', [literal('arg')]),
      'this'
    );
    expect(result).toContain(SYMBOLS.MAYBE_HELPER);
  });

  test('bracket notation path helper with known root uses direct call', () => {
    const ctxWithBinding = createContext('', { bindings: new Set(['global']) });
    // Simulate a helper name that includes bracket notation
    const result = serializeValue(
      ctxWithBinding,
      helper('global[prop]', [literal('arg')]),
      'this'
    );
    // Should generate a direct call since 'global' is the root binding
    expect(result).toContain('global[prop](');
    expect(result).not.toContain(SYMBOLS.MAYBE_HELPER);
  });

  test('bracket notation path helper with unknown root uses maybeHelper', () => {
    const result = serializeValue(
      ctx,
      helper('unknown[prop]', [literal('arg')]),
      'this'
    );
    expect(result).toContain(SYMBOLS.MAYBE_HELPER);
  });
});

describe('toSafeJSPath in direct call args', () => {
  test('array access path gets optional chaining in known helper positional args', () => {
    const ctxWithBinding = createContext('', { bindings: new Set(['myHelper']) });
    const result = serializeValue(
      ctxWithBinding,
      helper('myHelper', [path('this.items[0].name', false)]),
      'this'
    );
    // Should apply optional chaining after array access
    expect(result).toContain('[0]?.');
    expect(result).toContain('myHelper(');
  });

  test('simple dot path does not get optional chaining', () => {
    const ctxWithBinding = createContext('', { bindings: new Set(['myHelper']) });
    const result = serializeValue(
      ctxWithBinding,
      helper('myHelper', [path('this.name', false)]),
      'this'
    );
    expect(result).toContain('this.name');
    expect(result).not.toContain('?.');
  });

  test('multiple array accesses all get optional chaining', () => {
    const ctxWithBinding = createContext('', { bindings: new Set(['myHelper']) });
    const result = serializeValue(
      ctxWithBinding,
      helper('myHelper', [path('this.a[0].b[1].c', false)]),
      'this'
    );
    expect(result).toContain('[0]?.');
    expect(result).toContain('[1]?.');
  });

  test('array access without dot suffix is unchanged', () => {
    const ctxWithBinding = createContext('', { bindings: new Set(['myHelper']) });
    const result = serializeValue(
      ctxWithBinding,
      helper('myHelper', [path('this.items[0]', false)]),
      'this'
    );
    // No dot after [0], so no optional chaining needed
    expect(result).toContain('this.items[0]');
    expect(result).not.toContain('?.');
  });
});

describe('WITH_HELPER_MANAGER serialization behavior', () => {
  test('known binding uses maybeHelper with function reference when WITH_HELPER_MANAGER=true', () => {
    const ctx = createContext('', {
      bindings: new Set(['myHelper']),
      flags: { WITH_HELPER_MANAGER: true },
    });
    const result = serializeValue(
      ctx,
      helper('myHelper', [literal('arg')]),
      'this'
    );
    expect(result).toContain(SYMBOLS.MAYBE_HELPER);
    // Should pass function reference (identifier), not string
    expect(result).toContain('myHelper');
    expect(result).not.toContain('"myHelper"');
    // Should NOT include scope key (binding is known)
    expect(result).not.toContain(SYMBOLS.SCOPE_KEY);
  });

  test('known binding uses direct call when WITH_HELPER_MANAGER=false', () => {
    const ctx = createContext('', {
      bindings: new Set(['myHelper']),
      flags: { WITH_HELPER_MANAGER: false },
    });
    const result = serializeValue(
      ctx,
      helper('myHelper', [literal('arg')]),
      'this'
    );
    expect(result).toContain('myHelper(');
    expect(result).not.toContain(SYMBOLS.MAYBE_HELPER);
  });

  test('unknown binding always uses maybeHelper with string name and scope key', () => {
    const ctx = createContext('', {
      flags: { WITH_HELPER_MANAGER: false },
    });
    const result = serializeValue(
      ctx,
      helper('unknownHelper', [literal('arg')]),
      'this'
    );
    expect(result).toContain(SYMBOLS.MAYBE_HELPER);
    expect(result).toContain('"unknownHelper"');
    expect(result).toContain(SYMBOLS.SCOPE_KEY);
  });

  test('@arg helper with WITH_HELPER_MANAGER=true uses maybeHelper with resolved ref', () => {
    const ctx = createContext('', {
      flags: { WITH_HELPER_MANAGER: true },
    });
    const result = serializeValue(
      ctx,
      helper('@myHelper', [literal('arg')]),
      'this'
    );
    expect(result).toContain(SYMBOLS.MAYBE_HELPER);
    // Should resolve @myHelper to this[$args].myHelper
    expect(result).toContain('$args');
    expect(result).toContain('myHelper');
    // Should NOT have scope key
    expect(result).not.toContain(SYMBOLS.SCOPE_KEY);
  });

  test('builtin helper is not affected by WITH_HELPER_MANAGER', () => {
    const ctx = createContext('', {
      flags: { WITH_HELPER_MANAGER: true },
    });
    const result = serializeValue(
      ctx,
      helper('if', [path('this.cond', false), literal('yes'), literal('no')]),
      'this'
    );
    // Should use builtin symbol, not maybeHelper
    expect(result).toContain(SYMBOLS.IF_HELPER);
    expect(result).not.toContain(SYMBOLS.MAYBE_HELPER);
  });

  test('local binding shadows builtin with WITH_HELPER_MANAGER=true', () => {
    const ctx = createContext('', {
      bindings: new Set(['if']),
      flags: { WITH_HELPER_MANAGER: true },
    });
    const result = serializeValue(
      ctx,
      helper('if', [literal('a'), literal('b')]),
      'this'
    );
    // Local 'if' shadows builtin
    expect(result).not.toContain(SYMBOLS.IF_HELPER);
    // Should use maybeHelper with function reference
    expect(result).toContain(SYMBOLS.MAYBE_HELPER);
  });

  test('local binding shadows builtin with WITH_HELPER_MANAGER=false', () => {
    const ctx = createContext('', {
      bindings: new Set(['or']),
      flags: { WITH_HELPER_MANAGER: false },
    });
    const result = serializeValue(
      ctx,
      helper('or', [literal('a'), literal('b')]),
      'this'
    );
    // Local 'or' shadows builtin
    expect(result).not.toContain(SYMBOLS.OR);
    // Should use direct call (not maybeHelper)
    expect(result).toContain('or(');
    expect(result).not.toContain(SYMBOLS.MAYBE_HELPER);
  });

  test('known binding with named args uses maybeHelper when WITH_HELPER_MANAGER=true', () => {
    const ctx = createContext('', {
      bindings: new Set(['myHelper']),
      flags: { WITH_HELPER_MANAGER: true },
    });
    const named = new Map<string, SerializedValue>([['key', literal('val')]]);
    const result = serializeValue(
      ctx,
      helper('myHelper', [], named),
      'this'
    );
    expect(result).toContain(SYMBOLS.MAYBE_HELPER);
    // Should include named args in the hash object
    expect(result).toContain('key');
  });

  test('known binding with named args uses direct call when WITH_HELPER_MANAGER=false', () => {
    const ctx = createContext('', {
      bindings: new Set(['myHelper']),
      flags: { WITH_HELPER_MANAGER: false },
    });
    const named = new Map<string, SerializedValue>([['key', literal('val')]]);
    const result = serializeValue(
      ctx,
      helper('myHelper', [], named),
      'this'
    );
    expect(result).toContain('myHelper(');
    expect(result).not.toContain(SYMBOLS.MAYBE_HELPER);
    expect(result).toContain('key');
  });
});

describe('RuntimeTag Serialization', () => {
  let ctx: CompilerContext;

  beforeEach(() => {
    ctx = createContext('<div />');
  });

  test('serializeComponent handles RuntimeTag correctly', () => {
    const node: HBSNode = {
      _nodeType: 'element',
      tag: runtimeTag('$_SVGProvider'),
      attributes: [],
      properties: [],
      events: [],
      children: [],
      blockParams: [],
      selfClosing: true,
      hasStableChild: false,
    };

    const result = serializeComponent(ctx, node, 'this');
    // Should generate $_c($_SVGProvider, ...) not $_c('$_SVGProvider', ...)
    expect(result).toContain('$_c($_SVGProvider');
    expect(result).not.toContain("'$_SVGProvider'");
  });

  test('serializeComponent handles RuntimeTag with children', () => {
    const node: HBSNode = {
      _nodeType: 'element',
      tag: runtimeTag('$_SVGProvider'),
      attributes: [],
      properties: [],
      events: [],
      children: ['text content'],
      blockParams: [],
      selfClosing: false,
      hasStableChild: false,
    };

    const result = serializeComponent(ctx, node, 'this');
    expect(result).toContain('$_c($_SVGProvider');
    expect(result).toContain('"text content"');
  });

  test('serializeComponent handles RuntimeTag with @args', () => {
    const node: HBSNode = {
      _nodeType: 'element',
      tag: runtimeTag('$_MathMLProvider'),
      attributes: [['@value', literal('test')]],
      properties: [],
      events: [],
      children: [],
      blockParams: [],
      selfClosing: true,
      hasStableChild: false,
    };

    const result = serializeComponent(ctx, node, 'this');
    expect(result).toContain('$_c($_MathMLProvider');
    expect(result).toContain('value:');
    expect(result).toContain('"test"');
  });

  test('serializeElement throws for RuntimeTag (defensive)', () => {
    const node: HBSNode = {
      _nodeType: 'element',
      tag: runtimeTag('$_SVGProvider'),
      attributes: [],
      properties: [],
      events: [],
      children: [],
      blockParams: [],
      selfClosing: true,
      hasStableChild: false,
    };

    // serializeElement should throw since RuntimeTag should be handled as component
    expect(() => serializeElement(ctx, node, 'this')).toThrow(
      'RuntimeTag "$_SVGProvider" should not reach buildElement'
    );
  });

  test('serialize routes RuntimeTag to component serializer', () => {
    const node: HBSNode = {
      _nodeType: 'element',
      tag: runtimeTag('$_HTMLProvider'),
      attributes: [],
      properties: [],
      events: [],
      children: [],
      blockParams: [],
      selfClosing: true,
      hasStableChild: false,
    };

    // The high-level serialize function should route RuntimeTag to serializeComponent
    const result = serialize(ctx, node, 'this');
    expect(result).toContain('$_c($_HTMLProvider');
  });
});
