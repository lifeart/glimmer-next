import { describe, test, expect, beforeEach } from 'vitest';
import { preprocess } from '@glimmer/syntax';
import {
  createContext,
  initializeVisitors,
  type CompilerContext,
} from '../context';
import {
  visit,
  visitChildren,
  visitText,
  visitMustache,
  visitBlock,
  visitElement,
  getNodeRange,
  resolvePath,
  serializeValueToString,
  isWhitespaceOnly,
  setSourceForRanges,
} from '../visitors';
import {
  literal,
  path,
  raw,
  helper,
  isHBSNode,
  isHBSControlExpression,
  isSerializedValue,
  isRuntimeTag,
  type HBSNode,
} from '../types';
import { INTERNAL_HELPERS, SYMBOLS } from '../serializers/symbols';

/**
 * Helper to parse template and get first element/statement
 */
function parseFirst(template: string) {
  const ast = preprocess(template);
  return ast.body[0];
}

/**
 * Helper to parse template and get all body nodes
 */
function parseAll(template: string) {
  const ast = preprocess(template);
  return ast.body;
}

describe('Visitor Pattern', () => {
  let ctx: CompilerContext;

  beforeEach(() => {
    ctx = createContext('<div>test</div>');
    // Initialize the visitor registry (counters automatically reset per context)
    initializeVisitors(ctx, visit, visitChildren);
  });

  describe('visit()', () => {
    describe('literal values', () => {
      test('visits undefined literal', () => {
        const node = parseFirst('{{undefined}}');
        // Mustache wrapping undefined
        const result = visit(ctx, node);
        expect(result).not.toBeNull();
      });

      test('visits null literal', () => {
        const node = parseFirst('{{null}}');
        const result = visit(ctx, node);
        expect(result).not.toBeNull();
      });

      test('visits boolean literal', () => {
        const node = parseFirst('{{true}}');
        const result = visit(ctx, node);
        expect(result).not.toBeNull();
      });

      test('visits number literal', () => {
        const node = parseFirst('{{42}}');
        const result = visit(ctx, node);
        expect(result).not.toBeNull();
      });

      test('visits string literal', () => {
        const node = parseFirst('{{"hello"}}');
        const result = visit(ctx, node);
        expect(result).not.toBeNull();
      });
    });

    describe('text nodes', () => {
      test('visits text node', () => {
        const node = parseFirst('Hello World');
        const result = visit(ctx, node);
        expect(result).toBe('Hello World');
      });

      test('returns null for whitespace-only multi-line text', () => {
        const node = parseFirst('\n  \n');
        const result = visit(ctx, node);
        expect(result).toBeNull();
      });

      test('preserves single space', () => {
        const node = parseFirst(' ');
        const result = visit(ctx, node);
        // Single space is not whitespace-only (length <= 1)
        expect(result).toBe(' ');
      });
    });

    describe('path expressions', () => {
      test('visits path expression with wrap', () => {
        const ast = preprocess('{{this.foo}}');
        const mustache = ast.body[0];
        if (mustache.type === 'MustacheStatement' && mustache.path.type === 'PathExpression') {
          const result = visit(ctx, mustache.path, true);
          expect(isSerializedValue(result)).toBe(true);
          if (isSerializedValue(result)) {
            expect(result.kind).toBe('path');
          }
        }
      });

      test('visits path expression without wrap', () => {
        // Paths always return 'path' kind regardless of wrap parameter.
        // The wrapping in getters is handled by buildPath based on compat mode.
        const ast = preprocess('{{this.foo}}');
        const mustache = ast.body[0];
        if (mustache.type === 'MustacheStatement' && mustache.path.type === 'PathExpression') {
          const result = visit(ctx, mustache.path, false);
          expect(isSerializedValue(result)).toBe(true);
          if (isSerializedValue(result)) {
            expect(result.kind).toBe('path');
          }
        }
      });
    });

    describe('element nodes', () => {
      test('visits element node', () => {
        const node = parseFirst('<div class="foo">Hello</div>');
        const result = visit(ctx, node);
        expect(isHBSNode(result)).toBe(true);
        if (isHBSNode(result)) {
          expect(result.tag).toBe('div');
        }
      });

      test('visits self-closing element', () => {
        const node = parseFirst('<input type="text" />');
        const result = visit(ctx, node);
        expect(isHBSNode(result)).toBe(true);
        if (isHBSNode(result)) {
          expect(result.selfClosing).toBe(true);
        }
      });
    });
  });

  describe('visitChildren()', () => {
    test('visits multiple children', () => {
      const nodes = parseAll('<div>Hello</div><span>World</span>');
      const results = visitChildren(ctx, nodes);
      expect(results).toHaveLength(2);
    });

    test('filters whitespace-only text nodes', () => {
      const nodes = parseAll('<div>Hello</div>\n\n<span>World</span>');
      const results = visitChildren(ctx, nodes);
      // Should have 2 elements, whitespace filtered
      expect(results).toHaveLength(2);
    });
  });

  describe('visitText()', () => {
    test('returns text content', () => {
      const node = parseFirst('Hello');
      if (node.type === 'TextNode') {
        const result = visitText(ctx, node);
        expect(result).toBe('Hello');
      }
    });

    test('returns null for whitespace with newlines', () => {
      const node = parseFirst('\n  \n');
      if (node.type === 'TextNode') {
        const result = visitText(ctx, node);
        expect(result).toBeNull();
      }
    });
  });

  describe('visitMustache()', () => {
    test('visits simple path mustache', () => {
      const node = parseFirst('{{this.name}}');
      if (node.type === 'MustacheStatement') {
        ctx.scopeTracker.addBinding('this', { kind: 'this', name: 'this' });
        const result = visitMustache(ctx, node);
        expect(result).not.toBeNull();
      }
    });

    test('visits helper call with params', () => {
      const node = parseFirst('{{concat "a" "b"}}');
      if (node.type === 'MustacheStatement') {
        const result = visitMustache(ctx, node);
        expect(result).not.toBeNull();
        expect(isSerializedValue(result)).toBe(true);
      }
    });

    test('visits yield expression', () => {
      const node = parseFirst('{{yield}}');
      if (node.type === 'MustacheStatement') {
        const result = visitMustache(ctx, node);
        expect(isHBSControlExpression(result)).toBe(true);
        if (isHBSControlExpression(result)) {
          expect(result.type).toBe('yield');
        }
      }
    });

    test('visits yield with to parameter', () => {
      const node = parseFirst('{{yield to="header"}}');
      if (node.type === 'MustacheStatement') {
        const result = visitMustache(ctx, node);
        expect(isHBSControlExpression(result)).toBe(true);
        if (isHBSControlExpression(result)) {
          expect(result.key).toBe('header');
        }
      }
    });
  });

  describe('visitBlock()', () => {
    test('visits if block', () => {
      const node = parseFirst('{{#if this.condition}}content{{/if}}');
      if (node.type === 'BlockStatement') {
        const result = visitBlock(ctx, node);
        expect(isHBSControlExpression(result)).toBe(true);
        if (isHBSControlExpression(result)) {
          expect(result.type).toBe('if');
        }
      }
    });

    test('visits each block', () => {
      const node = parseFirst('{{#each this.items as |item|}}{{item}}{{/each}}');
      if (node.type === 'BlockStatement') {
        const result = visitBlock(ctx, node);
        expect(isHBSControlExpression(result)).toBe(true);
        if (isHBSControlExpression(result)) {
          expect(result.type).toBe('each');
          expect(result.blockParams).toContain('item');
        }
      }
    });

    test('visits unless block (inverts to if)', () => {
      const node = parseFirst('{{#unless this.hidden}}visible{{/unless}}');
      if (node.type === 'BlockStatement') {
        const result = visitBlock(ctx, node);
        expect(isHBSControlExpression(result)).toBe(true);
        if (isHBSControlExpression(result)) {
          expect(result.type).toBe('if');
          // unless flips children and inverse
        }
      }
    });

    test('visits let block', () => {
      const node = parseFirst('{{#let "value" as |x|}}{{x}}{{/let}}');
      if (node.type === 'BlockStatement') {
        const result = visitBlock(ctx, node);
        expect(isSerializedValue(result)).toBe(true);
        if (isSerializedValue(result)) {
          expect(result.kind).toBe('raw');
        }
      }
    });

    test('returns null for block without params', () => {
      // Create a block without params manually is hard, but we can test empty children
      const node = parseFirst('{{#if this.x}}{{/if}}');
      if (node.type === 'BlockStatement') {
        const result = visitBlock(ctx, node);
        // Empty block returns null
        expect(result).toBeNull();
      }
    });
  });

  describe('visitElement()', () => {
    test('visits basic element', () => {
      const node = parseFirst('<div>content</div>');
      if (node.type === 'ElementNode') {
        const result = visitElement(ctx, node);
        expect(result.tag).toBe('div');
      }
    });

    test('processes class attribute', () => {
      const node = parseFirst('<div class="foo bar">content</div>');
      if (node.type === 'ElementNode') {
        const result = visitElement(ctx, node);
        expect(result.attributes.length).toBeGreaterThan(0);
        const classAttr = result.attributes.find(([name]) => name === 'class');
        expect(classAttr).toBeDefined();
      }
    });

    test('processes boolean attribute', () => {
      const node = parseFirst('<input disabled />');
      if (node.type === 'ElementNode') {
        const result = visitElement(ctx, node);
        expect(result.properties.length).toBeGreaterThan(0);
      }
    });

    test('handles svg element with namespace', () => {
      const node = parseFirst('<svg><rect /></svg>');
      if (node.type === 'ElementNode') {
        const result = visitElement(ctx, node);
        // SVG elements are wrapped in a namespace provider component (RuntimeTag)
        expect(isRuntimeTag(result.tag)).toBe(true);
        if (isRuntimeTag(result.tag)) {
          expect(result.tag.symbol).toBe('$_SVGProvider');
        }
        // The actual svg element is the first child
        expect(result.children.length).toBe(1);
        const svgChild = result.children[0] as HBSNode;
        expect(svgChild.tag).toBe('svg');
      }
    });

    test('handles math element with namespace', () => {
      const node = parseFirst('<math><mi>x</mi></math>');
      if (node.type === 'ElementNode') {
        const result = visitElement(ctx, node);
        // Math elements are wrapped in a namespace provider component (RuntimeTag)
        expect(isRuntimeTag(result.tag)).toBe(true);
        if (isRuntimeTag(result.tag)) {
          expect(result.tag.symbol).toBe('$_MathMLProvider');
        }
        // The actual math element is the first child
        expect(result.children.length).toBe(1);
        const mathChild = result.children[0] as HBSNode;
        expect(mathChild.tag).toBe('math');
      }
    });

    test('processes event modifier', () => {
      const node = parseFirst('<button {{on "click" this.handleClick}}>Click</button>');
      if (node.type === 'ElementNode') {
        const result = visitElement(ctx, node);
        // Should have click event
        const clickEvent = result.events.find(([name]) => name === 'click');
        expect(clickEvent).toBeDefined();
      }
    });

    test('processes style.* attributes', () => {
      const node = parseFirst('<div style.color="red">styled</div>');
      if (node.type === 'ElementNode') {
        const result = visitElement(ctx, node);
        // style.* becomes an oncreated event
        const styleEvent = result.events.find(([name]) => name === '@oncreated');
        expect(styleEvent).toBeDefined();
      }
    });
  });

  describe('getNodeRange()', () => {
    test('returns range for node with location', () => {
      const template = '<div>test</div>';
      setSourceForRanges(template);
      const node = parseFirst(template);
      const range = getNodeRange(node);
      expect(range).toBeDefined();
      expect(typeof range?.start).toBe('number');
      expect(typeof range?.end).toBe('number');
    });
  });

  describe('resolvePath()', () => {
    test('resolves @arg to $a.arg', () => {
      const result = resolvePath(ctx, '@myArg');
      expect(result).toBe('$a.myArg');
    });

    test('keeps this.x as is', () => {
      const result = resolvePath(ctx, 'this.foo');
      expect(result).toBe('this.foo');
    });

    test('keeps this as is', () => {
      const result = resolvePath(ctx, 'this');
      expect(result).toBe('this');
    });

    test('keeps simple unknown identifiers as-is for compile-time replacement', () => {
      // Simple identifiers without dots are kept as-is
      // This allows Vite's define plugin to replace compile-time constants
      // like IS_GLIMMER_COMPAT_MODE
      const result = resolvePath(ctx, 'unknownVar');
      expect(result).toBe('unknownVar');
    });

    test('keeps compile-time flags as-is', () => {
      // Compile-time flags like IS_GLIMMER_COMPAT_MODE should remain as-is
      // so Vite's define plugin can replace them with their values
      const result = resolvePath(ctx, 'IS_GLIMMER_COMPAT_MODE');
      expect(result).toBe('IS_GLIMMER_COMPAT_MODE');
    });

    test('keeps unknown paths with dots as-is (no this. prefix)', () => {
      // Unknown paths are NOT prefixed with this. to match old converter behavior
      // This allows compile-time constants and namespaced paths to work
      const result = resolvePath(ctx, 'foo.bar');
      expect(result).toBe('foo.bar');
    });

    test('applies optional chaining to long unknown paths', () => {
      // Paths with 3+ segments get optional chaining for safety
      const result = resolvePath(ctx, 'foo.bar.baz');
      expect(result).toBe('foo?.bar?.baz');
    });

    test('uses binding as-is for known binding', () => {
      ctx.scopeTracker.addBinding('localVar', { kind: 'block-param', name: 'localVar' });
      const result = resolvePath(ctx, 'localVar');
      expect(result).toBe('localVar');
    });

    test('uses binding path as-is for known binding', () => {
      ctx.scopeTracker.addBinding('item', { kind: 'block-param', name: 'item' });
      const result = resolvePath(ctx, 'item.name');
      expect(result).toBe('item.name');
    });
  });

  describe('serializeValueToString()', () => {
    test('serializes literal string', () => {
      const result = serializeValueToString(literal('hello'));
      expect(result).toBe('"hello"');
    });

    test('serializes literal number', () => {
      const result = serializeValueToString(literal(42));
      expect(result).toBe('42');
    });

    test('serializes literal boolean', () => {
      expect(serializeValueToString(literal(true))).toBe('true');
      expect(serializeValueToString(literal(false))).toBe('false');
    });

    test('serializes literal null', () => {
      expect(serializeValueToString(literal(null))).toBe('null');
    });

    test('serializes literal undefined', () => {
      expect(serializeValueToString(literal(undefined))).toBe('undefined');
    });

    test('serializes path value', () => {
      const result = serializeValueToString(path('this.foo'));
      expect(result).toBe('this.foo');
    });

    test('serializes raw value', () => {
      const result = serializeValueToString(raw('console.log()'));
      expect(result).toBe('console.log()');
    });

    test('serializes helper with positional args', () => {
      const result = serializeValueToString(helper('concat', [literal('a'), literal('b')]));
      expect(result).toBe('concat("a", "b")');
    });

    test('serializes helper with named args', () => {
      const named = new Map([['sep', literal('-')]]);
      const result = serializeValueToString(helper('join', [literal('a')], named));
      expect(result).toBe('join("a", { sep: "-" })');
    });

    test('serializes internal element helper using builder wrapper', () => {
      const result = serializeValueToString(
        helper(INTERNAL_HELPERS.ELEMENT_HELPER, [literal('div')])
      );
      expect(result).toContain(SYMBOLS.TAG);
      expect(result).toContain(SYMBOLS.GET_ARGS);
      expect(result).toContain(SYMBOLS.FINALIZE_COMPONENT);
      expect(result).not.toContain(INTERNAL_HELPERS.ELEMENT_HELPER);
    });

    test('serializes internal on handler helper', () => {
      const result = serializeValueToString(
        helper(INTERNAL_HELPERS.ON_HANDLER, [path('this.onClick'), literal('x')])
      );
      expect(result).toContain('($e, $n) =>');
      expect(result).toContain('this.onClick($e, $n, "x")');
    });

    test('serializes internal oncreated handler helper', () => {
      const result = serializeValueToString(
        helper(INTERNAL_HELPERS.ON_CREATED_HANDLER, [path('this.onCreated')])
      );
      expect(result).toContain('$n =>');
      expect(result).toContain('this.onCreated($n)');
    });

    test('serializes internal style setter helper', () => {
      const result = serializeValueToString(
        helper(INTERNAL_HELPERS.STYLE_SETTER, [literal('color'), path('this.color')])
      );
      expect(result).toContain('setProperty("color"');
      expect(result).toContain(SYMBOLS.TO_VALUE);
    });
  });

  describe('isWhitespaceOnly()', () => {
    test('returns true for newlines only', () => {
      expect(isWhitespaceOnly('\n\n')).toBe(true);
    });

    test('returns true for spaces with newline', () => {
      expect(isWhitespaceOnly('  \n  ')).toBe(true);
    });

    test('returns true for multiple spaces', () => {
      expect(isWhitespaceOnly('    ')).toBe(true);
    });

    test('returns false for single space', () => {
      expect(isWhitespaceOnly(' ')).toBe(false);
    });

    test('returns false for text content', () => {
      expect(isWhitespaceOnly('hello')).toBe(false);
    });

    test('returns false for text with leading space', () => {
      expect(isWhitespaceOnly(' hello')).toBe(false);
    });
  });

  describe('seenNodes tracking', () => {
    test('marks visited nodes in seenNodes', () => {
      const node = parseFirst('<div>test</div>');
      expect(ctx.seenNodes.has(node)).toBe(false);
      visit(ctx, node);
      expect(ctx.seenNodes.has(node)).toBe(true);
    });
  });

  describe('scope management', () => {
    test('block params are added and removed from scope', () => {
      const node = parseFirst('{{#each this.items as |item|}}{{item}}{{/each}}');
      if (node.type === 'BlockStatement') {
        // Before visiting, item is not in scope
        expect(ctx.scopeTracker.hasBinding('item')).toBe(false);

        // Visit the block
        visitBlock(ctx, node);

        // After visiting, item should be removed from scope (cleanup)
        expect(ctx.scopeTracker.hasBinding('item')).toBe(false);
      }
    });
  });
});

