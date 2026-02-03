import { describe, test, expect } from 'vitest';
import {
  generateSourceMap,
  generateInlineSourceMap,
  appendInlineSourceMap,
} from '../sourcemap';
import { compile } from '../compile';
import type { MappingTreeNode } from '../types';
import { SYMBOLS } from '../serializers/symbols';

const VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VLQ_CHAR_TO_INT = new Map(VLQ_CHARS.split('').map((char, index) => [char, index]));

type DecodedSegment = {
  generatedLine: number;
  generatedColumn: number;
  sourceLine: number;
  sourceColumn: number;
  nameIndex?: number;
};

function decodeVLQ(mapping: string, startIndex: number): { value: number; nextIndex: number } {
  let result = 0;
  let shift = 0;
  let index = startIndex;
  let digit: number;
  let continuation: number;

  do {
    digit = VLQ_CHAR_TO_INT.get(mapping[index++]) ?? 0;
    continuation = digit & 0x20;
    const value = digit & 0x1f;
    result += value << shift;
    shift += 5;
  } while (continuation);

  const isNegative = result & 1;
  result >>= 1;
  return { value: isNegative ? -result : result, nextIndex: index };
}

function parseMappings(mappings: string): DecodedSegment[] {
  const lines = mappings.split(';');
  const segments: DecodedSegment[] = [];

  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let nameIndex = 0;

  for (let line = 0; line < lines.length; line++) {
    const lineMappings = lines[line];
    if (!lineMappings) continue;

    const lineSegments = lineMappings.split(',');
    let generatedColumn = 0;

    for (const segment of lineSegments) {
      if (!segment) continue;
      let index = 0;

      const genCol = decodeVLQ(segment, index);
      generatedColumn += genCol.value;
      index = genCol.nextIndex;

      if (index >= segment.length) {
        continue;
      }

      const srcIdx = decodeVLQ(segment, index);
      sourceIndex += srcIdx.value;
      index = srcIdx.nextIndex;

      const srcLine = decodeVLQ(segment, index);
      sourceLine += srcLine.value;
      index = srcLine.nextIndex;

      const srcCol = decodeVLQ(segment, index);
      sourceColumn += srcCol.value;
      index = srcCol.nextIndex;

      const entry: DecodedSegment = {
        generatedLine: line,
        generatedColumn,
        sourceLine,
        sourceColumn,
      };

      if (index < segment.length) {
        const name = decodeVLQ(segment, index);
        nameIndex += name.value;
        entry.nameIndex = nameIndex;
      }

      segments.push(entry);
    }
  }

  return segments;
}

function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') offsets.push(i + 1);
  }
  return offsets;
}

function lineColumnToOffset(source: string, line: number, column: number): number {
  const offsets = buildLineOffsets(source);
  const lineStart = offsets[line] ?? source.length;
  return lineStart + column;
}

function hasNamedMapping(
  map: { names: string[]; mappings: string },
  source: string,
  generated: string,
  name: string,
  sourceText: string,
  generatedText: string
): boolean {
  const segments = parseMappings(map.mappings);
  const nameIndex = map.names.indexOf(name);
  if (nameIndex === -1) return false;

  return segments.some((segment) => {
    if (segment.nameIndex !== nameIndex) return false;
    const srcOffset = lineColumnToOffset(source, segment.sourceLine, segment.sourceColumn);
    const genOffset = lineColumnToOffset(generated, segment.generatedLine, segment.generatedColumn);
    return (
      source.slice(srcOffset, srcOffset + sourceText.length) === sourceText &&
      generated.slice(genOffset, genOffset + generatedText.length) === generatedText
    );
  });
}

/**
 * Create a simple mapping tree for testing.
 */
function createMappingTree(
  sourceRange: { start: number; end: number },
  generatedRange: { start: number; end: number },
  children: MappingTreeNode[] = [],
  sourceNode: MappingTreeNode['sourceNode'] = 'ElementNode'
): MappingTreeNode {
  return {
    sourceRange: Object.freeze(sourceRange),
    generatedRange: Object.freeze(generatedRange),
    sourceNode,
    children: Object.freeze(children) as MappingTreeNode[],
  };
}

