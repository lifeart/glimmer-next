import { expect, test, describe, beforeEach, vi, afterEach } from 'vitest';
import {
  toSafeJSPath,
  escapeString,
  toOptionalChaining,
  isPath,
  serializeAttribute,
  resolvedChildren,
  nextCtxName,
  resetContextCounter,
  setFlags,
  SerializationContext,
  setSerializationContext,
  getSerializationContext,
  setBindings,
  warnOnReservedBinding,
  checkBindingsForCollisions,
  resolvePath,
  serializePath,
  serializeChildren,
  serializeNode,
  toObject,
  type HBSNode,
  type HBSControlExpression,
} from './utils';
import { defaultFlags } from './flags';
import type { ASTv1 } from '@glimmer/syntax';
import { SYMBOLS } from './symbols';

const f = (str: string) => toSafeJSPath(str);
const e = (str: any) => escapeString(str as string);

describe('escapeString', () => {
  test('works for classic case', () => {
    expect(e('this.foo.bar.baz')).toEqual(`"this.foo.bar.baz"`);
  });
  test('works for string with quotes', () => {
    expect(e('this.foo.bar.baz"')).toEqual(`"this.foo.bar.baz\\""`);
  });
  test('works for string with double quotes', () => {
    expect(e('"this.foo.bar.baz"')).toEqual(`"this.foo.bar.baz"`);
  });
  test('works for string with double quotes #2', () => {
    expect(e('this.foo.bar"baz')).toEqual(`"this.foo.bar\\"baz"`);
  });
  test('works for strings with template literals', () => {
    expect(e('this.foo.bar`baz`')).toEqual(`"this.foo.bar\`baz\`"`);
  });
  test('works for strings like numbers', () => {
    expect(e('123')).toEqual(`"123"`);
  });
  test('works for strings like numbers #2', () => {
    expect(e('123.123')).toEqual(`"123.123"`);
  });
  test('works for strings like numbers #3', () => {
    expect(e('123.123.123')).toEqual(`"123.123.123"`);
  });
  test('throw error if input is not a string', () => {
    expect(() => e(123)).toThrow('Not a string');
  });
  test('skip already escaped strings', () => {
    expect(e('"this.foo.bar.baz"')).toEqual(`"this.foo.bar.baz"`);
  });
});

describe('toSafeJSPath', () => {
  test('works for classic case', () => {
    expect(f('this.foo.bar.baz')).toEqual(`this.foo.bar.baz`);
  });
  test('works for args case', () => {
    expect(f('this[args].foo.bar.baz')).toEqual(`this[args].foo.bar.baz`);
  });
  test('works for bare args case', () => {
    expect(f('@foo.bar.baz')).toEqual(`@foo.bar.baz`);
  });
  test('works for expected case', () => {
    expect(f('this[args].foo-bar')).toEqual(`this[args]["foo-bar"]`);
  });
  test('works for expected case with optional-chaining', () => {
    expect(f('this[args].foo-bar?.baz')).toEqual(`this[args]["foo-bar"]?.baz`);
  });
  test('works for expected case with optional-chaining #2', () => {
    expect(f('this[args]?.foo-bar?.baz')).toEqual(`this[args]["foo-bar"]?.baz`);
  });

  test('works with array access notation', () => {
    expect(f('this[args][0].foo')).toEqual(`this[args][0].foo`);
  });

  test('preserves function calls', () => {
    expect(f('this.foo(bar).baz')).toEqual(`this.foo(bar).baz`);
  });

  test('returns simple paths unchanged', () => {
    expect(f('foo')).toEqual('foo');
  });
});

describe('toOptionalChaining', () => {
  test('returns non-string values unchanged', () => {
    expect(toOptionalChaining(null)).toEqual(null);
    expect(toOptionalChaining(undefined)).toEqual(undefined);
    expect(toOptionalChaining(123 as unknown as string)).toEqual(123);
  });

  test('returns strings with quotes unchanged', () => {
    expect(toOptionalChaining("'foo.bar.baz'")).toEqual("'foo.bar.baz'");
    expect(toOptionalChaining('"foo.bar.baz"')).toEqual('"foo.bar.baz"');
  });

  test('returns strings with $_ unchanged', () => {
    expect(toOptionalChaining('$_tag.foo.bar')).toEqual('$_tag.foo.bar');
  });

  test('returns strings with existing optional chaining unchanged', () => {
    expect(toOptionalChaining('foo?.bar?.baz')).toEqual('foo?.bar?.baz');
  });

  test('returns short paths unchanged', () => {
    expect(toOptionalChaining('foo.bar')).toEqual('foo.bar');
    expect(toOptionalChaining('foo')).toEqual('foo');
  });

  test('converts long paths to optional chaining', () => {
    expect(toOptionalChaining('foo.bar.baz')).toEqual('foo?.bar?.baz');
    expect(toOptionalChaining('foo.bar.baz.qux')).toEqual('foo?.bar?.baz?.qux');
  });

  test('fixes this?.  to this.', () => {
    expect(toOptionalChaining('this.foo.bar.baz')).toEqual('this.foo?.bar?.baz');
  });

  test('preserves spread operator', () => {
    expect(toOptionalChaining('...foo.bar.baz')).toEqual('...foo?.bar?.baz');
  });
});