describe('Edge Cases', () => {
  let ctx: CompilerContext;

  beforeEach(() => {
    ctx = createContext('<div />');
    // Initialize the visitor registry (counters automatically reset per context)
    initializeVisitors(ctx, visit, visitChildren);
  });

  test('handles deeply nested elements', () => {
    const node = parseFirst('<div><span><a><b>text</b></a></span></div>');
    const result = visit(ctx, node);
    expect(isHBSNode(result)).toBe(true);
  });

  test('handles element with multiple attributes', () => {
    const node = parseFirst('<input type="text" class="input" placeholder="Enter name" />');
    if (node.type === 'ElementNode') {
      const result = visitElement(ctx, node);
      expect(result.attributes.length).toBeGreaterThanOrEqual(3);
    }
  });

  test('handles mustache in attribute', () => {
    const node = parseFirst('<div class={{this.className}}>content</div>');
    if (node.type === 'ElementNode') {
      const result = visitElement(ctx, node);
      const classAttr = result.attributes.find(([name]) => name === 'class');
      expect(classAttr).toBeDefined();
    }
  });

  test('handles concat in attribute', () => {
    const node = parseFirst('<div class="prefix-{{this.suffix}}">content</div>');
    if (node.type === 'ElementNode') {
      const result = visitElement(ctx, node);
      const classAttr = result.attributes.find(([name]) => name === 'class');
      expect(classAttr).toBeDefined();
    }
  });
});