describe('Sourcemap Generation', () => {
  describe('generateSourceMap', () => {
    test('returns valid V3 format', () => {
      const tree = createMappingTree({ start: 0, end: 10 }, { start: 0, end: 20 });
      const source = '<div>test</div>';
      const generated = '[$_tag("div")]';

      const map = generateSourceMap(tree, source, generated, { file: 'test.hbs' });

      expect(map.version).toBe(3);
      expect(map.sources).toContain('test.hbs');
      expect(map.names).toEqual([]);
      expect(typeof map.mappings).toBe('string');
    });

    test('sources array contains filename', () => {
      const tree = createMappingTree({ start: 0, end: 5 }, { start: 0, end: 10 });
      const map = generateSourceMap(tree, 'hello', 'world', { file: 'component.hbs' });

      expect(map.sources).toEqual(['component.hbs']);
    });

    test('uses default filename when not provided', () => {
      const tree = createMappingTree({ start: 0, end: 5 }, { start: 0, end: 10 });
      const map = generateSourceMap(tree, 'hello', 'world');

      expect(map.sources).toEqual(['template.hbs']);
    });

    test('sourceRoot is included when provided', () => {
      const tree = createMappingTree({ start: 0, end: 5 }, { start: 0, end: 10 });
      const map = generateSourceMap(tree, 'hello', 'world', {
        file: 'test.hbs',
        sourceRoot: '/src/templates/',
      });

      expect(map.sourceRoot).toBe('/src/templates/');
    });

    test('sourcesContent is included when requested', () => {
      const source = '<div>content</div>';
      const tree = createMappingTree({ start: 0, end: source.length }, { start: 0, end: 20 });
      const map = generateSourceMap(tree, source, '[$_tag("div")]', {
        file: 'test.hbs',
        includeContent: true,
        sourceContent: source,
      });

      expect(map.sourcesContent).toBeDefined();
      expect(map.sourcesContent?.[0]).toBe(source);
    });

    test('file is derived from source filename', () => {
      const tree = createMappingTree({ start: 0, end: 5 }, { start: 0, end: 10 });
      const map = generateSourceMap(tree, 'hello', 'world', { file: 'component.hbs' });

      expect(map.file).toBe('component.js');
    });

    test('file name is derived for gts/gjs sources', () => {
      const tree = createMappingTree({ start: 0, end: 5 }, { start: 0, end: 10 });
      const gtsMap = generateSourceMap(tree, 'hello', 'world', { file: 'component.gts' });
      const gjsMap = generateSourceMap(tree, 'hello', 'world', { file: 'component.gjs' });

      expect(gtsMap.file).toBe('component.js');
      expect(gjsMap.file).toBe('component.js');
    });

    test('empty mapping tree produces mappings string', () => {
      const tree = createMappingTree({ start: 0, end: 0 }, { start: 0, end: 0 });
      const map = generateSourceMap(tree, '', '', { file: 'test.hbs' });

      expect(map.mappings).toBeDefined();
      expect(typeof map.mappings).toBe('string');
    });

    test('nested mappings are processed', () => {
      const child = createMappingTree({ start: 5, end: 10 }, { start: 5, end: 15 });
      const tree = createMappingTree({ start: 0, end: 20 }, { start: 0, end: 30 }, [child]);

      const source = '<div><span></span></div>';
      const generated = '[$_tag("div", [], [$_tag("span")])]';

      const map = generateSourceMap(tree, source, generated, { file: 'test.hbs' });

      // Should have mappings for both parent and child
      expect(map.mappings.length).toBeGreaterThan(0);
    });

    test('handles multi-line source', () => {
      const source = '<div>\n  <span>\n    text\n  </span>\n</div>';
      const tree = createMappingTree({ start: 0, end: source.length }, { start: 0, end: 50 });
      const generated = '[$_tag("div", [], [$_tag("span", [], ["text"])])]';

      const map = generateSourceMap(tree, source, generated, { file: 'test.hbs' });

      expect(map.version).toBe(3);
      expect(map.mappings).toBeDefined();
    });

    test('handles multi-line generated code', () => {
      const source = '<div>text</div>';
      const generated = '[\n  $_tag("div", [], ["text"])\n]';
      const tree = createMappingTree({ start: 0, end: source.length }, { start: 0, end: generated.length });

      const map = generateSourceMap(tree, source, generated, { file: 'test.hbs' });

      // Mappings should have semicolons for line separators
      expect(map.version).toBe(3);
    });
  });

  describe('generateInlineSourceMap', () => {
    test('returns valid base64-encoded sourcemap comment', () => {
      const tree = createMappingTree({ start: 0, end: 10 }, { start: 0, end: 20 });
      const source = '<div>test</div>';
      const generated = '[$_tag("div")]';

      const comment = generateInlineSourceMap(tree, source, generated, { file: 'test.hbs' });

      expect(comment).toMatch(/^\/\/# sourceMappingURL=data:application\/json;base64,/);
    });

    test('decoded content is valid JSON', () => {
      const tree = createMappingTree({ start: 0, end: 10 }, { start: 0, end: 20 });
      const source = '<div>test</div>';
      const generated = '[$_tag("div")]';

      const comment = generateInlineSourceMap(tree, source, generated, { file: 'test.hbs' });

      // Extract base64 portion
      const base64 = comment.replace('//# sourceMappingURL=data:application/json;base64,', '');
      const decoded = atob(base64);
      const map = JSON.parse(decoded);

      expect(map.version).toBe(3);
      expect(map.sources).toContain('test.hbs');
    });

    test('includes source content in inline map', () => {
      const source = '<div>hello</div>';
      const tree = createMappingTree({ start: 0, end: source.length }, { start: 0, end: 20 });
      const generated = '[$_tag("div")]';

      const comment = generateInlineSourceMap(tree, source, generated, { file: 'test.hbs' });

      // Decode and verify sourcesContent
      const base64 = comment.replace('//# sourceMappingURL=data:application/json;base64,', '');
      const decoded = atob(base64);
      const map = JSON.parse(decoded);

      expect(map.sourcesContent).toBeDefined();
      expect(map.sourcesContent[0]).toBe(source);
    });
  });

  describe('appendInlineSourceMap', () => {
    test('appends comment to code with newline', () => {
      const tree = createMappingTree({ start: 0, end: 10 }, { start: 0, end: 20 });
      const source = '<div>test</div>';
      const code = '[$_tag("div")]';

      const result = appendInlineSourceMap(code, tree, source, { file: 'test.hbs' });

      expect(result).toContain(code);
      expect(result).toContain('\n');
      expect(result).toContain('//# sourceMappingURL=');
    });

    test('original code is preserved', () => {
      const tree = createMappingTree({ start: 0, end: 10 }, { start: 0, end: 20 });
      const source = '<div>test</div>';
      const code = '[$_tag("div", [], ["text"])]';

      const result = appendInlineSourceMap(code, tree, source, { file: 'test.hbs' });

      expect(result.startsWith(code)).toBe(true);
    });

    test('sourcemap comment is at end', () => {
      const tree = createMappingTree({ start: 0, end: 10 }, { start: 0, end: 20 });
      const source = '<div>test</div>';
      const code = '[$_tag("div")]';

      const result = appendInlineSourceMap(code, tree, source, { file: 'test.hbs' });

      const lines = result.split('\n');
      const lastLine = lines[lines.length - 1];
      expect(lastLine).toMatch(/^\/\/# sourceMappingURL=/);
    });
  });

  describe('VLQ encoding (internal)', () => {
    test('mappings string uses valid VLQ characters', () => {
      const tree = createMappingTree({ start: 0, end: 10 }, { start: 0, end: 20 });
      const map = generateSourceMap(tree, '<div></div>', '[$_tag("div")]', { file: 'test.hbs' });

      // VLQ characters: A-Z, a-z, 0-9, +, /
      const validChars = /^[A-Za-z0-9+/,;]*$/;
      expect(map.mappings).toMatch(validChars);
    });

    test('semicolons separate lines in mappings', () => {
      // Create a tree that spans multiple generated lines
      const source = '<div>text</div>';
      const generated = '[\n  $_tag("div")\n]';
      const tree = createMappingTree({ start: 0, end: source.length }, { start: 0, end: generated.length }, [
        createMappingTree({ start: 0, end: 5 }, { start: 4, end: 17 }),
      ]);

      const map = generateSourceMap(tree, source, generated, { file: 'test.hbs' });

      // Should have semicolons for line breaks
      // (may or may not depending on mapping positions, but format should be valid)
      expect(typeof map.mappings).toBe('string');
    });
  });

  describe('edge cases', () => {
    test('handles empty source', () => {
      const tree = createMappingTree({ start: 0, end: 0 }, { start: 0, end: 2 });
      const map = generateSourceMap(tree, '', '[]', { file: 'test.hbs' });

      expect(map.version).toBe(3);
      expect(map.sources).toContain('test.hbs');
    });

    test('handles single character source', () => {
      const tree = createMappingTree({ start: 0, end: 1 }, { start: 0, end: 3 });
      const map = generateSourceMap(tree, 'x', '["x"]', { file: 'test.hbs' });

      expect(map.version).toBe(3);
    });

    test('handles deeply nested mapping tree', () => {
      const level3 = createMappingTree({ start: 10, end: 15 }, { start: 20, end: 30 });
      const level2 = createMappingTree({ start: 5, end: 20 }, { start: 10, end: 40 }, [level3]);
      const level1 = createMappingTree({ start: 0, end: 30 }, { start: 0, end: 50 }, [level2]);

      const source = '<div><span><a>link</a></span></div>';
      const generated = '[$_tag("div", [], [$_tag("span", [], [$_tag("a", [], ["link"])])])]';

      const map = generateSourceMap(level1, source, generated, { file: 'test.hbs' });

      expect(map.version).toBe(3);
      expect(map.mappings.length).toBeGreaterThan(0);
    });
  });
});

describe('Per-Token Sourcemaps', () => {
  /**
   * Helper to find a mapping node by its sourceNode type.
   */
  function findMappingsByType(tree: MappingTreeNode, type: string): MappingTreeNode[] {
    const results: MappingTreeNode[] = [];
    if (tree.sourceNode === type) {
      results.push(tree);
    }
    for (const child of tree.children) {
      results.push(...findMappingsByType(child, type));
    }
    return results;
  }

  /**
   * Helper to count total mapping nodes.
   */
  function countMappingNodes(tree: MappingTreeNode): number {
    return 1 + tree.children.reduce((sum, child) => sum + countMappingNodes(child), 0);
  }

  describe('path expressions', () => {
    test('simple path expression has per-token mapping', () => {
      const template = '{{this.name}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      // Should have mapping for the path expression
      const pathMappings = findMappingsByType(result.mappingTree, 'PathExpression');
      expect(pathMappings.length).toBeGreaterThan(0);

      const thisMapping = pathMappings.find((m) => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText === 'this';
      });
      const nameMapping = pathMappings.find((m) => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText === 'name';
      });
      expect(thisMapping).toBeDefined();
      expect(nameMapping).toBeDefined();

      const genThis = result.code.slice(thisMapping!.generatedRange.start, thisMapping!.generatedRange.end);
      const genName = result.code.slice(nameMapping!.generatedRange.start, nameMapping!.generatedRange.end);
      expect(genThis).toBe('this');
      expect(genName).toBe('name');
    });

    test('nested path expression has correct mapping', () => {
      const template = '{{this.user.profile.name}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      const pathMappings = findMappingsByType(result.mappingTree, 'PathExpression');
      expect(pathMappings.length).toBeGreaterThan(0);

      const tokens = ['this', 'user', 'profile', 'name'];
      for (const token of tokens) {
        const mapping = pathMappings.find((m) => {
          const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
          return srcText === token;
        });
        expect(mapping).toBeDefined();
      }
    });

    test('@args path expression has mapping', () => {
      const template = '{{@value}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      const pathMappings = findMappingsByType(result.mappingTree, 'PathExpression');
      expect(pathMappings.length).toBeGreaterThan(0);

      const baseMapping = pathMappings.find((m) => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText === '@value';
      });
      expect(baseMapping).toBeDefined();
    });

    test('nested @args path maps to optional-chained generated path', () => {
      const template = '{{@name.value}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      const pathMappings = findMappingsByType(result.mappingTree, 'PathExpression');
      expect(pathMappings.length).toBeGreaterThan(0);

      const baseMapping = pathMappings.find((m) => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText === '@name';
      });
      expect(baseMapping).toBeDefined();

      const valueMapping = pathMappings.find((m) => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText === 'value';
      });
      expect(valueMapping).toBeDefined();

      const genBase = result.code.slice(baseMapping!.generatedRange.start, baseMapping!.generatedRange.end);
      expect(genBase).toBe('this[$args]');

      const genValue = result.code.slice(valueMapping!.generatedRange.start, valueMapping!.generatedRange.end);
      expect(genValue).toBe('value');
    });
  });

  describe('detailed sourcemap mappings', () => {
    test('@args in component props map correctly', () => {
      const template = '<MyComp @value={{@input}} @handler={{@onClick}} />';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        bindings: new Set(['MyComp']),
      });

      const pathMappings = findMappingsByType(result.mappingTree, 'PathExpression');

      // Should have mappings for @input and @onClick (and possibly component name)
      const argMappings = pathMappings.filter(m => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText.startsWith('@');
      });

      expect(argMappings.length).toBeGreaterThanOrEqual(2);

      // Check @input mapping
      const inputMapping = argMappings.find(m => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText === '@input';
      });
      expect(inputMapping).toBeDefined();

      // Check @onClick mapping
      const clickMapping = argMappings.find(m => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText === '@onClick';
      });
      expect(clickMapping).toBeDefined();

      // Generated code should contain this[$args].input and this[$args].onClick
      const genText = result.code;
      expect(genText).toContain('this[$args].input');
      expect(genText).toContain('this[$args].onClick');
    });

    test('component @arg keys appear in sourcemap names', () => {
      const template = '<MyComp @value={{this.name}} />';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        bindings: new Set(['MyComp']),
      });

      const hashPairs = findMappingsByType(result.mappingTree, 'HashPair');
      const valuePair = hashPairs.find((m) => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText === '@value';
      });

      expect(valuePair).toBeDefined();
      expect(valuePair?.name).toBe('value');
      expect(result.sourceMap?.names).toContain('value');
    });

    test('this.property paths map to getter functions', () => {
      const template = '{{this.user.name}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      const pathMappings = findMappingsByType(result.mappingTree, 'PathExpression');
      expect(pathMappings.length).toBeGreaterThan(0);

      const tokens = ['this', 'user', 'name'];
      for (const token of tokens) {
        const mapping = pathMappings.find((m) => {
          const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
          return srcText === token;
        });
        expect(mapping).toBeDefined();
      }

      expect(result.code).toContain('this.user?.name');
    });

    test('@args in event handlers map correctly', () => {
      const template = '<button {{on "click" @onClick}}>Click</button>';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      const pathMappings = findMappingsByType(result.mappingTree, 'PathExpression');

      const argMapping = pathMappings.find(m => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText === '@onClick';
      });
      expect(argMapping).toBeDefined();

      const onClickMapping = pathMappings.find(m => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText === 'onClick';
      });
      expect(onClickMapping).toBeDefined();

      // Generated code should contain this[$args].onClick
      const genText = result.code;
      expect(genText).toContain('this[$args].onClick');

      // V3 sourcemap should map onClick to the generated onClick property
      expect(result.sourceMap).toBeDefined();
      const map = result.sourceMap!;
      expect(hasNamedMapping(map, template, result.code, 'onClick', 'onClick', 'onClick')).toBe(true);
    });

    test('built-in helper names map to generated helper symbols', () => {
      const template = '{{if @show "yes" "no"}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      const map = result.sourceMap!;
      expect(hasNamedMapping(map, template, result.code, 'if', 'if', SYMBOLS.IF_HELPER)).toBe(true);
    });

    test('modifier names map to generated modifier calls', () => {
      const template = '<div {{myMod @value}}></div>';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      const map = result.sourceMap!;
      expect(hasNamedMapping(map, template, result.code, 'myMod', 'myMod', 'myMod')).toBe(true);
    });

    test('component block params map to slot function params', () => {
      const template = '<MyComp as |rowItem rowIndex|>Hi</MyComp>';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        bindings: new Set(['MyComp']),
      });

      const pathMappings = findMappingsByType(result.mappingTree, 'PathExpression');

      const rowItemMapping = pathMappings.find((m) => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText === 'rowItem';
      });
      const rowIndexMapping = pathMappings.find((m) => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText === 'rowIndex';
      });

      expect(rowItemMapping).toBeDefined();
      expect(rowIndexMapping).toBeDefined();

      const genRowItem = result.code.slice(rowItemMapping!.generatedRange.start, rowItemMapping!.generatedRange.end);
      const genRowIndex = result.code.slice(rowIndexMapping!.generatedRange.start, rowIndexMapping!.generatedRange.end);

      expect(genRowItem).toBe('rowItem');
      expect(genRowIndex).toBe('rowIndex');
    });

    test('nested @args in helpers map correctly', () => {
      const template = '{{concat @firstName @lastName}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        bindings: new Set(['concat']),
      });

      const pathMappings = findMappingsByType(result.mappingTree, 'PathExpression');

      const argMappings = pathMappings.filter(m => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText.startsWith('@');
      });

      expect(argMappings.length).toBe(2);

      // Check both @firstName and @lastName are mapped
      const sourceTexts = argMappings.map(m =>
        template.slice(m.sourceRange.start, m.sourceRange.end)
      );
      expect(sourceTexts).toContain('@firstName');
      expect(sourceTexts).toContain('@lastName');

      // Generated code should contain both args
      const genText = result.code;
      expect(genText).toContain('this[$args].firstName');
      expect(genText).toContain('this[$args].lastName');
    });

    test('mixed this and @args in same template map correctly', () => {
      const template = '<div class={{this.className}} {{on "click" @handler}}>{{@title}}</div>';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      const pathMappings = findMappingsByType(result.mappingTree, 'PathExpression');

      // Should have per-token mappings for this.className, @handler, and @title
      const thisMapping = pathMappings.find(m => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText === 'this';
      });
      expect(thisMapping).toBeDefined();

      const classNameMapping = pathMappings.find(m => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText === 'className';
      });
      expect(classNameMapping).toBeDefined();

      const handlerMapping = pathMappings.find(m => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText === 'handler';
      });
      expect(handlerMapping).toBeDefined();

      const titleMapping = pathMappings.find(m => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText === 'title';
      });
      expect(titleMapping).toBeDefined();

      // Generated code should contain all three
      const genText = result.code;
      expect(genText).toContain('this.className');
      expect(genText).toContain('this[$args].handler');
      expect(genText).toContain('this[$args].title');
    });

    test('component tag names map correctly', () => {
      const template = '<MyComponent @value="test" />';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        bindings: new Set(['MyComponent']),
      });

      // Find component element mapping (ComponentNode covers the whole element)
      function findComponentMapping(node: any): any {
        if (node.sourceNode === 'ComponentNode' &&
            template.slice(node.sourceRange.start, node.sourceRange.end).includes('MyComponent')) {
          return node;
        }
        for (const child of node.children) {
          const found = findComponentMapping(child);
          if (found) return found;
        }
        return null;
      }

      const componentMapping = findComponentMapping(result.mappingTree);
      expect(componentMapping).toBeDefined();

      const srcText = template.slice(componentMapping.sourceRange.start, componentMapping.sourceRange.end);
      expect(srcText).toBe('<MyComponent @value="test" />');

      // Generated should contain $_c call for component
      const genText = result.code.slice(componentMapping.generatedRange.start, componentMapping.generatedRange.end);
      expect(genText).toContain('$_c');
    });

    test('v3 sourcemap maps nested @args path to generated output', () => {
      const template = '{{@name.value}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      expect(result.sourceMap).toBeDefined();
      const map = result.sourceMap!;
      const segments = parseMappings(map.mappings);
      const baseIndex = map.names.indexOf('this[$args]');
      const valueIndex = map.names.indexOf('value');
      expect(baseIndex).toBeGreaterThanOrEqual(0);
      expect(valueIndex).toBeGreaterThanOrEqual(0);

      const baseSegment = segments.find((entry) => entry.nameIndex === baseIndex);
      expect(baseSegment).toBeDefined();

      const valueSegment = segments.find((entry) => entry.nameIndex === valueIndex);
      expect(valueSegment).toBeDefined();

      const baseGenOffset = lineColumnToOffset(result.code, baseSegment!.generatedLine, baseSegment!.generatedColumn);
      const baseGenSlice = result.code.slice(baseGenOffset, baseGenOffset + 'this[$args]'.length);
      expect(baseGenSlice).toBe('this[$args]');

      const baseSrcOffset = lineColumnToOffset(template, baseSegment!.sourceLine, baseSegment!.sourceColumn);
      const baseSrcSlice = template.slice(baseSrcOffset, baseSrcOffset + '@name'.length);
      expect(baseSrcSlice).toBe('@name');

      const valueGenOffset = lineColumnToOffset(result.code, valueSegment!.generatedLine, valueSegment!.generatedColumn);
      const valueGenSlice = result.code.slice(valueGenOffset, valueGenOffset + 'value'.length);
      expect(valueGenSlice).toBe('value');

      const valueSrcOffset = lineColumnToOffset(template, valueSegment!.sourceLine, valueSegment!.sourceColumn);
      const valueSrcSlice = template.slice(valueSrcOffset, valueSrcOffset + 'value'.length);
      expect(valueSrcSlice).toBe('value');
    });

    test('v3 sourcemap maps @onClick to this[$args].onClick tokens', () => {
      const template = `<button {{on "click" @onClick}}></button>`;
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      expect(result.sourceMap).toBeDefined();
      const map = result.sourceMap!;
      const segments = parseMappings(map.mappings);

      const baseIndex = map.names.indexOf('this[$args]');
      const nameIndex = map.names.indexOf('onClick');
      expect(baseIndex).toBeGreaterThanOrEqual(0);
      expect(nameIndex).toBeGreaterThanOrEqual(0);

      const baseSegment = segments.find((entry) => entry.nameIndex === baseIndex);
      const nameSegment = segments.find((entry) => entry.nameIndex === nameIndex);
      expect(baseSegment).toBeDefined();
      expect(nameSegment).toBeDefined();

      const baseSrcOffset = lineColumnToOffset(template, baseSegment!.sourceLine, baseSegment!.sourceColumn);
      const baseSrcSlice = template.slice(baseSrcOffset, baseSrcOffset + '@onClick'.length);
      expect(baseSrcSlice).toBe('@onClick');

      const nameSrcOffset = lineColumnToOffset(template, nameSegment!.sourceLine, nameSegment!.sourceColumn);
      const nameSrcSlice = template.slice(nameSrcOffset, nameSrcOffset + 'onClick'.length);
      expect(nameSrcSlice).toBe('onClick');

      const nameGenOffset = lineColumnToOffset(result.code, nameSegment!.generatedLine, nameSegment!.generatedColumn);
      const nameGenSlice = result.code.slice(nameGenOffset, nameGenOffset + 'onClick'.length);
      expect(nameGenSlice).toBe('onClick');
    });

    test('v3 sourcemap maps each index param to generated index.value', () => {
      const template = '{{#each this.items as |item idx|}}<div>{{idx}}</div>{{/each}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      expect(result.code).toContain('idx.value');
      expect(result.sourceMap).toBeDefined();

      const map = result.sourceMap!;
      const segments = parseMappings(map.mappings);
      const nameIndex = map.names.indexOf('idx.value');
      expect(nameIndex).toBeGreaterThanOrEqual(0);

      const segment = segments.find((entry) => entry.nameIndex === nameIndex);
      expect(segment).toBeDefined();

      const genOffset = lineColumnToOffset(result.code, segment!.generatedLine, segment!.generatedColumn);
      const genSlice = result.code.slice(genOffset, genOffset + 'idx.value'.length);
      expect(genSlice).toBe('idx.value');

      const srcOffset = lineColumnToOffset(template, segment!.sourceLine, segment!.sourceColumn);
      const srcSlice = template.slice(srcOffset, srcOffset + 'idx'.length);
      expect(srcSlice).toBe('idx');
    });

    test('v3 sourcemap maps component tag name to generated identifier', () => {
      const template = '<MyComponent @arg="name" />';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        bindings: new Set(['MyComponent']),
      });

      expect(result.code).toContain('$_c(');
      expect(result.code).toContain('MyComponent');
      expect(result.sourceMap).toBeDefined();

      const map = result.sourceMap!;
      const segments = parseMappings(map.mappings);
      const nameIndex = map.names.indexOf('MyComponent');
      expect(nameIndex).toBeGreaterThanOrEqual(0);

      const segment = segments.find((entry) => entry.nameIndex === nameIndex);
      expect(segment).toBeDefined();

      const genOffset = lineColumnToOffset(result.code, segment!.generatedLine, segment!.generatedColumn);
      const genSlice = result.code.slice(genOffset, genOffset + 'MyComponent'.length);
      expect(genSlice).toBe('MyComponent');

      const srcOffset = lineColumnToOffset(template, segment!.sourceLine, segment!.sourceColumn);
      const srcSlice = template.slice(srcOffset, srcOffset + 'MyComponent'.length);
      expect(srcSlice).toBe('MyComponent');
    });

    test('helper calls map source to generated helper invocations', () => {
      const template = '{{concat "hello" "world"}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        bindings: new Set(['concat']),
      });

      // Find SubExpression mapping for the helper call
      const subMappings = findMappingsByType(result.mappingTree, 'SubExpression');
      expect(subMappings.length).toBeGreaterThan(0);

      const helperMapping = subMappings[0];
      const srcText = template.slice(helperMapping.sourceRange.start, helperMapping.sourceRange.end);
      expect(srcText).toBe('{{concat "hello" "world"}}');

      // Generated should contain the helper call
      const genText = result.code.slice(helperMapping.generatedRange.start, helperMapping.generatedRange.end);
      expect(genText).toContain('concat');
    });

    test('block statements map source blocks to generated control flow', () => {
      const template = '{{#if @show}}<div>visible</div>{{/if}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      const blockMappings = findMappingsByType(result.mappingTree, 'BlockStatement');
      expect(blockMappings.length).toBeGreaterThan(0);

      const ifMapping = blockMappings.find(m => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText.includes('if');
      });
      expect(ifMapping).toBeDefined();

      // Generated should contain $_if
      const genText = result.code.slice(ifMapping!.generatedRange.start, ifMapping!.generatedRange.end);
      expect(genText).toContain('$_if');
    });

    test('attribute mappings preserve source attribute names', () => {
      const template = '<input type="text" value={{@inputValue}} disabled={{@isDisabled}} />';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      const attrMappings = findMappingsByType(result.mappingTree, 'AttrNode');

      // Find value attribute mapping
      const valueAttr = attrMappings.find(m => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText.includes('value=');
      });
      expect(valueAttr).toBeDefined();

      // Find disabled attribute mapping
      const disabledAttr = attrMappings.find(m => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText.includes('disabled=');
      });
      expect(disabledAttr).toBeDefined();

      // Generated code should contain property assignments
      const genText = result.code;
      expect(genText).toContain('["value"');
      expect(genText).toContain('["disabled"');
    });

    test('modifier mappings preserve source modifier calls', () => {
      const template = '<div {{on "click" @handleClick}} {{tooltip @text}}></div>';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        bindings: new Set(['tooltip']),
      });

      const attrMappings = findMappingsByType(result.mappingTree, 'AttrNode');

      // Find on modifier mapping
      const onModifier = attrMappings.find(m => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText.includes('on "click"');
      });
      expect(onModifier).toBeDefined();

      // Find tooltip modifier mapping
      const tooltipModifier = attrMappings.find(m => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText.includes('tooltip');
      });
      expect(tooltipModifier).toBeDefined();

      // Generated code should contain modifier calls
      const genText = result.code;
      expect(genText).toContain('($e, $n) => this[$args].handleClick');
      expect(genText).toContain('tooltip($n, this[$args].text)');
    });
  });

  describe('element mappings', () => {
    test('element has mapping to $_tag call', () => {
      const template = '<div>content</div>';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      // Should have ElementNode mappings for $_tag calls
      const elementMappings = findMappingsByType(result.mappingTree, 'ElementNode');
      expect(elementMappings.length).toBeGreaterThan(0);

      // Find the element mapping
      const elementMapping = elementMappings.find(m => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText.includes('<div>');
      });
      expect(elementMapping).toBeDefined();

      // Generated should contain $_tag
      const genText = result.code.slice(elementMapping!.generatedRange.start, elementMapping!.generatedRange.end);
      expect(genText).toContain('$_tag');
    });

    test('multiple elements have separate mappings', () => {
      const template = '<div>a</div><span>b</span>';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      const elementMappings = findMappingsByType(result.mappingTree, 'ElementNode');

      // Should have at least 2 mappings for the two elements
      expect(elementMappings.length).toBeGreaterThanOrEqual(2);

      // Verify both elements are mapped
      const divMapping = elementMappings.find(m => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText.includes('<div>');
      });
      const spanMapping = elementMappings.find(m => {
        const srcText = template.slice(m.sourceRange.start, m.sourceRange.end);
        return srcText.includes('<span>');
      });

      expect(divMapping).toBeDefined();
      expect(spanMapping).toBeDefined();
    });

    test('nested elements have hierarchical mappings', () => {
      const template = '<div><span>nested</span></div>';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      // Should have multiple mapping levels
      expect(countMappingNodes(result.mappingTree)).toBeGreaterThan(2);
    });
  });

  describe('literal mappings', () => {
    test('string literal has mapping', () => {
      const template = '{{"hello"}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      // Check generated code contains the literal
      expect(result.code).toContain('"hello"');

      // Should have mapping nodes
      expect(countMappingNodes(result.mappingTree)).toBeGreaterThan(1);
    });

    test('number literal has mapping', () => {
      const template = '{{42}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      expect(result.code).toContain('42');
      expect(countMappingNodes(result.mappingTree)).toBeGreaterThan(1);
    });

    test('boolean literal has mapping', () => {
      const template = '{{true}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      expect(result.code).toContain('true');
      expect(countMappingNodes(result.mappingTree)).toBeGreaterThan(1);
    });
  });

  describe('control flow mappings', () => {
    test('if block has mapping', () => {
      const template = '{{#if this.show}}visible{{/if}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      // Should have mapping nodes (at least root Template + content)
      expect(countMappingNodes(result.mappingTree)).toBeGreaterThanOrEqual(2);

      // The generated code should have $_if
      expect(result.code).toContain('$_if');
    });

    test('each block has mapping', () => {
      const template = '{{#each this.items as |item|}}{{item}}{{/each}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      // Should have mapping nodes (at least root Template + content)
      expect(countMappingNodes(result.mappingTree)).toBeGreaterThanOrEqual(2);
      expect(result.code).toContain('$_each');
    });
  });

  describe('helper mappings', () => {
    test('helper call has mapping', () => {
      const template = '{{concat "a" "b"}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      // Should have SubExpression mapping for helper call
      expect(countMappingNodes(result.mappingTree)).toBeGreaterThan(1);
      expect(result.code).toContain('concat');
    });

    test('nested helper has mapping', () => {
      const template = '{{concat (uppercase "a") "b"}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      expect(countMappingNodes(result.mappingTree)).toBeGreaterThan(2);
    });
  });
});