describe('isPath', () => {
  test('returns true for paths starting with $:', () => {
    expect(isPath('$:foo')).toBe(true);
    expect(isPath('$:this.foo.bar')).toBe(true);
    expect(isPath('$:() => foo')).toBe(true);
  });

  test('returns false for non-paths', () => {
    expect(isPath('foo')).toBe(false);
    expect(isPath('this.foo')).toBe(false);
    expect(isPath('"string"')).toBe(false);
  });
});

describe('serializeAttribute', () => {
  beforeEach(() => {
    setFlags(defaultFlags());
  });

  test('serializes boolean values', () => {
    expect(serializeAttribute('disabled', true)).toEqual("['disabled', true]");
    expect(serializeAttribute('disabled', false)).toEqual("['disabled', false]");
  });

  test('serializes number values', () => {
    expect(serializeAttribute('tabindex', 0)).toEqual("['tabindex', 0]");
    expect(serializeAttribute('max', 100)).toEqual("['max', 100]");
  });

  test('serializes null values', () => {
    expect(serializeAttribute('data-value', null)).toEqual("['data-value', null]");
  });

  test('serializes undefined values', () => {
    expect(serializeAttribute('data-value', undefined)).toEqual("['data-value', undefined]");
  });

  test('serializes string values', () => {
    expect(serializeAttribute('class', 'foo')).toEqual(`['class', "foo"]`);
    expect(serializeAttribute('id', 'my-id')).toEqual(`['id', "my-id"]`);
  });

  test('serializes path values', () => {
    expect(serializeAttribute('class', '$:this.className')).toContain('this.className');
  });
});

describe('resolvedChildren', () => {
  test('filters out comment statements', () => {
    const children = [
      { type: 'CommentStatement', value: 'comment' },
      { type: 'TextNode', chars: 'hello' },
    ] as unknown as ASTv1.Node[];
    expect(resolvedChildren(children)).toHaveLength(1);
    expect((resolvedChildren(children)[0] as ASTv1.TextNode).chars).toEqual('hello');
  });

  test('filters out mustache comment statements', () => {
    const children = [
      { type: 'MustacheCommentStatement', value: 'comment' },
      { type: 'TextNode', chars: 'hello' },
    ] as unknown as ASTv1.Node[];
    expect(resolvedChildren(children)).toHaveLength(1);
  });

  test('filters out empty multiline text nodes', () => {
    const children = [
      { type: 'TextNode', chars: '   \n   ' },
      { type: 'TextNode', chars: 'hello' },
    ] as unknown as ASTv1.Node[];
    expect(resolvedChildren(children)).toHaveLength(1);
    expect((resolvedChildren(children)[0] as ASTv1.TextNode).chars).toEqual('hello');
  });

  test('keeps non-empty text nodes', () => {
    const children = [
      { type: 'TextNode', chars: ' foo ' },
    ] as unknown as ASTv1.Node[];
    expect(resolvedChildren(children)).toHaveLength(1);
  });

  test('keeps element nodes', () => {
    const children = [
      { type: 'ElementNode', tag: 'div' },
      { type: 'ElementNode', tag: 'span' },
    ] as unknown as ASTv1.Node[];
    expect(resolvedChildren(children)).toHaveLength(2);
  });
});

describe('nextCtxName and resetContextCounter', () => {
  beforeEach(() => {
    resetContextCounter();
  });

  test('generates sequential context names', () => {
    expect(nextCtxName()).toEqual('ctx0');
    expect(nextCtxName()).toEqual('ctx1');
    expect(nextCtxName()).toEqual('ctx2');
  });

  test('resets counter correctly', () => {
    nextCtxName();
    nextCtxName();
    resetContextCounter();
    expect(nextCtxName()).toEqual('ctx0');
  });
});

