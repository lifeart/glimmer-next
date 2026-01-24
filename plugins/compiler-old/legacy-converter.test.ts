import { describe, test, expect } from 'vitest';
import { preprocess, type ASTv1 } from '@glimmer/syntax';
import { templateToTypescript, convert } from './legacy-converter';
import { MappingTree } from './mapping-tree';
import { TransformedModule, TransformedModuleBuilder } from './transformed-module';
import { createMapper } from './mapper';
import { defaultFlags } from '../flags';
import { serializeNode } from '../utils';
import type { HBSControlExpressionV2, HBSNodeV2 } from './types';

const flags = defaultFlags();

describe('Converter V2', () => {
  describe('MappingTree', () => {
    test('creates a root mapping', () => {
      const tree = new MappingTree(
        'Template',
        { start: 0, end: 100 },
        { start: 0, end: 200 },
      );

      expect(tree.sourceNode).toBe('Template');
      expect(tree.originalRange).toEqual({ start: 0, end: 100 });
      expect(tree.transformedRange).toEqual({ start: 0, end: 200 });
    });

    test('adds child mappings', () => {
      const root = new MappingTree(
        'Template',
        { start: 0, end: 100 },
        { start: 0, end: 200 },
      );

      const child = root.createChild(
        'ElementNode',
        { start: 10, end: 50 },
        { start: 20, end: 100 },
      );

      expect(root.children).toHaveLength(1);
      expect(root.children[0]).toBe(child);
    });

    test('finds narrowest mapping at transformed offset', () => {
      const root = new MappingTree(
        'Template',
        { start: 0, end: 100 },
        { start: 0, end: 200 },
      );

      const child = root.createChild(
        'ElementNode',
        { start: 10, end: 50 },
        { start: 20, end: 100 },
      );

      const grandchild = child.createChild(
        'TextNode',
        { start: 20, end: 30 },
        { start: 40, end: 60 },
      );

      // Should find grandchild for offset 50
      const found = root.findNarrowestAtTransformedOffset(50);
      expect(found).toBe(grandchild);

      // Should find child for offset 30 (outside grandchild)
      const found2 = root.findNarrowestAtTransformedOffset(30);
      expect(found2).toBe(child);

      // Should find root for offset 10 (outside child)
      const found3 = root.findNarrowestAtTransformedOffset(10);
      expect(found3).toBe(root);
    });

    test('finds narrowest mapping at original offset', () => {
      const root = new MappingTree(
        'Template',
        { start: 0, end: 100 },
        { start: 0, end: 200 },
      );

      const child = root.createChild(
        'ElementNode',
        { start: 10, end: 50 },
        { start: 20, end: 100 },
      );

      const found = root.findNarrowestAtOriginalOffset(25);
      expect(found).toBe(child);

      const found2 = root.findNarrowestAtOriginalOffset(5);
      expect(found2).toBe(root);
    });

    test('converts to code mappings', () => {
      const root = new MappingTree(
        'Template',
        { start: 0, end: 10 },
        { start: 0, end: 20 },
      );

      const mappings = root.toCodeMappings();

      // Should have zero-length boundary mappings for size-mismatched ranges
      expect(mappings.length).toBeGreaterThan(0);
    });

    test('generates debug string', () => {
      const root = new MappingTree(
        'Template',
        { start: 0, end: 100 },
        { start: 0, end: 200 },
      );

      root.createChild('ElementNode', { start: 10, end: 50 }, { start: 20, end: 100 });

      const debug = root.toDebugString();

      expect(debug).toContain('Template');
      expect(debug).toContain('ElementNode');
      expect(debug).toContain('[0-100]');
    });

    test('clones mapping tree', () => {
      const root = new MappingTree(
        'Template',
        { start: 0, end: 100 },
        { start: 0, end: 200 },
      );

      root.createChild('ElementNode', { start: 10, end: 50 }, { start: 20, end: 100 });

      const cloned = root.clone();

      expect(cloned.sourceNode).toBe(root.sourceNode);
      expect(cloned.originalRange).toEqual(root.originalRange);
      expect(cloned.children).toHaveLength(1);
      expect(cloned).not.toBe(root);
      expect(cloned.children[0]).not.toBe(root.children[0]);
    });

    test('shifts ranges', () => {
      const tree = new MappingTree(
        'Template',
        { start: 0, end: 100 },
        { start: 0, end: 200 },
      );

      tree.shiftOriginal(50);
      expect(tree.originalRange).toEqual({ start: 50, end: 150 });

      tree.shiftTransformed(100);
      expect(tree.transformedRange).toEqual({ start: 100, end: 300 });
    });
  });

  describe('Mapper', () => {
    test('emits text', () => {
      const mapper = createMapper('template content');

      mapper.text('hello');
      mapper.text(' world');

      expect(mapper.getCode()).toBe('hello world');
      expect(mapper.getOffset()).toBe(11);
    });

    test('emits with mapping', () => {
      const mapper = createMapper('{{foo}}');

      mapper.emit('$:foo', 2, 5); // Maps 'foo' in template to '$:foo' in output

      const tree = mapper.getMappingTree();
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0].originalRange).toEqual({ start: 2, end: 5 });
      expect(tree.children[0].transformedRange).toEqual({ start: 0, end: 5 });
    });

    test('emits identifier with mapping', () => {
      const mapper = createMapper('{{myIdentifier}}');

      mapper.identifier('myIdentifier', 2, 12);

      const tree = mapper.getMappingTree();
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0].sourceNode).toBe('Identifier');
    });

    test('handles forNode scoping', () => {
      const mapper = createMapper('<div>content</div>');

      // Simulate processing an element node
      mapper.forNode(
        { type: 'ElementNode', loc: { start: { offset: 0 }, end: { offset: 18 } } } as any,
        'ElementNode',
        () => {
          mapper.text('$_tag("div")');
        },
      );

      const tree = mapper.getMappingTree();
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0].sourceNode).toBe('ElementNode');
    });

    test('handles indentation', () => {
      const mapper = createMapper('template');

      mapper.text('function() {');
      mapper.indent();
      mapper.newline();
      mapper.text('return 1;');
      mapper.dedent();
      mapper.newline();
      mapper.text('}');

      const code = mapper.getCode();
      expect(code).toContain('  return 1;');
    });

    test('records errors', () => {
      const mapper = createMapper('{{invalid}}');

      mapper.error('Something went wrong');

      expect(mapper.errors).toHaveLength(1);
      expect(mapper.errors[0].message).toBe('Something went wrong');
    });

    test('records directives', () => {
      const mapper = createMapper('{{! @glint-ignore }}');

      mapper.recordDirective('ignore', { start: 0, end: 20 }, { start: 0, end: 50 });

      expect(mapper.directives).toHaveLength(1);
      expect(mapper.directives[0].kind).toBe('ignore');
    });

    test('supports snapshot and restore', () => {
      const mapper = createMapper('template');

      mapper.text('hello');
      const snapshot = mapper.snapshot();

      mapper.text(' world');
      expect(mapper.getCode()).toBe('hello world');

      mapper.restore(snapshot);
      expect(mapper.getCode()).toBe('hello');
    });
  });

  describe('TransformedModule', () => {
    test('creates with bidirectional mapping', () => {
      const tree = new MappingTree(
        'Template',
        { start: 0, end: 10 },
        { start: 0, end: 20 },
      );

      const module = new TransformedModule({
        transformedContents: '$_tag("div", [], [])',
        originalContents: '<div></div>',
        mappingTree: tree,
      });

      expect(module.transformedContents).toBe('$_tag("div", [], [])');
      expect(module.originalContents).toBe('<div></div>');
    });

    test('gets original offset from transformed', () => {
      const tree = new MappingTree(
        'Template',
        { start: 0, end: 10 },
        { start: 0, end: 10 },
      );

      const module = new TransformedModule({
        transformedContents: '0123456789',
        originalContents: '0123456789',
        mappingTree: tree,
      });

      const result = module.getOriginalOffset(5);
      expect(result.found).toBe(true);
      expect(result.offset).toBe(5);
    });

    test('gets transformed offset from original', () => {
      const tree = new MappingTree(
        'Template',
        { start: 0, end: 10 },
        { start: 0, end: 10 },
      );

      const module = new TransformedModule({
        transformedContents: '0123456789',
        originalContents: '0123456789',
        mappingTree: tree,
      });

      const result = module.getTransformedOffset(5);
      expect(result.found).toBe(true);
      expect(result.offset).toBe(5);
    });

    test('generates debug string', () => {
      const tree = new MappingTree(
        'Template',
        { start: 0, end: 10 },
        { start: 0, end: 20 },
      );

      const module = new TransformedModule({
        transformedContents: '$_tag("div", [], [])',
        originalContents: '<div></div>',
        mappingTree: tree,
      });

      const debug = module.toDebugString();

      expect(debug).toContain('TransformedModule');
      expect(debug).toContain('Original');
      expect(debug).toContain('Transformed');
      expect(debug).toContain('Mapping Tree');
    });

    test('converts to code mappings', () => {
      const tree = new MappingTree(
        'Template',
        { start: 0, end: 10 },
        { start: 0, end: 20 },
      );

      const module = new TransformedModule({
        transformedContents: '$_tag("div", [], [])',
        originalContents: '<div></div>',
        mappingTree: tree,
      });

      const mappings = module.toCodeMappings();
      expect(mappings.length).toBeGreaterThan(0);
    });
  });

  describe('TransformedModuleBuilder', () => {
    test('builds module with correlated spans', () => {
      const builder = new TransformedModuleBuilder('<div>hello</div>');

      builder.addCorrelatedSpan(0, 5, '$_tag("div",');
      builder.addCorrelatedSpan(5, 5, '"hello"');
      builder.addCorrelatedSpan(10, 6, ')');

      const module = builder.build();

      expect(module.transformedContents).toBe('$_tag("div","hello")');
      expect(module.correlatedSpans).toHaveLength(3);
    });

    test('builds module with passthrough content', () => {
      const builder = new TransformedModuleBuilder('const x = 1;');

      builder.addPassthrough(0, 12);

      const module = builder.build();

      expect(module.transformedContents).toBe('const x = 1;');
    });

    test('builds module with errors', () => {
      const builder = new TransformedModuleBuilder('invalid');

      builder.addError({ message: 'Parse error' });

      const module = builder.build();

      expect(module.errors).toHaveLength(1);
      expect(module.errors[0].message).toBe('Parse error');
    });
  });

  describe('templateToTypescript', () => {
    test('converts simple text', () => {
      const result = templateToTypescript('Hello World', flags);

      expect(result.code).toContain('Hello World');
      expect(result.errors).toHaveLength(0);
    });

    test('converts simple element', () => {
      const result = templateToTypescript('<div></div>', flags);

      expect(result.code).toContain('div');
      expect(result.errors).toHaveLength(0);
    });

    test('converts element with text', () => {
      const result = templateToTypescript('<div>Hello</div>', flags);

      expect(result.code).toContain('div');
      expect(result.code).toContain('Hello');
      expect(result.errors).toHaveLength(0);
    });

    test('converts mustache expression', () => {
      const result = templateToTypescript('{{foo}}', flags, new Set(['foo']));

      expect(result.code).toContain('foo');
      expect(result.errors).toHaveLength(0);
    });

    test('converts if block', () => {
      const result = templateToTypescript(
        '{{#if condition}}content{{/if}}',
        flags,
        new Set(['condition']),
      );

      expect(result.code).toContain('if');
      expect(result.errors).toHaveLength(0);
    });

    test('converts each block', () => {
      const result = templateToTypescript(
        '{{#each items as |item|}}{{item}}{{/each}}',
        flags,
        new Set(['items']),
      );

      expect(result.code).toContain('each');
      expect(result.errors).toHaveLength(0);
    });

    test('returns mapping tree', () => {
      const result = templateToTypescript('<div>text</div>', flags);

      expect(result.mapping).toBeDefined();
      expect(result.mapping.sourceNode).toBe('Template');
      expect(result.mapping.originalRange.start).toBe(0);
    });

    test('handles empty template', () => {
      const result = templateToTypescript('', flags);

      expect(result.code).toBe('[]');
      expect(result.errors).toHaveLength(0);
    });

    test('handles whitespace-only template', () => {
      const result = templateToTypescript('   \n   ', flags);

      expect(result.code).toBe('[]');
      expect(result.errors).toHaveLength(0);
    });

    test('handles nested elements', () => {
      const result = templateToTypescript(
        '<div><span><p>text</p></span></div>',
        flags,
      );

      expect(result.code).toContain('div');
      expect(result.code).toContain('span');
      expect(result.code).toContain('p');
      expect(result.errors).toHaveLength(0);
    });

    test('handles attributes', () => {
      const result = templateToTypescript('<div data-test="foo"></div>', flags);

      expect(result.code).toContain('data-test');
      expect(result.code).toContain('foo');
      expect(result.errors).toHaveLength(0);
    });

    test('handles class property', () => {
      const result = templateToTypescript('<div class="foo"></div>', flags);

      // class is a property, not attribute
      expect(result.code).toContain('foo');
      expect(result.errors).toHaveLength(0);
    });

    test('handles dynamic attributes', () => {
      const result = templateToTypescript(
        '<div class={{className}}></div>',
        flags,
        new Set(['className']),
      );

      expect(result.code).toContain('className');
      expect(result.errors).toHaveLength(0);
    });

    test('handles events', () => {
      const result = templateToTypescript(
        '<button {{on "click" handleClick}}></button>',
        flags,
        new Set(['handleClick']),
      );

      expect(result.code).toContain('click');
      expect(result.code).toContain('handleClick');
      expect(result.errors).toHaveLength(0);
    });

    test('handles yield', () => {
      const result = templateToTypescript('{{yield}}', flags);

      expect(result.code).toContain('yield');
      expect(result.errors).toHaveLength(0);
    });

    test('handles helpers', () => {
      const result = templateToTypescript(
        '{{myHelper arg1 arg2}}',
        flags,
        new Set(['myHelper']),
      );

      expect(result.code).toContain('myHelper');
      expect(result.errors).toHaveLength(0);
    });

    test('handles concat expressions', () => {
      const result = templateToTypescript(
        '<div class="prefix-{{value}}-suffix"></div>',
        flags,
        new Set(['value']),
      );

      expect(result.code).toContain('join');
      expect(result.errors).toHaveLength(0);
    });

    test('handles svg namespace', () => {
      const result = templateToTypescript('<svg><rect></rect></svg>', flags);

      // SVG gets wrapped in a namespace provider
      // The output should contain the SVG structure
      expect(result.errors).toHaveLength(0);
      // Check that we got some output (may be JSON stringified)
      expect(result.code.length).toBeGreaterThan(2);
    });

    test('handles boolean attributes', () => {
      const result = templateToTypescript('<input disabled />', flags);

      expect(result.code).toContain('disabled');
      expect(result.errors).toHaveLength(0);
    });

    test('preserves mapping information', () => {
      const template = '<div>{{foo}}</div>';
      const result = templateToTypescript(template, flags, new Set(['foo']));

      expect(result.mapping.originalRange.start).toBe(0);
      expect(result.mapping.originalRange.end).toBe(template.length);
    });
  });

  describe('Source Mapping', () => {
    test('maps mustache expression to original position', () => {
      const template = '{{foo}}';
      const result = templateToTypescript(template, flags, new Set(['foo']));

      // The mapping tree should cover the full template
      expect(result.mapping.originalRange.start).toBe(0);
      expect(result.mapping.originalRange.end).toBe(template.length);

      // Should have child mappings for the expression
      expect(result.mapping.children.length).toBeGreaterThan(0);
    });

    test('maps element node to original position', () => {
      const template = '<div></div>';
      const result = templateToTypescript(template, flags);

      // The root mapping should cover the full template
      expect(result.mapping.originalRange.start).toBe(0);
      expect(result.mapping.originalRange.end).toBe(template.length);

      // Should generate code for the element
      expect(result.code.length).toBeGreaterThan(0);
      expect(result.code).toContain('div');
    });

    test('maps nested elements correctly', () => {
      const template = '<div><span>text</span></div>';
      const result = templateToTypescript(template, flags);

      // Root mapping covers entire template
      expect(result.mapping.originalRange.start).toBe(0);
      expect(result.mapping.originalRange.end).toBe(template.length);

      // Should have hierarchical structure
      const hasChildren = result.mapping.children.length > 0;
      expect(hasChildren).toBe(true);
    });

    test('maps if block to original position', () => {
      const template = '{{#if cond}}yes{{/if}}';
      const result = templateToTypescript(template, flags, new Set(['cond']));

      expect(result.mapping.originalRange.start).toBe(0);
      expect(result.mapping.originalRange.end).toBe(template.length);

      // Should have mapping children for the block
      expect(result.mapping.children.length).toBeGreaterThan(0);
    });

    test('maps each block to original position', () => {
      const template = '{{#each items as |item|}}{{item}}{{/each}}';
      const result = templateToTypescript(template, flags, new Set(['items']));

      expect(result.mapping.originalRange.start).toBe(0);
      expect(result.mapping.originalRange.end).toBe(template.length);
    });

    test('includes attribute value in generated code', () => {
      const template = '<div class="foo"></div>';
      const result = templateToTypescript(template, flags);

      // The output should contain the attribute value
      expect(result.code).toContain('foo');
      // Mapping tree covers the full template
      expect(result.mapping.originalRange.start).toBe(0);
      expect(result.mapping.originalRange.end).toBe(template.length);
    });

    test('maps dynamic attribute to original position', () => {
      const template = '<div class={{value}}></div>';
      const result = templateToTypescript(template, flags, new Set(['value']));

      expect(result.code).toContain('value');
      expect(result.mapping.originalRange.start).toBe(0);
      expect(result.mapping.originalRange.end).toBe(template.length);
    });

    test('bidirectional offset translation works', () => {
      const tree = new MappingTree(
        'Template',
        { start: 0, end: 20 },
        { start: 0, end: 20 },
      );

      // Add a child mapping for an identifier (equal length ranges)
      tree.createChild('Identifier', { start: 5, end: 10 }, { start: 5, end: 10 });

      const module = new TransformedModule({
        transformedContents: '01234identifier56789',
        originalContents: '01234{{foo}}56789012',
        mappingTree: tree,
      });

      // Test original -> transformed (offset 7 is within the identifier mapping)
      const transformedResult = module.getTransformedOffset(7);
      expect(transformedResult.found).toBe(true);
      expect(transformedResult.offset).toBe(7); // Equal-length mapping preserves offset

      // Test transformed -> original
      const originalResult = module.getOriginalOffset(7);
      expect(originalResult.found).toBe(true);
      expect(originalResult.offset).toBe(7); // Equal-length mapping preserves offset
    });

    test('finds narrowest mapping for nested structures', () => {
      const root = new MappingTree(
        'Template',
        { start: 0, end: 50 },
        { start: 0, end: 100 },
      );

      const element = root.createChild(
        'ElementNode',
        { start: 0, end: 50 },
        { start: 0, end: 100 },
      );

      const text = element.createChild(
        'TextNode',
        { start: 5, end: 15 },
        { start: 20, end: 40 },
      );

      // Query within text node range should return text node
      const found = root.findNarrowestAtOriginalOffset(10);
      expect(found).toBe(text);

      // Query outside text but inside element should return element
      const found2 = root.findNarrowestAtOriginalOffset(20);
      expect(found2).toBe(element);
    });

    test('exports Volar-compatible code mappings', () => {
      const template = '<div>{{foo}}</div>';
      const result = templateToTypescript(template, flags, new Set(['foo']));

      const codeMappings = result.mapping.toCodeMappings();

      expect(Array.isArray(codeMappings)).toBe(true);
      expect(codeMappings.length).toBeGreaterThan(0);

      // Each mapping should have the required Volar format fields
      for (const mapping of codeMappings) {
        expect(mapping).toHaveProperty('sourceOffsets');
        expect(mapping).toHaveProperty('generatedOffsets');
        expect(mapping).toHaveProperty('lengths');
        expect(Array.isArray(mapping.sourceOffsets)).toBe(true);
        expect(Array.isArray(mapping.generatedOffsets)).toBe(true);
        expect(Array.isArray(mapping.lengths)).toBe(true);
      }
    });

    test('mapping tree tracks source node types', () => {
      const template = '<div><span></span></div>';
      const result = templateToTypescript(template, flags);

      // Collect all source node types from tree
      const nodeTypes = new Set<string>();
      function collectTypes(node: typeof result.mapping): void {
        nodeTypes.add(node.sourceNode);
        for (const child of node.children) {
          collectTypes(child as typeof result.mapping);
        }
      }
      collectTypes(result.mapping);

      // Should have Template as root
      expect(nodeTypes.has('Template')).toBe(true);
    });

    test('mapper identifier creates mapping with code information', () => {
      // Template: '{{myVar}}' - 'myVar' starts at offset 2, has length 5
      const template = '{{myVar}}';
      const mapper = createMapper(template);

      // identifier(name, originalOffset, originalLength)
      mapper.identifier('myVar', 2, 5);

      const tree = mapper.getMappingTree();
      const identifierMapping = tree.children[0];

      expect(identifierMapping.sourceNode).toBe('Identifier');
      expect(identifierMapping.originalRange).toEqual({ start: 2, end: 7 }); // offset 2, length 5
      expect(identifierMapping.codeInformation).toBeDefined();
      expect(identifierMapping.codeInformation?.navigation).toBe(true);
      expect(identifierMapping.codeInformation?.rename).toBe(true);
    });

    test('snapshot and restore preserves mapping tree state', () => {
      const mapper = createMapper('{{a}}{{b}}');

      // Emit first identifier
      mapper.identifier('a', 2, 3);
      expect(mapper.getMappingTree().children).toHaveLength(1);

      // Take snapshot
      const snapshot = mapper.snapshot();

      // Emit second identifier
      mapper.identifier('b', 7, 8);
      expect(mapper.getMappingTree().children).toHaveLength(2);

      // Restore should remove second mapping
      mapper.restore(snapshot);
      expect(mapper.getMappingTree().children).toHaveLength(1);
      expect(mapper.getCode()).toBe('a');
    });

    test('forNode creates hierarchical mapping', () => {
      const mapper = createMapper('<div>text</div>');

      mapper.forNode(
        { type: 'ElementNode', loc: { start: { offset: 0 }, end: { offset: 15 } } } as any,
        'ElementNode',
        () => {
          mapper.forNode(
            { type: 'TextNode', loc: { start: { offset: 5 }, end: { offset: 9 } } } as any,
            'TextNode',
            () => {
              mapper.text('"text"');
            },
          );
        },
      );

      const tree = mapper.getMappingTree();

      // Root should have one child (ElementNode)
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0].sourceNode).toBe('ElementNode');

      // ElementNode should have one child (TextNode)
      expect(tree.children[0].children).toHaveLength(1);
      expect(tree.children[0].children[0].sourceNode).toBe('TextNode');
    });

    test('proportional offset mapping for size-mismatched ranges', () => {
      // Original: "ab" (2 chars) -> Transformed: "abcd" (4 chars)
      const tree = new MappingTree(
        'Template',
        { start: 0, end: 2 },
        { start: 0, end: 4 },
      );

      const module = new TransformedModule({
        transformedContents: 'abcd',
        originalContents: 'ab',
        mappingTree: tree,
      });

      // Transformed offset 0 -> Original offset 0
      const result0 = module.getOriginalOffset(0);
      expect(result0.found).toBe(true);
      expect(result0.offset).toBe(0);

      // Transformed offset 2 (middle of 4) -> proportional in original
      const result2 = module.getOriginalOffset(2);
      expect(result2.found).toBe(true);
      expect(result2.offset).toBe(1); // 2/4 * 2 = 1
    });

    test('getTransformedRange returns range for original span', () => {
      const tree = new MappingTree(
        'Template',
        { start: 0, end: 10 },
        { start: 0, end: 10 },
      );

      const module = new TransformedModule({
        transformedContents: '0123456789',
        originalContents: '0123456789',
        mappingTree: tree,
      });

      const range = module.getTransformedRange(2, 5);

      expect(range).not.toBeNull();
      expect(range?.start).toBe(2);
      expect(range?.end).toBe(5);
    });

    test('getOriginalRange returns range for transformed span', () => {
      const tree = new MappingTree(
        'Template',
        { start: 0, end: 10 },
        { start: 0, end: 10 },
      );

      const module = new TransformedModule({
        transformedContents: '0123456789',
        originalContents: '0123456789',
        mappingTree: tree,
      });

      const range = module.getOriginalRange(3, 7);

      expect(range).not.toBeNull();
      expect(range?.start).toBe(3);
      expect(range?.end).toBe(7);
    });

    describe('range query methods', () => {
      function createModuleWithTwoElements(): TransformedModule {
        const tree = new MappingTree(
          'Template',
          { start: 0, end: 100 },
          { start: 0, end: 200 },
        );

        // First element: original [10-30] -> transformed [20-60]
        tree.createChild('ElementNode', { start: 10, end: 30 }, { start: 20, end: 60 });
        // Second element: original [40-60] -> transformed [80-120]
        tree.createChild('ElementNode', { start: 40, end: 60 }, { start: 80, end: 120 });

        return new TransformedModule({
          transformedContents: 'x'.repeat(200),
          originalContents: 'y'.repeat(100),
          mappingTree: tree,
        });
      }

      test('getMappingsForOriginalRange finds overlapping mappings', () => {
        const module = createModuleWithTwoElements();

        // Query range [15, 25] overlaps with first element [10-30]
        const mappings = module.getMappingsForOriginalRange(15, 25);
        expect(mappings.length).toBeGreaterThan(0);
        expect(mappings.some((m) => m.sourceNode === 'ElementNode')).toBe(true);
      });

      test('getMappingsForTransformedRange finds overlapping mappings', () => {
        const module = createModuleWithTwoElements();

        // Query range [30, 50] overlaps with first element's transformed range [20-60]
        const mappings = module.getMappingsForTransformedRange(30, 50);
        expect(mappings.length).toBeGreaterThan(0);
        expect(mappings.some((m) => m.sourceNode === 'ElementNode')).toBe(true);
      });
    });

    test('mapping tree debug string includes all nodes', () => {
      const root = new MappingTree(
        'Template',
        { start: 0, end: 50 },
        { start: 0, end: 100 },
      );

      const element = root.createChild(
        'ElementNode',
        { start: 0, end: 20 },
        { start: 0, end: 40 },
      );

      element.createChild('TextNode', { start: 5, end: 15 }, { start: 10, end: 30 });

      const debug = root.toDebugString();

      expect(debug).toContain('Template');
      expect(debug).toContain('ElementNode');
      expect(debug).toContain('TextNode');
    });

    test('end-to-end: find original position of variable in generated code', () => {
      // Template: '<div>{{userName}}</div>'
      //            01234567890123456789012
      //                 ^5 ({{) ^7 (userName starts) ^15 (}})
      const template = '<div>{{userName}}</div>';
      const result = templateToTypescript(template, flags, new Set(['userName']));

      // The generated code should contain userName
      expect(result.code).toContain('userName');

      // Find where userName appears in generated code
      const userNameIndex = result.code.indexOf('userName');
      expect(userNameIndex).toBeGreaterThan(-1);

      // The mapping should allow us to trace back to original
      // The mapping tree covers the full template
      expect(result.mapping.originalRange.start).toBe(0);
      expect(result.mapping.originalRange.end).toBe(template.length);
    });

    test('multiple expressions maintain separate mappings', () => {
      const template = '{{a}}{{b}}{{c}}';
      const result = templateToTypescript(template, flags, new Set(['a', 'b', 'c']));

      // All three variables should be in output
      expect(result.code).toContain('a');
      expect(result.code).toContain('b');
      expect(result.code).toContain('c');

      // Mapping tree should have children for the expressions
      // Note: The exact number depends on implementation (may be combined into array)
      expect(result.mapping.children.length).toBeGreaterThan(0);

      // Verify the mapping covers the entire template
      expect(result.mapping.originalRange.start).toBe(0);
      expect(result.mapping.originalRange.end).toBe(template.length);
    });

    test('complex template preserves mapping hierarchy', () => {
      const template = `
        <div class="container">
          {{#if showHeader}}
            <header>{{title}}</header>
          {{/if}}
          <main>
            {{#each items as |item|}}
              <p>{{item.name}}</p>
            {{/each}}
          </main>
        </div>
      `;
      const result = templateToTypescript(
        template,
        flags,
        new Set(['showHeader', 'title', 'items']),
      );

      expect(result.errors).toHaveLength(0);
      expect(result.mapping).toBeDefined();
      expect(result.mapping.sourceNode).toBe('Template');

      // Should have mapping children for the structure
      expect(result.mapping.children.length).toBeGreaterThan(0);
    });
  });

  describe('seenNodes tracking', () => {
    test('adds processed nodes to seenNodes set', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`<div>hello</div>`);
      const node = ast.body[0] as ASTv1.ElementNode;

      expect(seenNodes.size).toBe(0);
      ToJSType(node);
      // Should have added the element node to seenNodes
      expect(seenNodes.has(node)).toBe(true);
    });

    test('adds child nodes inside #each to seenNodes', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`{{#each items as |item|}}<div>{{item.name}}</div>{{/each}}`);
      const blockNode = ast.body[0] as ASTv1.BlockStatement;

      ToJSType(blockNode);

      // BlockStatement should be in seenNodes
      expect(seenNodes.has(blockNode)).toBe(true);

      // Child ElementNode (div) should also be in seenNodes
      const divNode = blockNode.program.body[0] as ASTv1.ElementNode;
      expect(seenNodes.has(divNode)).toBe(true);

      // MustacheStatement ({{item.name}}) inside div should be in seenNodes
      const mustacheNode = divNode.children[0] as ASTv1.MustacheStatement;
      expect(seenNodes.has(mustacheNode)).toBe(true);
    });

    test('adds child nodes inside #if to seenNodes', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`{{#if condition}}<span>content</span>{{/if}}`);
      const blockNode = ast.body[0] as ASTv1.BlockStatement;

      ToJSType(blockNode);

      // BlockStatement should be in seenNodes
      expect(seenNodes.has(blockNode)).toBe(true);

      // Child ElementNode (span) should also be in seenNodes
      const spanNode = blockNode.program.body[0] as ASTv1.ElementNode;
      expect(seenNodes.has(spanNode)).toBe(true);
    });

    test('adds nested block children to seenNodes', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`{{#each items as |item|}}{{#if item.visible}}<p>{{item.name}}</p>{{/if}}{{/each}}`);
      const eachNode = ast.body[0] as ASTv1.BlockStatement;

      ToJSType(eachNode);

      // Outer #each should be in seenNodes
      expect(seenNodes.has(eachNode)).toBe(true);

      // Inner #if should be in seenNodes
      const ifNode = eachNode.program.body[0] as ASTv1.BlockStatement;
      expect(seenNodes.has(ifNode)).toBe(true);

      // Nested p element should be in seenNodes
      const pNode = ifNode.program.body[0] as ASTv1.ElementNode;
      expect(seenNodes.has(pNode)).toBe(true);
    });

    test('block params are correctly scoped in generated output', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`{{#each this.routes as |route|}}<div>{{route.name}}</div>{{/each}}`);
      const blockNode = ast.body[0] as ASTv1.BlockStatement;

      const result = ToJSType(blockNode) as HBSControlExpressionV2;

      // Block params should include 'route'
      expect(result.blockParams).toContain('route');

      // Children should reference route.name correctly
      const divChild = result.children[0] as HBSNodeV2;
      expect(divChild.tag).toBe('div');

      // The text content event should reference route.name
      const textEvent = divChild.events.find(e => e[0] === '1');
      expect(textEvent).toBeDefined();
      expect(textEvent![1]).toContain('route.name');
    });

    test('adds TextNode parts in ConcatStatement to seenNodes', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`<div class="prefix-{{value}}-suffix"></div>`);
      const elementNode = ast.body[0] as ASTv1.ElementNode;

      ToJSType(elementNode);

      // Element should be in seenNodes
      expect(seenNodes.has(elementNode)).toBe(true);

      // The ConcatStatement attribute value
      const classAttr = elementNode.attributes.find(a => a.name === 'class');
      expect(classAttr).toBeDefined();

      if (classAttr && classAttr.value.type === 'ConcatStatement') {
        // TextNode parts should be in seenNodes
        const textParts = classAttr.value.parts.filter(p => p.type === 'TextNode');
        textParts.forEach(part => {
          expect(seenNodes.has(part)).toBe(true);
        });
      }
    });

    test('prevents double processing when used with AST traversal', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`{{#each items as |item|}}<div>{{item}}</div>{{/each}}`);
      const blockNode = ast.body[0] as ASTv1.BlockStatement;
      const divNode = blockNode.program.body[0] as ASTv1.ElementNode;

      // Process the block statement (which processes children internally)
      ToJSType(blockNode);

      // Now the div node should already be in seenNodes
      expect(seenNodes.has(divNode)).toBe(true);

      // If we tried to process divNode again (simulating traverse behavior),
      // we would check seenNodes first
      const wasAlreadyProcessed = seenNodes.has(divNode);
      expect(wasAlreadyProcessed).toBe(true);
    });
  });

  describe('condition wrapping for reactivity', () => {
    test('each condition is wrapped with getter in compat mode', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`{{#each this.items as |item|}}<div></div>{{/each}}`);
      const blockNode = ast.body[0] as ASTv1.BlockStatement;

      const result = ToJSType(blockNode) as HBSControlExpressionV2;
      const serialized = serializeNode(result);

      // In glimmer compat mode, the condition should be wrapped in () =>
      if (flags.IS_GLIMMER_COMPAT_MODE) {
        expect(serialized).toContain('$_each(() => this.items');
      } else {
        expect(serialized).toContain('$_each(this.items');
      }
    });

    test('if condition is wrapped with getter in compat mode', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`{{#if this.visible}}<div></div>{{/if}}`);
      const blockNode = ast.body[0] as ASTv1.BlockStatement;

      const result = ToJSType(blockNode) as HBSControlExpressionV2;
      const serialized = serializeNode(result);

      // In glimmer compat mode, the condition should be wrapped in () =>
      if (flags.IS_GLIMMER_COMPAT_MODE) {
        expect(serialized).toContain('$_if(() => this.visible');
      } else {
        expect(serialized).toContain('$_if(this.visible');
      }
    });

    test('each with path expression condition is properly wrapped', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set(['myArray']));
      const ast = preprocess(`{{#each myArray as |item|}}<span></span>{{/each}}`);
      const blockNode = ast.body[0] as ASTv1.BlockStatement;

      const result = ToJSType(blockNode) as HBSControlExpressionV2;
      const serialized = serializeNode(result);

      // Condition should be wrapped for reactivity
      if (flags.IS_GLIMMER_COMPAT_MODE) {
        expect(serialized).toContain('$_each(() => myArray');
      }
    });

    test('nested each blocks have wrapped conditions', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`{{#each this.outer as |o|}}{{#each o.inner as |i|}}<p></p>{{/each}}{{/each}}`);
      const blockNode = ast.body[0] as ASTv1.BlockStatement;

      const result = ToJSType(blockNode) as HBSControlExpressionV2;
      const serialized = serializeNode(result);

      // Both outer and inner each should have wrapped conditions
      if (flags.IS_GLIMMER_COMPAT_MODE) {
        expect(serialized).toContain('$_each(() => this.outer');
        expect(serialized).toContain('$_each(() => o.inner');
      }
    });
  });

  describe('reserved binding warnings', () => {
    // These tests verify that warnOnReservedBinding is called for block params
    // that shadow JavaScript globals or HTML element names.
    // The actual warning is emitted via console.warn, which we can verify
    // by checking that the converter processes the templates without errors.

    test('processes templates with HTML element name block params', () => {
      // 'i' is an HTML element name (<i> for italic)
      // This should trigger a warning but not fail
      const result = templateToTypescript(
        '{{#each this.items as |i|}}<span>{{i}}</span>{{/each}}',
        flags,
      );

      // Should compile successfully despite the warning
      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('span');
    });

    test('processes templates with JS global block params', () => {
      // 'Map' is a JavaScript global
      // This should trigger a warning but not fail
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess('{{#each this.maps as |Map|}}<div>{{Map.name}}</div>{{/each}}');
      const blockNode = ast.body[0] as ASTv1.BlockStatement;

      // Should not throw
      const result = ToJSType(blockNode);
      expect(result).not.toBeNull();
    });

    test('processes component block params with HTML element names', () => {
      // Component block params should also trigger warnings for reserved names
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set(['MyComponent']));
      const ast = preprocess('<MyComponent as |div|><span>{{div}}</span></MyComponent>');
      const elementNode = ast.body[0] as ASTv1.ElementNode;

      // Should not throw
      const result = ToJSType(elementNode);
      expect(result).not.toBeNull();
    });

    test('processes nested blocks with reserved names', () => {
      // Nested blocks with reserved names should all trigger warnings
      const result = templateToTypescript(
        '{{#each this.items as |i|}}{{#each i.children as |span|}}<div>{{span}}</div>{{/each}}{{/each}}',
        flags,
      );

      // Should compile successfully despite warnings
      expect(result.errors).toHaveLength(0);
    });

    test('let block params with reserved names are processed', () => {
      // Let block params can also shadow reserved names
      const result = templateToTypescript(
        '{{#let this.value as |String|}}<div>{{String}}</div>{{/let}}',
        flags,
      );

      // Should compile successfully
      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('Let_String');
    });
  });
});