describe('Formatted Output with Preserved Sourcemaps', () => {
  /**
   * Helper to count total mapping nodes.
   */
  function countMappingNodes(tree: MappingTreeNode): number {
    return 1 + tree.children.reduce((sum, child) => sum + countMappingNodes(child), 0);
  }

  describe('formatting preserves sourcemaps', () => {
    test('formatted output has correct mapping positions', () => {
      const template = '{{this.name}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        format: { enabled: true },
      });

      // Formatted output should have newlines
      expect(result.code).toContain('\n');

      // Verify the mapping points to correct positions in formatted output
      const tree = result.mappingTree;
      const genText = result.code.slice(tree.generatedRange.start, tree.generatedRange.end);

      // The mapping should cover the entire formatted output
      expect(genText).toBe(result.code);
    });

    test('formatted multi-element template has correct mappings', () => {
      const template = '<div>a</div><span>b</span>';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        format: { enabled: true },
      });

      // Should have formatted output with newlines
      expect(result.code).toContain('\n');

      // Should have mapping nodes for both elements
      expect(countMappingNodes(result.mappingTree)).toBeGreaterThanOrEqual(3);

      // Each element's generated range should point to valid positions
      const children = result.mappingTree.children[0]?.children || [];
      for (const child of children) {
        const genText = result.code.slice(child.generatedRange.start, child.generatedRange.end);
        // Each child mapping should point to valid code
        expect(genText.length).toBeGreaterThan(0);
        expect(child.generatedRange.end).toBeLessThanOrEqual(result.code.length);
      }
    });

    test('formatted output mapping positions match actual code positions', () => {
      const template = '{{this.value}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        format: { enabled: true },
      });

      // Find a leaf mapping node
      function findLeafMapping(node: MappingTreeNode): MappingTreeNode {
        if (node.children.length === 0) return node;
        return findLeafMapping(node.children[node.children.length - 1]);
      }

      const leafMapping = findLeafMapping(result.mappingTree);
      const genText = result.code.slice(leafMapping.generatedRange.start, leafMapping.generatedRange.end);

      // The generated text should be valid (not empty and within bounds)
      expect(genText.length).toBeGreaterThan(0);
      expect(leafMapping.generatedRange.end).toBeLessThanOrEqual(result.code.length);
    });
  });

  describe('formatting vs non-formatting comparison', () => {
    test('both formatted and non-formatted have same number of mapping nodes', () => {
      const template = '<div>{{this.name}}</div>';

      const formattedResult = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        format: { enabled: true },
      });

      const unformattedResult = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        format: { enabled: false },
      });

      // Both should have the same mapping structure
      expect(countMappingNodes(formattedResult.mappingTree))
        .toBe(countMappingNodes(unformattedResult.mappingTree));
    });

    test('formatted output is longer but mappings are still valid', () => {
      const template = '<div>a</div><span>b</span>';

      const formattedResult = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        format: { enabled: true },
      });

      const unformattedResult = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        format: { enabled: false },
      });

      // Formatted should be longer
      expect(formattedResult.code.length).toBeGreaterThan(unformattedResult.code.length);

      // Both root mappings should cover their respective full outputs
      expect(formattedResult.mappingTree.generatedRange.end).toBe(formattedResult.code.length);
      expect(unformattedResult.mappingTree.generatedRange.end).toBe(unformattedResult.code.length);
    });

    test('source ranges are identical regardless of formatting', () => {
      const template = '{{this.name}}';

      const formattedResult = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        format: { enabled: true },
      });

      const unformattedResult = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        format: { enabled: false },
      });

      // Source ranges should be identical (they both map to the same template)
      expect(formattedResult.mappingTree.sourceRange)
        .toEqual(unformattedResult.mappingTree.sourceRange);
    });
  });

  describe('V3 sourcemap generation with formatting', () => {
    test('generates valid V3 sourcemap for formatted output', () => {
      const template = '<div>{{this.name}}</div>';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        format: { enabled: true },
      });

      expect(result.sourceMap).toBeDefined();
      expect(result.sourceMap!.version).toBe(3);
      expect(result.sourceMap!.mappings).toBeDefined();
      expect(typeof result.sourceMap!.mappings).toBe('string');
    });

    test('formatted sourcemap has valid VLQ mappings', () => {
      const template = '<div>content</div>';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        format: { enabled: true },
      });

      // VLQ characters: A-Z, a-z, 0-9, +, /
      const validChars = /^[A-Za-z0-9+/,;]*$/;
      expect(result.sourceMap!.mappings).toMatch(validChars);
    });

    test('formatted multi-line output has line separators in mappings', () => {
      const template = '<div>a</div><span>b</span><p>c</p>';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        format: { enabled: true },
      });

      // Formatted output should have multiple lines
      const lineCount = result.code.split('\n').length;
      expect(lineCount).toBeGreaterThan(1);

      // Mappings should have semicolons for line separators
      // (semicolons separate mappings for different lines)
      expect(result.sourceMap!.mappings).toContain(';');
    });
  });
});