describe('SerializationContext', () => {
  test('constructor initializes with default values', () => {
    const ctx = new SerializationContext();
    expect(ctx.position).toBe(0);
    expect(ctx.getCode()).toBe('');
  });

  test('constructor accepts original source length', () => {
    const ctx = new SerializationContext(100);
    expect(ctx.position).toBe(0);
  });

  test('emit adds text and updates position', () => {
    const ctx = new SerializationContext();
    ctx.emit('hello');
    expect(ctx.getCode()).toBe('hello');
    expect(ctx.position).toBe(5);

    ctx.emit(' world');
    expect(ctx.getCode()).toBe('hello world');
    expect(ctx.position).toBe(11);
  });

  test('position setter works correctly', () => {
    const ctx = new SerializationContext();
    ctx.position = 10;
    expect(ctx.position).toBe(10);
  });

  test('advancePosition updates position without emitting', () => {
    const ctx = new SerializationContext();
    ctx.advancePosition(5);
    expect(ctx.position).toBe(5);
    expect(ctx.getCode()).toBe('');
  });

  test('emitMapped creates mapping for valid range', () => {
    const ctx = new SerializationContext(100);
    ctx.emitMapped('text', { start: 0, end: 10 }, 'MustacheStatement');
    expect(ctx.getCode()).toBe('text');

    const tree = ctx.getMappingTree();
    expect(tree.children.length).toBe(1);
    expect(tree.children[0].sourceNode).toBe('MustacheStatement');
  });

  test('emitMapped skips mapping for undefined range', () => {
    const ctx = new SerializationContext(100);
    ctx.emitMapped('text', undefined, 'MustacheStatement');
    expect(ctx.getCode()).toBe('text');

    const tree = ctx.getMappingTree();
    expect(tree.children.length).toBe(0);
  });

  test('emitMapped skips mapping for zero-width range', () => {
    const ctx = new SerializationContext(100);
    ctx.emitMapped('text', { start: 5, end: 5 }, 'MustacheStatement');
    expect(ctx.getCode()).toBe('text');

    const tree = ctx.getMappingTree();
    expect(tree.children.length).toBe(0);
  });

  test('pushScope and popScope manage mapping stack', () => {
    const ctx = new SerializationContext(100);
    ctx.pushScope({ start: 0, end: 50 }, 'BlockStatement');
    ctx.emit('content');
    ctx.popScope();

    const tree = ctx.getMappingTree();
    expect(tree.children.length).toBe(1);
    expect(tree.children[0].sourceNode).toBe('BlockStatement');
  });

  test('pushScope handles undefined range', () => {
    const ctx = new SerializationContext(100);
    ctx.pushScope(undefined, 'BlockStatement');
    ctx.emit('content');
    ctx.popScope();

    const tree = ctx.getMappingTree();
    expect(tree.children.length).toBe(1);
  });

  test('popScope does nothing when only root is on stack', () => {
    const ctx = new SerializationContext(100);
    ctx.popScope(); // Should not throw
    expect(ctx.getMappingTree()).toBeDefined();
  });

  test('getMappingTree updates root transformed range', () => {
    const ctx = new SerializationContext(100);
    ctx.emit('hello world');

    const tree = ctx.getMappingTree();
    expect(tree.transformedRange.end).toBe(11);
  });
});

describe('setSerializationContext and getSerializationContext', () => {
  afterEach(() => {
    setSerializationContext(null);
  });

  test('can set and get serialization context', () => {
    const ctx = new SerializationContext();
    setSerializationContext(ctx);
    expect(getSerializationContext()).toBe(ctx);
  });

  test('can set context to null', () => {
    const ctx = new SerializationContext();
    setSerializationContext(ctx);
    setSerializationContext(null);
    expect(getSerializationContext()).toBeNull();
  });

  test('returns null when not set', () => {
    expect(getSerializationContext()).toBeNull();
  });
});

describe('setBindings', () => {
  beforeEach(() => {
    setBindings(new Set());
  });

  test('can set bindings', () => {
    const bindings = new Set(['foo', 'bar']);
    setBindings(bindings);
    // Verify through resolvePath behavior
    expect(resolvePath('foo')).toBe('foo');
  });
});

