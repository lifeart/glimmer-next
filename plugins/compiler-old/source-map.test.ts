import { describe, test, expect } from 'vitest';
import {
  generateSourceMap,
  generateEmptySourceMap,
  createIdentityMap,
  shiftSourceMap,
  sourceMapToDataUrl,
  appendSourceMapComment,
} from './source-map';
import { MappingTree } from './mapping-tree';

describe('Source Map Generation', () => {
  describe('generateSourceMap', () => {
    test('generates source map from mapping tree', () => {
      const originalSource = '<div>hello</div>';
      const generatedSource = '$_tag("div", [], ["hello"])';

      const tree = new MappingTree(
        'Template',
        { start: 0, end: originalSource.length },
        { start: 0, end: generatedSource.length },
      );

      const map = generateSourceMap(
        originalSource,
        generatedSource,
        tree,
        'test.hbs',
        'test.js',
      );

      expect(map.version).toBe(3);
      expect(map.sources).toEqual(['test.hbs']);
      expect(map.sourcesContent).toEqual([originalSource]);
      expect(map.file).toBe('test.js');
      expect(map.names).toEqual([]);
      expect(typeof map.mappings).toBe('string');
    });

    test('handles nested mappings', () => {
      const originalSource = '{{foo}}';
      const generatedSource = '$:foo';

      const tree = new MappingTree(
        'Template',
        { start: 0, end: 7 },
        { start: 0, end: 5 },
      );

      // Add child mapping for the identifier
      tree.createChild('Identifier', { start: 2, end: 5 }, { start: 2, end: 5 });

      const map = generateSourceMap(
        originalSource,
        generatedSource,
        tree,
        'test.hbs',
      );

      expect(map.version).toBe(3);
      expect(map.mappings.length).toBeGreaterThan(0);
    });

    test('handles multi-line source', () => {
      const originalSource = '<div>\n  hello\n</div>';
      const generatedSource = '$_tag("div", [], [\n  "hello"\n])';

      const tree = new MappingTree(
        'ElementNode',
        { start: 0, end: originalSource.length },
        { start: 0, end: generatedSource.length },
      );

      const map = generateSourceMap(
        originalSource,
        generatedSource,
        tree,
        'test.hbs',
      );

      // Should have semicolon-separated line mappings
      expect(map.mappings.includes(';')).toBe(true);
    });

    test('handles empty mapping tree', () => {
      const originalSource = '';
      const generatedSource = '[]';

      const tree = new MappingTree(
        'Template',
        { start: 0, end: 0 },
        { start: 0, end: 2 },
      );

      const map = generateSourceMap(
        originalSource,
        generatedSource,
        tree,
        'test.hbs',
      );

      expect(map.version).toBe(3);
      expect(map.sources).toEqual(['test.hbs']);
    });
  });

  describe('generateEmptySourceMap', () => {
    test('creates empty source map', () => {
      const source = 'const x = 1;';
      const map = generateEmptySourceMap(source, 'test.js');

      expect(map.version).toBe(3);
      expect(map.sources).toEqual(['test.js']);
      expect(map.sourcesContent).toEqual([source]);
    });
  });

  describe('createIdentityMap', () => {
    test('creates identity mapping for single line', () => {
      const source = 'const x = 1;';
      const map = createIdentityMap(source, 'test.js');

      expect(map.version).toBe(3);
      expect(map.sources).toEqual(['test.js']);
      expect(map.mappings).toBe('AAAA');
    });

    test('creates identity mapping for multiple lines', () => {
      const source = 'const x = 1;\nconst y = 2;';
      const map = createIdentityMap(source, 'test.js');

      expect(map.version).toBe(3);
      expect(map.mappings).toBe('AAAA;AACA');
    });

    test('handles empty lines', () => {
      const source = 'line1\n\nline3';
      const map = createIdentityMap(source, 'test.js');

      expect(map.version).toBe(3);
      // First line: AAAA, empty line: empty, third line: AACA
      expect(map.mappings).toBe('AAAA;;AACA');
    });
  });

  describe('shiftSourceMap', () => {
    test('shifts mappings by line offset', () => {
      const map = createIdentityMap('const x = 1;', 'test.js');
      const shifted = shiftSourceMap(map, 3);

      // Should have 3 empty lines before the original mappings
      expect(shifted.mappings.startsWith(';;;')).toBe(true);
    });

    test('returns same map for zero offset', () => {
      const map = createIdentityMap('const x = 1;', 'test.js');
      const shifted = shiftSourceMap(map, 0);

      expect(shifted).toBe(map);
    });
  });

  describe('sourceMapToDataUrl', () => {
    test('converts source map to data URL', () => {
      const map = createIdentityMap('const x = 1;', 'test.js');
      const dataUrl = sourceMapToDataUrl(map);

      expect(dataUrl.startsWith('data:application/json;charset=utf-8;base64,')).toBe(
        true,
      );

      // Decode and verify
      const base64 = dataUrl.replace('data:application/json;charset=utf-8;base64,', '');
      const decoded = JSON.parse(Buffer.from(base64, 'base64').toString('utf-8'));

      expect(decoded.version).toBe(3);
      expect(decoded.sources).toEqual(['test.js']);
    });
  });

  describe('appendSourceMapComment', () => {
    test('appends source map as inline comment', () => {
      const code = 'const x = 1;';
      const map = createIdentityMap(code, 'test.js');
      const result = appendSourceMapComment(code, map);

      expect(result.startsWith(code)).toBe(true);
      expect(result).toContain('//# sourceMappingURL=data:application/json');
    });
  });

  describe('VLQ encoding', () => {
    test('encodes simple mappings correctly', () => {
      // Single character source on single line
      const source = 'a';
      const generated = 'b';

      const tree = new MappingTree(
        'ElementNode',
        { start: 0, end: 1 },
        { start: 0, end: 1 },
      );

      const map = generateSourceMap(source, generated, tree, 'test.hbs');

      // AAAA = column 0, source 0, line 0, column 0
      expect(map.mappings).toContain('AAAA');
    });
  });

  describe('names field for identifier resolution', () => {
    test('includes named PathExpression identifier in names array', () => {
      // Simulates: <MyComp /> → $_c(MyComp, ...)
      const originalSource = '<MyComp />';
      const generatedSource = '$_c(MyComp, [], this)';

      const tree = new MappingTree(
        'Template',
        { start: 0, end: originalSource.length },
        { start: 0, end: generatedSource.length },
      );

      // Add ElementNode scope (the whole call)
      const elemChild = tree.createChild(
        'ElementNode',
        { start: 0, end: originalSource.length },
        { start: 0, end: generatedSource.length },
      );

      // Add PathExpression for the tag name (MyComp) with name
      elemChild.createChild(
        'PathExpression',
        { start: 1, end: 7 },
        { start: 4, end: 10 },
        undefined,
        'MyComp',
      );

      const map = generateSourceMap(
        originalSource,
        generatedSource,
        tree,
        'test.gts',
        'test.js',
      );

      expect(map.names).toContain('MyComp');
    });

    test('includes multiple identifiers in names array', () => {
      const originalSource = '<MyComp>{{value}}</MyComp>';
      const generatedSource = '$_c(MyComp, [], [() => value], this)';

      const tree = new MappingTree(
        'Template',
        { start: 0, end: originalSource.length },
        { start: 0, end: generatedSource.length },
      );

      tree.createChild(
        'PathExpression',
        { start: 1, end: 7 },
        { start: 4, end: 10 },
        undefined,
        'MyComp',
      );

      tree.createChild(
        'PathExpression',
        { start: 10, end: 15 },
        { start: 23, end: 28 },
        undefined,
        'value',
      );

      const map = generateSourceMap(
        originalSource,
        generatedSource,
        tree,
        'test.gts',
      );

      expect(map.names).toContain('MyComp');
      expect(map.names).toContain('value');
      expect(map.names.length).toBe(2);
    });

    test('does not add names for nodes without name field', () => {
      const originalSource = '<div>hello</div>';
      const generatedSource = '$_tag("div", [], ["hello"])';

      const tree = new MappingTree(
        'Template',
        { start: 0, end: originalSource.length },
        { start: 0, end: generatedSource.length },
      );

      tree.createChild(
        'ElementNode',
        { start: 0, end: originalSource.length },
        { start: 0, end: generatedSource.length },
      );

      tree.createChild(
        'TextNode',
        { start: 5, end: 10 },
        { start: 19, end: 24 },
      );

      const map = generateSourceMap(
        originalSource,
        generatedSource,
        tree,
        'test.gts',
      );

      expect(map.names).toEqual([]);
    });

    test('deduplicates repeated identifier names', () => {
      const originalSource = '{{foo}} {{foo}}';
      const generatedSource = 'foo, foo';

      const tree = new MappingTree(
        'Template',
        { start: 0, end: originalSource.length },
        { start: 0, end: generatedSource.length },
      );

      tree.createChild(
        'PathExpression',
        { start: 2, end: 5 },
        { start: 0, end: 3 },
        undefined,
        'foo',
      );

      tree.createChild(
        'PathExpression',
        { start: 10, end: 13 },
        { start: 5, end: 8 },
        undefined,
        'foo',
      );

      const map = generateSourceMap(
        originalSource,
        generatedSource,
        tree,
        'test.gts',
      );

      expect(map.names).toEqual(['foo']);
    });

    test('VLQ segments encode 5 fields for named mappings', () => {
      const originalSource = '{{foo}}';
      const generatedSource = 'foo';

      const tree = new MappingTree(
        'Template',
        { start: 0, end: originalSource.length },
        { start: 0, end: generatedSource.length },
      );

      tree.createChild(
        'PathExpression',
        { start: 2, end: 5 },
        { start: 0, end: 3 },
        undefined,
        'foo',
      );

      const map = generateSourceMap(
        originalSource,
        generatedSource,
        tree,
        'test.gts',
      );

      expect(map.names).toEqual(['foo']);
      // Mapping should have 5 VLQ fields: genCol, srcIdx, srcLine, srcCol, nameIdx
      // The start segment maps gen:0 → src:0:2, name:0
      // genCol=0, srcIdx=0, srcLine=0, srcCol=2, nameIdx=0
      // VLQ: A(0) A(0) A(0) E(2) A(0) = "AAAEA"
      expect(map.mappings).toContain('AAAEA');
    });
  });
});