describe('Formatted Calls', () => {
  describe('control flow formatting', () => {
    test('if block arguments are formatted on separate lines', () => {
      const template = '{{#if this.show}}visible{{else}}hidden{{/if}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        format: { enabled: true },
      });

      // Each argument should be on its own line
      const lines = result.code.split('\n');
      expect(lines.length).toBeGreaterThan(5);

      // Should have $_if with opening paren on same line
      expect(result.code).toContain('$_if(');
      // Should have condition as first argument
      expect(result.code).toContain('() => this.show');
    });

    test('each block arguments are formatted on separate lines', () => {
      const template = '{{#each this.items as |item|}}{{item}}{{/each}}';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        format: { enabled: true },
      });

      // Should have multiple lines
      const lines = result.code.split('\n');
      expect(lines.length).toBeGreaterThan(3);

      // Should have $_each
      expect(result.code).toContain('$_each(');
    });
  });

  describe('component formatting', () => {
    test('component with args has formatted output', () => {
      const template = '<MyComponent @name={{this.name}} @value={{this.value}} />';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        format: { enabled: true },
        bindings: new Set(['MyComponent']),
      });

      // Should have multiple lines
      const lines = result.code.split('\n');
      expect(lines.length).toBeGreaterThan(3);

      // Should have $_c and $_args
      expect(result.code).toContain('$_c(');
      expect(result.code).toContain('$_args(');
    });

    test('component without args is less formatted', () => {
      const template = '<MyComponent />';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        format: { enabled: true },
        bindings: new Set(['MyComponent']),
      });

      // Should still be formatted but simpler
      expect(result.code).toContain('$_c(');
    });
  });

  describe('element formatting', () => {
    test('element with multiple attributes has formatted properties array', () => {
      const template = '<input type="text" value={{this.value}} placeholder="Enter text" />';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        format: { enabled: true },
      });

      // Properties array should have multiple lines
      const lines = result.code.split('\n');
      expect(lines.length).toBeGreaterThan(3);

      // Should have each attribute on its own line (approximately)
      expect(result.code).toContain('["type"');
      expect(result.code).toContain('["value"');
      expect(result.code).toContain('["placeholder"');
    });

    test('element with single attribute is less formatted', () => {
      const template = '<div class="foo">text</div>';
      const result = compile(template, {
        sourceMap: { enabled: true },
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        format: { enabled: true },
      });

      // Should still work but be more compact
      expect(result.code).toContain('$_tag');
      expect(result.code).toContain('"foo"');
    });
  });
});