describe('warnOnReservedBinding', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let consoleWarnSpy: any;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Reset the warnedBindings set by testing with unique names each time
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  test('warns about JS global shadowing', () => {
    warnOnReservedBinding('String');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('shadows a JavaScript global')
    );
  });

  test('warns about element tag names', () => {
    warnOnReservedBinding('div');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('matches an HTML/SVG element name')
    );
  });

  test('does not warn for regular names', () => {
    warnOnReservedBinding('myComponent');
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  test('includes context in warning message', () => {
    warnOnReservedBinding('Math', 'component template');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('in component template')
    );
  });

  test('does not warn twice for the same binding', () => {
    warnOnReservedBinding('Array');
    warnOnReservedBinding('Array');
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('checkBindingsForCollisions', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let consoleWarnSpy: any;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  test('checks all bindings for collisions', () => {
    // Use unique names that haven't been warned about
    const bindings = new Set(['Object', 'Function']);
    checkBindingsForCollisions(bindings, 'test context');
    expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
  });
});

describe('resolvePath', () => {
  beforeEach(() => {
    setFlags(defaultFlags());
    setBindings(new Set());
  });

  test('returns binding name if it exists in bindings', () => {
    setBindings(new Set(['myBinding']));
    expect(resolvePath('myBinding')).toBe('myBinding');
  });

  test('resolves has-block-params helper', () => {
    const result = resolvePath('has-block-params');
    expect(result).toContain(SYMBOLS.$_hasBlockParams);
    expect(result).toContain('$slots');
  });

  test('resolves has-block helper', () => {
    const result = resolvePath('has-block');
    expect(result).toContain(SYMBOLS.$_hasBlock);
    expect(result).toContain('$slots');
  });

  test('resolves component helper', () => {
    expect(resolvePath('component')).toBe(SYMBOLS.COMPONENT_HELPER);
  });

  test('resolves helper helper', () => {
    expect(resolvePath('helper')).toBe(SYMBOLS.HELPER_HELPER);
  });

  test('resolves modifier helper', () => {
    expect(resolvePath('modifier')).toBe(SYMBOLS.MODIFIER_HELPER);
  });

  test('resolves path with $: prefix', () => {
    const result = resolvePath('$:this.foo.bar');
    expect(result).toContain('this');
  });

  test('resolves @ args', () => {
    const result = resolvePath('@myArg');
    expect(result).toContain(SYMBOLS.$args);
  });
});

describe('serializePath', () => {
  beforeEach(() => {
    setFlags(defaultFlags());
    setBindings(new Set());
    setSerializationContext(null);
    resetContextCounter();
  });

  test('returns non-string values as-is', () => {
    // serializePath accepts boolean, so these are valid calls
    expect(serializePath(true)).toBe(true);
    expect(serializePath(false)).toBe(false);
  });

  test('returns splat attrs paths unchanged', () => {
    expect(serializePath('...foo')).toBe('...foo');
  });

  test('wraps path in getter when IS_GLIMMER_COMPAT_MODE is true', () => {
    const result = serializePath('$:this.foo');
    expect(result).toContain('() =>');
  });

  test('does not wrap path when IS_GLIMMER_COMPAT_MODE is false', () => {
    setFlags({ ...defaultFlags(), IS_GLIMMER_COMPAT_MODE: false });
    const result = serializePath('$:this.foo', false);
    expect(result).not.toContain('() =>');
  });

  test('does not wrap function expressions', () => {
    const result = serializePath('$:(x) => x + 1');
    expect(result).not.toMatch(/^\(\) =>/);
  });

  test('does not wrap spread function expressions', () => {
    const result = serializePath('$:...(() => foo)');
    expect(result).not.toMatch(/^\(\) =>/);
  });

  test('does not wrap function keyword expressions', () => {
    const result = serializePath('$:function() { return 1; }');
    expect(result).not.toMatch(/^\(\) =>/);
  });

  test('tracks source mapping when context is available', () => {
    const ctx = new SerializationContext(100);
    setSerializationContext(ctx);
    serializePath('$:count', true, { start: 0, end: 5 });
    // Mapping should be created with a child node for the path
    const tree = ctx.getMappingTree();
    expect(tree.children.length).toBeGreaterThan(0);
    expect(tree.children[0].sourceNode).toContain('PathExpression');
  });
});

describe('serializeChildren', () => {
  beforeEach(() => {
    setFlags(defaultFlags());
    setBindings(new Set());
    setSerializationContext(null);
    resetContextCounter();
  });

  test('returns empty string for empty array', () => {
    expect(serializeChildren([], 'ctx')).toBe('');
  });

  test('serializes string children', () => {
    const result = serializeChildren(['hello', 'world'], 'ctx');
    expect(result).toContain('"hello"');
    expect(result).toContain('"world"');
  });

  test('serializes path children', () => {
    const result = serializeChildren(['$:this.foo'], 'ctx');
    expect(result).toContain('this.foo');
  });

  test('serializes node children', () => {
    const node: HBSNode = {
      tag: 'div',
      attributes: [],
      properties: [],
      selfClosing: false,
      hasStableChild: false,
      blockParams: [],
      events: [],
      children: [],
    };
    const result = serializeChildren([node], 'ctx');
    expect(result).toContain(SYMBOLS.TAG);
    expect(result).toContain('div');
  });
});

describe('serializeNode', () => {
  beforeEach(() => {
    setFlags(defaultFlags());
    setBindings(new Set());
    setSerializationContext(null);
    resetContextCounter();
  });

  test('returns null for null input', () => {
    expect(serializeNode(null)).toBeNull();
  });

  test('serializes string nodes', () => {
    const result = serializeNode('hello');
    expect(result).toBe('"hello"');
  });

  test('serializes number nodes', () => {
    // serializeNode accepts number via ComplexJSType
    const result = serializeNode(123);
    expect(result).toBe('"123"');
  });

  test('serializes path strings', () => {
    const result = serializeNode('$:this.foo');
    expect(result).toContain('this.foo');
  });

  test('throws for unknown node types', () => {
    expect(() => {
      serializeNode({ unknownField: true } as any);
    }).toThrow('Unknown node type');
  });

  describe('element nodes', () => {
    test('serializes simple element node', () => {
      const node: HBSNode = {
        tag: 'div',
        attributes: [],
        properties: [],
        selfClosing: false,
        hasStableChild: false,
        blockParams: [],
        events: [],
        children: [],
      };
      const result = serializeNode(node);
      expect(result).toContain(SYMBOLS.TAG);
      expect(result).toContain("'div'");
    });

    test('serializes element with splat attributes', () => {
      const node: HBSNode = {
        tag: 'div',
        attributes: [['...attributes', '']],
        properties: [],
        selfClosing: false,
        hasStableChild: false,
        blockParams: [],
        events: [],
        children: [],
      };
      const result = serializeNode(node);
      expect(result).toContain('$fw');
    });

    test('serializes element with children', () => {
      const node: HBSNode = {
        tag: 'div',
        attributes: [],
        properties: [],
        selfClosing: false,
        hasStableChild: false,
        blockParams: [],
        events: [],
        children: ['hello'],
      };
      const result = serializeNode(node);
      expect(result).toContain('"hello"');
    });
  });

  describe('component nodes', () => {
    beforeEach(() => {
      setBindings(new Set(['MyComponent', 'Nested']));
    });

    test('serializes self-closing component', () => {
      const node: HBSNode = {
        tag: 'MyComponent',
        attributes: [],
        properties: [],
        selfClosing: true,
        hasStableChild: false,
        blockParams: [],
        events: [],
        children: [],
      };
      const result = serializeNode(node);
      expect(result).toContain(SYMBOLS.COMPONENT);
      expect(result).toContain('MyComponent');
    });

    test('serializes component with args', () => {
      const node: HBSNode = {
        tag: 'MyComponent',
        attributes: [['@name', 'test']],
        properties: [],
        selfClosing: true,
        hasStableChild: false,
        blockParams: [],
        events: [],
        children: [],
      };
      const result = serializeNode(node);
      expect(result).toContain('name');
    });

    test('serializes component with splat attrs', () => {
      const node: HBSNode = {
        tag: 'MyComponent',
        attributes: [['...attributes', '']],
        properties: [],
        selfClosing: true,
        hasStableChild: false,
        blockParams: [],
        events: [],
        children: [],
      };
      const result = serializeNode(node);
      expect(result).toContain('$fw');
    });

    test('serializes component with block children (default slot)', () => {
      const node: HBSNode = {
        tag: 'MyComponent',
        attributes: [],
        properties: [],
        selfClosing: false,
        hasStableChild: false,
        blockParams: [],
        events: [],
        children: ['content'],
      };
      const result = serializeNode(node);
      expect(result).toContain('default');
    });

    test('serializes component with named slots', () => {
      const slotNode: HBSNode = {
        tag: ':header',
        attributes: [],
        properties: [],
        selfClosing: false,
        hasStableChild: false,
        blockParams: [],
        events: [],
        children: ['Header content'],
      };
      const node: HBSNode = {
        tag: 'MyComponent',
        attributes: [],
        properties: [],
        selfClosing: false,
        hasStableChild: false,
        blockParams: [],
        events: [],
        children: [slotNode],
      };
      const result = serializeNode(node);
      expect(result).toContain('header:');
    });

    test('serializes component with blockParams in slot', () => {
      const slotNode: HBSNode = {
        tag: ':body',
        attributes: [],
        properties: [],
        selfClosing: false,
        hasStableChild: false,
        blockParams: ['item', 'index'],
        events: [],
        children: ['Body content'],
      };
      const node: HBSNode = {
        tag: 'MyComponent',
        attributes: [],
        properties: [],
        selfClosing: false,
        hasStableChild: false,
        blockParams: [],
        events: [],
        children: [slotNode],
      };
      const result = serializeNode(node);
      expect(result).toContain('body_: true');
      expect(result).toContain('item');
      expect(result).toContain('index');
    });

    test('serializes dynamic component (dotted path)', () => {
      const node: HBSNode = {
        tag: 'Nested.Component',
        attributes: [],
        properties: [],
        selfClosing: true,
        hasStableChild: false,
        blockParams: [],
        events: [],
        children: [],
      };
      const result = serializeNode(node);
      expect(result).toContain(SYMBOLS.DYNAMIC_COMPONENT);
    });

    test('serializes component starting with $_', () => {
      const node: HBSNode = {
        tag: '$:$_componentRef',
        attributes: [],
        properties: [],
        selfClosing: true,
        hasStableChild: false,
        blockParams: [],
        events: [],
        children: [],
      };
      const result = serializeNode(node);
      // Tags starting with $:$_ without dots use regular component
      expect(result).toContain(SYMBOLS.COMPONENT);
      expect(result).toContain('$_componentRef');
    });
  });

  describe('control nodes', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let consoleWarnSpy: any;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    test('serializes yield control', () => {
      const node: HBSControlExpression = {
        type: 'yield',
        isControl: true,
        condition: '',
        blockParams: ['value'],
        children: [],
        inverse: null,
        key: 'default',
        isSync: false,
      };
      const result = serializeNode(node);
      expect(result).toContain(SYMBOLS.SLOT);
    });

    test('serializes in-element control', () => {
      const node: HBSControlExpression = {
        type: 'in-element',
        isControl: true,
        condition: '$:this.targetElement',
        blockParams: [],
        children: ['content'],
        inverse: null,
        key: null,
        isSync: false,
      };
      const result = serializeNode(node);
      expect(result).toContain(SYMBOLS.$_inElement);
    });

    test('serializes each control', () => {
      const node: HBSControlExpression = {
        type: 'each',
        isControl: true,
        condition: '$:this.items',
        blockParams: ['item'],
        children: ['content'],
        inverse: null,
        key: '@identity',
        isSync: false,
      };
      const result = serializeNode(node);
      expect(result).toContain(SYMBOLS.EACH);
    });

    test('serializes each control with sync flag', () => {
      const node: HBSControlExpression = {
        type: 'each',
        isControl: true,
        condition: '$:this.items',
        blockParams: ['item'],
        children: ['content'],
        inverse: null,
        key: '@identity',
        isSync: true,
      };
      const result = serializeNode(node);
      expect(result).toContain(SYMBOLS.EACH_SYNC);
    });

    test('serializes each control with @index key (warns and uses @identity)', () => {
      const node: HBSControlExpression = {
        type: 'each',
        isControl: true,
        condition: '$:this.items',
        blockParams: ['item'],
        children: ['content'],
        inverse: null,
        key: '@index',
        isSync: false,
      };
      serializeNode(node);
      expect(consoleWarnSpy).toHaveBeenCalledWith('@index identity not supported');
    });

    test('serializes each control without blockParams (adds dummy params)', () => {
      const node: HBSControlExpression = {
        type: 'each',
        isControl: true,
        condition: '$:this.items',
        blockParams: [],
        children: ['content'],
        inverse: null,
        key: null,
        isSync: false,
      };
      const result = serializeNode(node);
      expect(result).toContain('$noop');
      expect(result).toContain('$index');
    });

    test('serializes each with stable child', () => {
      setBindings(new Set(['ChildComponent']));
      const childNode: HBSNode = {
        tag: 'ChildComponent',
        attributes: [],
        properties: [],
        selfClosing: true,
        hasStableChild: false,
        blockParams: [],
        events: [],
        children: [],
      };
      const node: HBSControlExpression = {
        type: 'each',
        isControl: true,
        condition: '$:this.items',
        blockParams: ['item', 'index'],
        children: [childNode],
        inverse: null,
        key: null,
        isSync: false,
      };
      const result = serializeNode(node);
      // Should not have $_ucw wrapper since child is stable
      expect(result).not.toContain(SYMBOLS.$_ucw);
    });

    test('serializes if control', () => {
      const node: HBSControlExpression = {
        type: 'if',
        isControl: true,
        condition: '$:this.condition',
        blockParams: [],
        children: ['true branch'],
        inverse: ['false branch'],
        key: null,
        isSync: false,
      };
      const result = serializeNode(node);
      expect(result).toContain(SYMBOLS.IF);
      expect(result).toContain('"true branch"');
      expect(result).toContain('"false branch"');
    });

    test('serializes if control without inverse', () => {
      const node: HBSControlExpression = {
        type: 'if',
        isControl: true,
        condition: '$:this.condition',
        blockParams: [],
        children: ['true branch'],
        inverse: null,
        key: null,
        isSync: false,
      };
      const result = serializeNode(node);
      expect(result).toContain(SYMBOLS.IF);
    });
  });

  describe('with serialization context', () => {
    test('tracks node scope for element nodes with location', () => {
      const ctx = new SerializationContext(100);
      setSerializationContext(ctx);

      const node: HBSNode = {
        tag: 'div',
        attributes: [],
        properties: [],
        selfClosing: false,
        hasStableChild: false,
        blockParams: [],
        events: [],
        children: [],
        loc: { start: 0, end: 10 },
      };
      serializeNode(node);

      const tree = ctx.getMappingTree();
      expect(tree.children.length).toBeGreaterThan(0);
    });

    test('tracks node scope for control nodes with location', () => {
      const ctx = new SerializationContext(100);
      setSerializationContext(ctx);

      const node: HBSControlExpression = {
        type: 'if',
        isControl: true,
        condition: 'true',
        blockParams: [],
        children: [],
        inverse: null,
        key: null,
        isSync: false,
        loc: { start: 0, end: 20 },
      };
      serializeNode(node);

      const tree = ctx.getMappingTree();
      expect(tree.children.length).toBeGreaterThan(0);
    });
  });
});

describe('toObject', () => {
  beforeEach(() => {
    setFlags(defaultFlags());
    setBindings(new Set());
  });

  test('creates empty object for empty array', () => {
    expect(toObject([])).toBe('{}');
  });

  test('serializes properties with various types', () => {
    const result = toObject([
      ['name', 'test'],
      ['count', 42],
      ['active', true],
      ['data', null],
      ['value', undefined],
    ]);
    expect(result).toContain('name: "test"');
    expect(result).toContain('count: 42');
    expect(result).toContain('active: true');
    expect(result).toContain('data: null');
    expect(result).toContain('value: undefined');
  });

  test('serializes path values', () => {
    const result = toObject([['value', '$:this.foo']]);
    expect(result).toContain('value:');
    expect(result).toContain('this.foo');
  });

  test('handles @ prefixed keys', () => {
    const result = toObject([['@name', 'test']]);
    expect(result).toContain('name: "test"');
  });

  test('handles unsafe keys', () => {
    const result = toObject([['foo-bar', 'test']]);
    expect(result).toContain('"foo-bar": "test"');
  });
});

describe('setFlags', () => {
  test('can set flags', () => {
    const customFlags = { ...defaultFlags(), IS_GLIMMER_COMPAT_MODE: false };
    setFlags(customFlags);
    // Verify through serializePath behavior
    const result = serializePath('$:this.foo', false);
    expect(result).not.toContain('() =>');
  });
});

describe('toOptionalChaining with args symbol', () => {
  test('fixes args optional chaining', () => {
    // Testing the specific case with the $args symbol
    const input = `this[${SYMBOLS.$args}].foo.bar`;
    const result = toOptionalChaining(input);
    expect(result).toContain(`this[${SYMBOLS.$args}].`);
    expect(result).not.toContain(`this[${SYMBOLS.$args}]?.`);
  });
});

describe('toSafeJSPath edge cases', () => {
  test('handles first element in reduce (acc.length = 0)', () => {
    // Single element path should return element directly
    const result = toSafeJSPath('foo');
    expect(result).toBe('foo');
  });

  test('handles unsafe key as first element', () => {
    // Key with dash needs to be bracketed
    const result = toSafeJSPath('foo-bar.baz');
    expect(result).toBe('["foo-bar"].baz');
  });

  test('handles bracket notation', () => {
    // toSafeJSPath removes the ? from optional chaining
    const result = toSafeJSPath('foo[0]?.bar');
    expect(result).toBe('foo[0].bar');
  });
});

describe('serializeNode additional coverage', () => {
  beforeEach(() => {
    setFlags(defaultFlags());
    setBindings(new Set());
    setSerializationContext(null);
    resetContextCounter();
  });

  test('serializeNode with null and serialization context', () => {
    const ctx = new SerializationContext(100);
    setSerializationContext(ctx);
    const result = serializeNode(null);
    expect(result).toBeNull();
  });

  describe('component with properties', () => {
    beforeEach(() => {
      setBindings(new Set(['MyComponent']));
    });

    test('serializes component with properties and events', () => {
      const node: HBSNode = {
        tag: 'MyComponent',
        attributes: [],
        properties: [['value', '$:this.value']],
        selfClosing: true,
        hasStableChild: false,
        blockParams: [],
        events: [['click', '$:this.handleClick']],
        children: [],
      };
      const result = serializeNode(node);
      expect(result).toContain('MyComponent');
      expect(result).toContain('this.value');
      expect(result).toContain('this.handleClick');
    });

    test('serializes component with mixed attrs (regular and @args)', () => {
      const node: HBSNode = {
        tag: 'MyComponent',
        attributes: [
          ['class', 'my-class'],
          ['@name', 'test'],
        ],
        properties: [],
        selfClosing: true,
        hasStableChild: false,
        blockParams: [],
        events: [],
        children: [],
      };
      const result = serializeNode(node);
      expect(result).toContain('name');
      expect(result).toContain('my-class');
    });
  });

  describe('each with index.value replacement', () => {
    test('replaces index parameter with .value accessor', () => {
      const node: HBSControlExpression = {
        type: 'each',
        isControl: true,
        condition: '$:this.items',
        blockParams: ['item', 'idx'],
        children: ['$:idx'],
        inverse: null,
        key: null,
        isSync: false,
      };
      const result = serializeNode(node);
      expect(result).toContain('idx.value');
    });
  });

  describe('element with attributes', () => {
    test('element with properties and events', () => {
      const node: HBSNode = {
        tag: 'button',
        attributes: [['class', 'btn']],
        properties: [['disabled', true]],
        selfClosing: false,
        hasStableChild: false,
        blockParams: [],
        events: [['click', '$:this.onClick']],
        children: ['Click me'],
      };
      const result = serializeNode(node);
      expect(result).toContain('button');
      expect(result).toContain('disabled');
    });
  });

  describe('control with multiple children', () => {
    test('each with multiple children (non-stable)', () => {
      const node: HBSControlExpression = {
        type: 'each',
        isControl: true,
        condition: '$:this.items',
        blockParams: ['item', 'index'],
        children: [
          'text1',
          {
            tag: 'span',
            attributes: [],
            properties: [],
            selfClosing: false,
            hasStableChild: false,
            blockParams: [],
            events: [],
            children: ['nested'],
          } as HBSNode,
        ],
        inverse: null,
        key: null,
        isSync: false,
      };
      const result = serializeNode(node);
      expect(result).toContain(SYMBOLS.$_ucw);
    });
  });
});

describe('serializeAttribute with path', () => {
  beforeEach(() => {
    setFlags(defaultFlags());
    setBindings(new Set());
  });

  test('serializes path attribute value', () => {
    const result = serializeAttribute('onclick', '$:this.handleClick');
    expect(result).toContain('this.handleClick');
  });
});

describe('IS_GLIMMER_COMPAT_MODE=false', () => {
  beforeEach(() => {
    setFlags({ ...defaultFlags(), IS_GLIMMER_COMPAT_MODE: false });
    setBindings(new Set(['MyComponent']));
    setSerializationContext(null);
    resetContextCounter();
  });

  test('serializeNode with component in non-compat mode', () => {
    const node: HBSNode = {
      tag: 'MyComponent',
      attributes: [['@name', 'test']],
      properties: [['value', 42]],
      selfClosing: true,
      hasStableChild: false,
      blockParams: [],
      events: [],
      children: [],
    };
    const result = serializeNode(node);
    // In non-compat mode, should use direct args object without $_args wrapper
    expect(result).toContain('MyComponent');
    expect(result).toContain('name:');
    expect(result).not.toContain(SYMBOLS.ARGS);  // Should not use $_args in non-compat mode
  });

  test('serializeNode with slots in non-compat mode', () => {
    const node: HBSNode = {
      tag: 'MyComponent',
      attributes: [],
      properties: [],
      selfClosing: false,
      hasStableChild: false,
      blockParams: [],
      events: [],
      children: ['slot content'],
    };
    const result = serializeNode(node);
    expect(result).toContain('default');
  });
});

describe('serializeNode if control with null inverse coverage', () => {
  beforeEach(() => {
    setFlags(defaultFlags());
    setBindings(new Set());
    setSerializationContext(null);
    resetContextCounter();
  });

  test('if control with strictly null inverse goes through toChildArray null branch', () => {
    const node: HBSControlExpression = {
      type: 'if',
      isControl: true,
      condition: 'true',
      blockParams: [],
      children: ['visible'],
      inverse: null,  // Explicitly null to test toChildArray null path
      key: null,
      isSync: false,
    };
    const result = serializeNode(node);
    expect(result).toContain(SYMBOLS.IF);
    // The false branch should still be generated with empty array
    expect(result).toContain('[]');
  });

  test('if control with empty inverse array', () => {
    const node: HBSControlExpression = {
      type: 'if',
      isControl: true,
      condition: 'true',
      blockParams: [],
      children: ['visible'],
      inverse: [],  // Empty array (different from null)
      key: null,
      isSync: false,
    };
    const result = serializeNode(node);
    expect(result).toContain(SYMBOLS.IF);
  });
});

describe('component with unsafe prop names', () => {
  beforeEach(() => {
    setFlags(defaultFlags());
    setBindings(new Set(['MyComponent']));
    setSerializationContext(null);
    resetContextCounter();
  });

  test('component with dash in prop name uses toPropName', () => {
    const node: HBSNode = {
      tag: 'MyComponent',
      attributes: [['@data-value', 'test']],  // Unsafe key with dash
      properties: [],
      selfClosing: true,
      hasStableChild: false,
      blockParams: [],
      events: [],
      children: [],
    };
    const result = serializeNode(node);
    // The key should be quoted because it contains a dash
    expect(result).toContain('"data-value"');
  });
});