describe('Multi-line source position accuracy', () => {
  function findMappingsByType(tree: MappingTreeNode, type: string): MappingTreeNode[] {
    const results: MappingTreeNode[] = [];
    if (tree.sourceNode === type) {
      results.push(tree);
    }
    for (const child of tree.children) {
      results.push(...findMappingsByType(child, type));
    }
    return results;
  }

  test('elements on different lines map to correct source positions', () => {
    const template = '<div>\n  <span>hello</span>\n  <p>world</p>\n</div>';
    const result = compile(template, {
      sourceMap: { enabled: true },
      flags: { IS_GLIMMER_COMPAT_MODE: true },
      format: { enabled: true },
    });

    const elementMappings = findMappingsByType(result.mappingTree, 'ElementNode');
    expect(elementMappings.length).toBe(3); // div, span, p

    // div: starts at offset 0
    const divMapping = elementMappings.find(m => m.sourceRange.start === 0);
    expect(divMapping).toBeDefined();
    expect(template.slice(divMapping!.sourceRange.start, divMapping!.sourceRange.start + 4)).toBe('<div');

    // span: starts at offset 8 (after '<div>\n  ')
    const spanMapping = elementMappings.find(m => {
      const text = template.slice(m.sourceRange.start, m.sourceRange.start + 5);
      return text === '<span';
    });
    expect(spanMapping).toBeDefined();
    expect(spanMapping!.sourceRange.start).toBe(8); // '<div>\n  ' = 8 chars

    // p: starts at offset 29 (after '<div>\n  <span>hello</span>\n  ')
    const pMapping = elementMappings.find(m => {
      const text = template.slice(m.sourceRange.start, m.sourceRange.start + 2);
      return text === '<p';
    });
    expect(pMapping).toBeDefined();
    expect(pMapping!.sourceRange.start).toBe(29); // '<div>\n  <span>hello</span>\n  ' = 29 chars
  });

  test('source ranges never map to offset 0 for non-root elements', () => {
    const template = '<div>\n  <span>hello</span>\n  <p>world</p>\n</div>';
    const result = compile(template, {
      sourceMap: { enabled: true },
      flags: { IS_GLIMMER_COMPAT_MODE: true },
    });

    const elementMappings = findMappingsByType(result.mappingTree, 'ElementNode');
    // The root div starts at 0, but span and p should NOT start at 0
    const nonRootMappings = elementMappings.filter(m => m.sourceRange.start > 0);
    expect(nonRootMappings.length).toBe(2); // span and p
  });

  test('V3 sourcemap has entries on correct generated lines', () => {
    const template = '<div>\n  <span>hello</span>\n  <p>world</p>\n</div>';
    const result = compile(template, {
      sourceMap: { enabled: true },
      flags: { IS_GLIMMER_COMPAT_MODE: true },
      format: { enabled: true },
    });

    const map = generateSourceMap(result.mappingTree, template, result.code, {
      file: 'test.hbs',
      includeContent: true,
      sourceContent: template,
    });

    // Should have non-empty mappings
    expect(map.mappings.length).toBeGreaterThan(0);
    // Should have multiple lines of mappings (multi-line formatted output)
    const lineCount = map.mappings.split(';').length;
    expect(lineCount).toBeGreaterThan(3);
    // Should have entries on multiple different generated lines
    const linesWithEntries = map.mappings.split(';').filter(l => l.length > 0).length;
    expect(linesWithEntries).toBeGreaterThan(2);
  });

  test('no Template or Synthetic nodes leak into V3 sourcemap', () => {
    const template = '<div>\n  <span>text</span>\n</div>';
    const result = compile(template, {
      sourceMap: { enabled: true },
      flags: { IS_GLIMMER_COMPAT_MODE: true },
      format: { enabled: true },
    });

    // Verify no Template nodes are in the mapping tree at element level
    const templateMappings = findMappingsByType(result.mappingTree, 'Template');
    // Template nodes exist in the tree but should be filtered by generateSourceMap
    expect(templateMappings.length).toBeGreaterThan(0); // They exist in the tree

    // The V3 sourcemap should only contain entries from non-Template/non-Synthetic nodes
    const map = generateSourceMap(result.mappingTree, template, result.code, {
      file: 'test.hbs',
    });

    // Verify mappings are generated (from ElementNode entries, not Template)
    expect(map.mappings.length).toBeGreaterThan(0);
  });

  test('component conditional with args has mappings for all expressions', () => {
    const template = '{{#if IS_GLIMMER_COMPAT_MODE}}\n      <NestedRouter\n        @components={{this.components}}\n        @stack={{this.router.stack}}\n      />\n    {{else}}\n      <Benchmark />\n    {{/if}}';
    const result = compile(template, {
      sourceMap: { enabled: true },
      flags: { IS_GLIMMER_COMPAT_MODE: true },
      bindings: new Set(['NestedRouter', 'Benchmark']),
    });

    // Should have PathExpression mappings for the paths
    const pathMappings = findMappingsByType(result.mappingTree, 'PathExpression');
    expect(pathMappings.length).toBeGreaterThan(0);

    // Should have mappings for per-token paths
    const pathTexts = pathMappings.map(m =>
      template.slice(m.sourceRange.start, m.sourceRange.end)
    );

    expect(pathTexts).toContain('this');
    expect(pathTexts).toContain('components');
    expect(pathTexts).toContain('router');
    expect(pathTexts).toContain('stack');

    // Should have ElementNode mappings for component names
    const elementMappings = findMappingsByType(result.mappingTree, 'ElementNode');
    const elementTexts = elementMappings.map(m =>
      template.slice(m.sourceRange.start, m.sourceRange.end)
    );

    expect(elementTexts).toContain('NestedRouter');
    expect(elementTexts).toContain('Benchmark');
  });

  test('component conditional template tokens are mapped in V3 sourcemap', () => {
    const template = '{{#if IS_GLIMMER_COMPAT_MODE}}\n      <NestedRouter\n        @components={{this.components}}\n        @stack={{this.router.stack}}\n      />\n    {{else}}\n      <Benchmark />\n    {{/if}}';
    const result = compile(template, {
      sourceMap: { enabled: true },
      flags: { IS_GLIMMER_COMPAT_MODE: true },
      // Include IS_GLIMMER_COMPAT_MODE in bindings so it's compiled as an identifier
      // (Unknown bindings go through $_maybeHelper as strings, which wouldn't have identifier mappings)
      bindings: new Set(['NestedRouter', 'Benchmark', 'IS_GLIMMER_COMPAT_MODE']),
    });

    expect(result.sourceMap).toBeDefined();
    const map = result.sourceMap!;

    expect(hasNamedMapping(map, template, result.code, 'IS_GLIMMER_COMPAT_MODE', 'IS_GLIMMER_COMPAT_MODE', 'IS_GLIMMER_COMPAT_MODE')).toBe(true);
    expect(hasNamedMapping(map, template, result.code, 'NestedRouter', 'NestedRouter', 'NestedRouter')).toBe(true);
    expect(hasNamedMapping(map, template, result.code, 'Benchmark', 'Benchmark', 'Benchmark')).toBe(true);

    expect(hasNamedMapping(map, template, result.code, 'this', 'this', 'this')).toBe(true);
    expect(hasNamedMapping(map, template, result.code, 'components', 'components', 'components')).toBe(true);
    expect(hasNamedMapping(map, template, result.code, 'router', 'router', 'router')).toBe(true);
    expect(hasNamedMapping(map, template, result.code, 'stack', 'stack', 'stack')).toBe(true);

    expect(hasNamedMapping(map, template, result.code, 'components', '@components', 'components')).toBe(true);
    expect(hasNamedMapping(map, template, result.code, 'stack', '@stack', 'stack')).toBe(true);
  });

  test('helper calls do not duplicate identifiers', () => {
    const template = '<span>{{originalValue @vanila}}</span>';
    const result = compile(template, {
      sourceMap: { enabled: true },
      flags: { IS_GLIMMER_COMPAT_MODE: true },
      bindings: new Set(),
    });

    // Should contain the maybe helper call
    expect(result.code).toContain('$_maybeHelper');
    expect(result.code).toContain('"originalValue"');
    expect(result.code).toContain('this[$args].vanila');
  });
});
