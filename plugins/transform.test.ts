import { describe, test, expect } from 'vitest';
import { Preprocessor } from 'content-tag';
import { transform, findRootsArrayOffset, type TransformResult } from './test';
import { defaultFlags } from './flags';
import { fixExportsForHMR, HMR } from './hmr';

// Use sync flags for most tests (ASYNC_COMPILE_TRANSFORMS defaults to true)
const syncFlags = { ...defaultFlags(), ASYNC_COMPILE_TRANSFORMS: false };
const asyncFlags = { ...defaultFlags(), ASYNC_COMPILE_TRANSFORMS: true };

const preprocessor = new Preprocessor();

function preprocess(source: string, filename: string): string {
  const result = preprocessor.process(source, { filename });
  return result.code;
}

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

      if (index >= segment.length) continue;

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

function hasNamedMappingAtOffset(
  map: { names: string[]; mappings: string },
  source: string,
  generated: string,
  name: string,
  sourceOffset: number,
  generatedText: string
): boolean {
  const segments = parseMappings(map.mappings);
  const nameIndex = map.names.indexOf(name);
  if (nameIndex === -1) return false;

  return segments.some((segment) => {
    if (segment.nameIndex !== nameIndex) return false;
    const srcOffset = lineColumnToOffset(source, segment.sourceLine, segment.sourceColumn);
    if (srcOffset !== sourceOffset) return false;
    const genOffset = lineColumnToOffset(generated, segment.generatedLine, segment.generatedColumn);
    return generated.slice(genOffset, genOffset + generatedText.length) === generatedText;
  });
}

describe('Transform Function', () => {
  describe('TransformResult (sync)', () => {
    test('returns object with code property for simple TypeScript', () => {
      // Simple TypeScript without template tags (no preprocessing needed)
      const source = `
        import { Cell } from '@lifeart/gxt';
        const myCell = new Cell(42);
        export { myCell };
      `;

      const result = transform(
        source,
        'test.ts',
        'development',
        false,
        syncFlags,
      ) as TransformResult;

      expect(result).toHaveProperty('code');
      expect(typeof result.code).toBe('string');
      expect(result.code).toContain('Cell');
    });

    test('returns object with map property', () => {
      const source = `
        import { Cell } from '@lifeart/gxt';
        const myCell = new Cell(42);
      `;

      const result = transform(
        source,
        'test.ts',
        'development',
        false,
        syncFlags,
      ) as TransformResult;

      expect(result).toHaveProperty('map');
    });

    test('source map has correct structure when present', () => {
      const source = `
        import { Cell } from '@lifeart/gxt';
        const myCell = new Cell(42);
      `;

      const result = transform(
        source,
        'test.ts',
        'development',
        false,
        syncFlags,
      ) as TransformResult;

      if (result.map) {
        expect(result.map.version).toBe(3);
        expect(result.map.sources).toBeDefined();
        expect(Array.isArray(result.map.sources)).toBe(true);
        expect(result.map.mappings).toBeDefined();
        expect(typeof result.map.mappings).toBe('string');
      }
    });

    test('preserves source file name in map', () => {
      const source = `
        import { Cell } from '@lifeart/gxt';
        const value = new Cell(1);
      `;

      const result = transform(
        source,
        'my-file.ts',
        'production',
        false,
        syncFlags,
      ) as TransformResult;

      if (result.map && result.map.sources) {
        expect(result.map.sources.length).toBeGreaterThan(0);
      }
    });

    test('babel plugin state does not leak between files', () => {
      const sourceWithAlias = `
        import { template as template_foo } from '@ember/template-compiler';
        export const value = 1;
      `;
      const first = transform(
        sourceWithAlias,
        'alias.gts',
        'development',
        false,
        syncFlags,
      ) as TransformResult;
      expect(first.code).toContain('hbs');

      const sourceWithoutAlias = `
        function template_foo(arg: string) { return arg; }
        class Test {
          static {
            template_foo(\`<div>Should stay</div>\`);
          }
        }
      `;
      const second = transform(
        sourceWithoutAlias,
        'no-alias.gts',
        'development',
        false,
        syncFlags,
      ) as TransformResult;
      expect(second.code).toContain('template_foo(`');
      expect(second.code).not.toContain('hbs`<div>Should stay</div>`');
    });
  });

  describe('async transform', () => {
    test('returns promise when ASYNC_COMPILE_TRANSFORMS is true', async () => {
      const source = `
        import { Cell } from '@lifeart/gxt';
        const myCell = new Cell(42);
      `;

      const resultPromise = transform(
        source,
        'test.ts',
        'development',
        false,
        asyncFlags,
      );

      expect(resultPromise).toBeInstanceOf(Promise);

      const result = (await resultPromise) as TransformResult;
      expect(result).toHaveProperty('code');
      expect(result.code).toContain('Cell');
    });

    test('async result includes source map', async () => {
      const source = `
        import { Cell } from '@lifeart/gxt';
        const myCell = new Cell(42);
      `;

      const result = (await transform(
        source,
        'test.ts',
        'development',
        false,
        asyncFlags,
      )) as TransformResult;

      expect(result).toHaveProperty('map');
      if (result.map) {
        expect(result.map.version).toBe(3);
      }
    });

    test('keeps conservative getter wrappers when checker hints are disabled', async () => {
      const source = `
        function compute() { return 42; }
        export default class MyComponent {
          value = compute();
          <template>{{this.value}}</template>
        }
      `;

      const result = (await transform(
        source,
        'test.gts',
        'development',
        false,
        { ...asyncFlags, WITH_TYPE_CHECKER_HINTS: false },
      )) as TransformResult;

      expect(result.code).toMatch(/\(\)\s*=>\s*this\.value/);
    });

    test('applies checker hints in async mode when enabled by flag', async () => {
      const source = `
        function compute() { return 42; }
        export default class MyComponent {
          value = compute();
          <template>{{this.value}}</template>
        }
      `;

      const result = (await transform(
        source,
        'test.gts',
        'development',
        false,
        { ...asyncFlags, WITH_TYPE_CHECKER_HINTS: true },
      )) as TransformResult;

      expect(result.code).not.toMatch(/\(\)\s*=>\s*this\.value/);
      expect(result.code).toContain('this.value');
    });
  });

  describe('template compilation with block params', () => {
    test('each block params are correctly scoped', () => {
      const source = `
import { Component } from '@lifeart/gxt';

export class MyList extends Component {
  items = [{ name: 'one' }, { name: 'two' }];
  <template>
    {{#each this.items as |item|}}
      <div>{{item.name}}</div>
    {{/each}}
  </template>
}
`;
      const preprocessed = preprocess(source, 'test.gts');
      const result = transform(
        preprocessed,
        'test.gts',
        'development',
        false,
        syncFlags,
        source,
      ) as TransformResult;

      // Should only have ONE $_each call in roots
      const eachMatches = result.code.match(/\$_each\(/g);
      expect(eachMatches).toHaveLength(1);

      // item.name should be inside the $_each callback, not as a separate element
      expect(result.code).toContain('(item, $index');
      expect(result.code).toContain('item.name');

      // Should NOT have item.name resolved as a helper outside the each
      expect(result.code).not.toContain('$_maybeHelper("item.name"');
    });

    test('nested each blocks with different block params', () => {
      const source = `
import { Component } from '@lifeart/gxt';

export class NestedList extends Component {
  groups = [{ items: [{ name: 'a' }] }];
  <template>
    {{#each this.groups as |group|}}
      {{#each group.items as |item|}}
        <span>{{item.name}}</span>
      {{/each}}
    {{/each}}
  </template>
}
`;
      const preprocessed = preprocess(source, 'test.gts');
      const result = transform(
        preprocessed,
        'test.gts',
        'development',
        false,
        syncFlags,
        source,
      ) as TransformResult;

      // Should have exactly TWO $_each calls (outer and inner)
      const eachMatches = result.code.match(/\$_each\(/g);
      expect(eachMatches).toHaveLength(2);

      // Both block params should be properly scoped
      expect(result.code).toContain('(group, $index');
      expect(result.code).toContain('(item, $index');
      expect(result.code).toContain('item.name');
    });

    test('if block inside each properly scopes block param', () => {
      const source = `
import { Component } from '@lifeart/gxt';

export class FilteredList extends Component {
  items = [{ name: 'one', visible: true }];
  <template>
    {{#each this.items as |item|}}
      {{#if item.visible}}
        <p>{{item.name}}</p>
      {{/if}}
    {{/each}}
  </template>
}
`;
      const preprocessed = preprocess(source, 'test.gts');
      const result = transform(
        preprocessed,
        'test.gts',
        'development',
        false,
        syncFlags,
        source,
      ) as TransformResult;

      // Should have ONE $_each and ONE $_if
      const eachMatches = result.code.match(/\$_each\(/g);
      const ifMatches = result.code.match(/\$_if\(/g);
      expect(eachMatches).toHaveLength(1);
      expect(ifMatches).toHaveLength(1);

      // item references should be inside the callbacks
      expect(result.code).toContain('item.visible');
      expect(result.code).toContain('item.name');
    });

    test('fn helper with block param argument', () => {
      const source = `
import { Component } from '@lifeart/gxt';

export class ClickableList extends Component {
  items = [{ id: 1 }];
  onClick = (id: number) => {};
  <template>
    {{#each this.items as |item|}}
      <button {{on "click" (fn this.onClick item.id)}}>Click</button>
    {{/each}}
  </template>
}
`;
      const preprocessed = preprocess(source, 'test.gts');
      const result = transform(
        preprocessed,
        'test.gts',
        'development',
        false,
        syncFlags,
        source,
      ) as TransformResult;

      // Should have ONE $_each
      const eachMatches = result.code.match(/\$_each\(/g);
      expect(eachMatches).toHaveLength(1);

      // fn helper should reference item.id correctly
      expect(result.code).toContain('$__fn(this.onClick, item.id)');
    });
  });

  describe('sourcemap mappings in full file transform', () => {
    test('maps all paths and fields in each + component template', () => {
      const source = `
import { Component } from '@lifeart/gxt';
import { Row } from './Row.gts';

export class Table extends Component {
  items = [];
  onSelect = () => {};
  selected = null;
  removeItem = () => {};
  <template>
    <tbody>
      {{#each this.items key='id' as |item|}}
        <Row
          @item={{item}}
          @onSelect={{this.onSelect}}
          @selected={{this.selected}}
          @onRemove={{this.removeItem}}
        />
      {{/each}}
    </tbody>
  </template>
}
`;

      const preprocessed = preprocess(source, 'table.gts');
      const result = transform(
        preprocessed,
        'table.gts',
        'development',
        false,
        syncFlags,
        source,
      ) as TransformResult;

      expect(result.map).toBeDefined();
      const map = result.map!;

      const checks: Array<[string, string, string]> = [
        ['Row', 'Row', 'Row'],
        ['this', 'this', 'this'],
        ['items', 'items', 'items'],
        ['item', 'item', 'item'],
        ['onSelect', 'onSelect', 'onSelect'],
        ['selected', 'selected', 'selected'],
        ['removeItem', 'removeItem', 'removeItem'],
        ['item', '@item', 'item'],
        ['onSelect', '@onSelect', 'onSelect'],
        ['selected', '@selected', 'selected'],
        ['onRemove', '@onRemove', 'onRemove'],
      ];

      for (const [name, sourceText, generatedText] of checks) {
        expect(
          hasNamedMapping(map, source, result.code, name, sourceText, generatedText)
        ).toBe(true);
      }

      const blockParamStart = source.indexOf('|item|');
      if (blockParamStart !== -1) {
        expect(
          hasNamedMappingAtOffset(map, source, result.code, 'item', blockParamStart + 1, 'item')
        ).toBe(true);
      }
    });
  });

  describe('source maps for .gts files', () => {
    test('generates source map pointing to original .gts file', async () => {
      const originalSource = `
import { cell } from '@lifeart/gxt';

const count = cell(0);

<template>
  <div class="counter">
    <span>Count: {{count}}</span>
  </div>
</template>
`;
      const preprocessed = preprocess(originalSource, 'counter.gts');
      const result = await transform(
        preprocessed,
        'counter.gts',
        'development',
        false,
        asyncFlags,
        originalSource, // Pass original source for source maps
      ) as TransformResult;

      expect(result.map).toBeDefined();
      expect(result.map).not.toBeNull();

      if (result.map) {
        // Source map version
        expect(result.map.version).toBe(3);

        // Source should point to the .gts file
        expect(result.map.sources).toContain('counter.gts');

        // Sources content should include the original .gts source
        expect(result.map.sourcesContent).toBeDefined();
        expect(result.map.sourcesContent![0]).toContain('<template>');
        expect(result.map.sourcesContent![0]).toContain('{{count}}');

        // Should have non-empty mappings
        expect(result.map.mappings).toBeDefined();
        expect(result.map.mappings.length).toBeGreaterThan(0);
      }
    });

    test('source map without original source falls back to babel map', async () => {
      const originalSource = `
import { cell } from '@lifeart/gxt';

const count = cell(0);

<template>
  <span>{{count}}</span>
</template>
`;
      const preprocessed = preprocess(originalSource, 'test.gts');
      const result = await transform(
        preprocessed,
        'test.gts',
        'development',
        false,
        asyncFlags,
        // Not passing originalSource - should fall back to Babel's map
      ) as TransformResult;

      // Should still have a map from Babel
      expect(result.map).toBeDefined();
      if (result.map) {
        expect(result.map.version).toBe(3);
        expect(result.map.sources).toBeDefined();
      }
    });

    test('multiple templates generate source maps for all', async () => {
      // This tests a component with multiple template sections
      const originalSource = `
import { cell } from '@lifeart/gxt';

const showA = cell(true);

<template>
  {{#if showA}}
    <div>Template A</div>
  {{else}}
    <span>Template B</span>
  {{/if}}
</template>
`;
      const preprocessed = preprocess(originalSource, 'multi.gts');
      const result = await transform(
        preprocessed,
        'multi.gts',
        'development',
        false,
        asyncFlags,
        originalSource,
      ) as TransformResult;

      expect(result.map).toBeDefined();
      if (result.map) {
        expect(result.map.sources).toContain('multi.gts');
        expect(result.map.sourcesContent![0]).toContain('{{#if showA}}');
      }
    });

    test('source map mappings contain non-trivial position data', async () => {
      const originalSource = `
import { cell } from '@lifeart/gxt';

const count = cell(0);

<template>
  <div class="counter">
    <span>Count: {{count}}</span>
  </div>
</template>
`;
      const preprocessed = preprocess(originalSource, 'counter.gts');
      const result = await transform(
        preprocessed,
        'counter.gts',
        'development',
        false,
        asyncFlags,
        originalSource,
      ) as TransformResult;

      expect(result.map).toBeDefined();
      if (result.map) {
        // Mappings should be non-empty (not just empty strings or trivial data)
        expect(result.map.mappings.length).toBeGreaterThan(10);

        // Mappings should contain actual VLQ-encoded data (semicolons separate lines)
        expect(result.map.mappings).toContain(';');

        // The sourcesContent should include the original template
        expect(result.map.sourcesContent).toBeDefined();
        expect(result.map.sourcesContent![0]).toContain('<template>');
        expect(result.map.sourcesContent![0]).toContain('{{count}}');
      }
    });

    test('handles tab-indented templates with correct name mappings', async () => {
      const originalSource = `
import { Component } from '@lifeart/gxt';
import { Row } from './Row.gts';

export class Table extends Component {
\t<template>
\t\t<tbody>
\t\t\t<Row />
\t\t</tbody>
\t</template>
}
`;
      const preprocessed = preprocess(originalSource, 'table.gts');
      const result = await transform(
        preprocessed,
        'table.gts',
        'development',
        false,
        asyncFlags,
        originalSource,
      ) as TransformResult;

      expect(result.map).toBeDefined();
      if (result.map) {
        expect(
          hasNamedMapping(result.map, originalSource, result.code, 'Row', 'Row', 'Row')
        ).toBe(true);
      }
    });

    test('handles CRLF line endings in templates', async () => {
      const originalSource = `
import { Component } from '@lifeart/gxt';
import { Row } from './Row.gts';

export class Table extends Component {
  <template>
    <tbody>
      <Row />
    </tbody>
  </template>
}
`;
      const crlfSource = originalSource.replace(/\n/g, '\r\n');
      const preprocessed = preprocess(crlfSource, 'table.gts');
      const result = await transform(
        preprocessed,
        'table.gts',
        'development',
        false,
        asyncFlags,
        crlfSource,
      ) as TransformResult;

      expect(result.map).toBeDefined();
      if (result.map) {
        expect(
          hasNamedMapping(result.map, crlfSource, result.code, 'Row', 'Row', 'Row')
        ).toBe(true);
      }
    });

    test('handles whitespace-only templates without crashing', async () => {
      const originalSource = `
import { Component } from '@lifeart/gxt';

export default class EmptyTemplate extends Component {
  <template>


  </template>
}
`;
      const preprocessed = preprocess(originalSource, 'empty.gts');
      const result = await transform(
        preprocessed,
        'empty.gts',
        'development',
        false,
        asyncFlags,
        originalSource,
      ) as TransformResult;

      expect(result.code).toContain('$template');
      expect(result.map).toBeDefined();
      if (result.map) {
        expect(result.map.sources).toContain('empty.gts');
        expect(result.map.sourcesContent).toBeDefined();
        expect(result.map.sourcesContent![0]).toContain('<template>');
      }
    });

    test('maps multiple templates independently', async () => {
      const originalSource = `
import { Component } from '@lifeart/gxt';
import { Row } from './Row.gts';
import { Col } from './Col.gts';

export class One extends Component {
  <template>
    <Row />
  </template>
}

export class Two extends Component {
  <template>
    <Col />
  </template>
}
`;
      const preprocessed = preprocess(originalSource, 'multi.gts');
      const result = await transform(
        preprocessed,
        'multi.gts',
        'development',
        false,
        asyncFlags,
        originalSource,
      ) as TransformResult;

      expect(result.map).toBeDefined();
      if (result.map) {
        const rowOffset = originalSource.indexOf('<Row') + 1;
        const colOffset = originalSource.indexOf('<Col') + 1;
        expect(
          hasNamedMappingAtOffset(result.map, originalSource, result.code, 'Row', rowOffset, 'Row')
        ).toBe(true);
        expect(
          hasNamedMappingAtOffset(result.map, originalSource, result.code, 'Col', colOffset, 'Col')
        ).toBe(true);
      }
    });

    test('generates source map for hbs template literals in .ts files', async () => {
      // This tests hbs`...` templates directly in .ts files (no preprocessing needed)
      const source = `
import { hbs, cell } from '@lifeart/gxt';

const count = cell(0);

export default hbs\`
  <div class="counter">
    <span>Count: {{count}}</span>
  </div>
\`;
`;

      const result = await transform(
        source,
        'counter.ts',
        'development',
        false,
        asyncFlags,
        source, // For .ts files, source is the same as original
      ) as TransformResult;

      expect(result.map).toBeDefined();
      if (result.map) {
        // Source map version
        expect(result.map.version).toBe(3);

        // Source should point to the .ts file
        expect(result.map.sources).toContain('counter.ts');

        // Mappings should be non-trivial
        expect(result.map.mappings.length).toBeGreaterThan(10);

        // The sourcesContent should include the original hbs template
        expect(result.map.sourcesContent).toBeDefined();
        expect(result.map.sourcesContent![0]).toContain('hbs`');
        expect(result.map.sourcesContent![0]).toContain('{{count}}');
      }
    });

    test('source maps work correctly with HMR code appended', async () => {
      // This simulates the development mode flow with HMR enabled
      const originalSource = `
import { Component } from '@lifeart/gxt';

export const MyCounter = class extends Component {
  count = 0;
  <template>
    <div class="counter">
      <span>Count: {{this.count}}</span>
      <button {{on "click" this.increment}}>+</button>
    </div>
  </template>
};
`;
      // Simulate the compiler.ts flow for development mode:
      // 1. Preprocess with content-tag
      const preprocessed = preprocess(originalSource, 'counter.gts');
      // 2. Apply fixExportsForHMR (changes 'export const ' to 'export let ')
      const withHMRFix = fixExportsForHMR(preprocessed);
      // 3. Append HMR code
      const withHMR = withHMRFix + HMR;

      const result = await transform(
        withHMR,
        'counter.gts',
        'development',
        false,
        asyncFlags,
        originalSource, // Original source without HMR modifications
      ) as TransformResult;

      expect(result.map).toBeDefined();
      if (result.map) {
        // Source map version
        expect(result.map.version).toBe(3);

        // Source should point to the .gts file
        expect(result.map.sources).toContain('counter.gts');

        // Mappings should be non-trivial
        expect(result.map.mappings.length).toBeGreaterThan(10);

        // The sourcesContent should include the original template (not HMR code)
        expect(result.map.sourcesContent).toBeDefined();
        expect(result.map.sourcesContent![0]).toContain('<template>');
        expect(result.map.sourcesContent![0]).toContain('{{this.count}}');
        // Verify it doesn't include HMR code in sourcesContent
        expect(result.map.sourcesContent![0]).not.toContain('import.meta.hot');
      }

      // Verify the generated code includes HMR
      expect(result.code).toContain('import.meta.hot');
    });

    test('source map names include identifiers for debugger hover resolution', async () => {
      const originalSource = `
import { cell } from '@lifeart/gxt';

const count = cell(0);

<template>
  <span>{{count}}</span>
</template>
`;
      const preprocessed = preprocess(originalSource, 'counter.gts');
      const result = await transform(
        preprocessed,
        'counter.gts',
        'development',
        false,
        asyncFlags,
        originalSource,
      ) as TransformResult;

      expect(result.map).toBeDefined();
      if (result.map) {
        // Names should include identifier references from the template
        // The 'count' variable is used as {{count}} which is a PathExpression
        expect(result.map.names.length).toBeGreaterThan(0);
        expect(result.map.names).toContain('count');
      }
    });

    test('source map names include component tag names for debugger hover', async () => {
      const originalSource = `
import MyComp from './MyComp';

<template>
  <MyComp />
</template>
`;
      const preprocessed = preprocess(originalSource, 'app.gts');
      const result = await transform(
        preprocessed,
        'app.gts',
        'development',
        false,
        asyncFlags,
        originalSource,
      ) as TransformResult;

      expect(result.map).toBeDefined();
      if (result.map) {
        // Names should include the component tag name for debugger hover
        expect(result.map.names).toContain('MyComp');
      }
    });
  });
});

describe('findRootsArrayOffset', () => {
  test('finds offset of [ in simple wrapper without preamble', () => {
    const wrapper = `function () {
      const roots = [1, 2, 3];
      return roots;
    }`;
    const offset = findRootsArrayOffset(wrapper);
    expect(offset).toBeGreaterThan(0);
    expect(wrapper[offset]).toBe('[');
  });

  test('finds offset of [ when $a alias preamble precedes roots', () => {
    const wrapper = `function () {
      const $a = this[$args];
      const roots = [1, 2, 3];
      return roots;
    }`;
    const offset = findRootsArrayOffset(wrapper);
    expect(offset).toBeGreaterThan(0);
    expect(wrapper[offset]).toBe('[');
    // Must NOT match the [ in this[$args]
    expect(wrapper.slice(offset, offset + 9)).toBe('[1, 2, 3]');
  });

  test('finds offset with multiple preamble declarations ($fw, $slots, $a)', () => {
    const wrapper = `function () {
      const $fw = $_GET_FW(this, arguments);
      $_GET_ARGS(this, arguments);
      const $a = this[$args];
      const $slots = $_GET_SLOTS(this, arguments);
      const roots = ["hello"];
      return roots;
    }`;
    const offset = findRootsArrayOffset(wrapper);
    expect(offset).toBeGreaterThan(0);
    expect(wrapper[offset]).toBe('[');
    expect(wrapper.slice(offset, offset + 7)).toBe('["hello');
  });

  test('returns -1 when no const roots declaration exists', () => {
    const wrapper = `function () {
      const $a = this[$args];
      return [];
    }`;
    expect(findRootsArrayOffset(wrapper)).toBe(-1);
  });

  test('works with arrow function wrapper', () => {
    const wrapper = `() => {
      const $slots = $_GET_SLOTS(this, arguments);
      const roots = [/*items*/];
      return roots;
    }`;
    const offset = findRootsArrayOffset(wrapper);
    expect(offset).toBeGreaterThan(0);
    expect(wrapper[offset]).toBe('[');
  });

  test('works with IIFE wrapper', () => {
    const wrapper = `(() => {
      $_GET_ARGS(this, arguments);
      const $a = this[$args];
      const $slots = $_GET_SLOTS(this, arguments);
      const roots = [42];
      return roots;
    })()`;
    const offset = findRootsArrayOffset(wrapper);
    expect(offset).toBeGreaterThan(0);
    expect(wrapper[offset]).toBe('[');
  });
});

describe('Sourcemap offset accuracy with $a alias', () => {
  test('single component with @args: sourcemap positions point to correct source', () => {
    const source = `
import { Component } from '@lifeart/gxt';

export class Greeter extends Component {
  <template>
    <div>{{@name}}</div>
  </template>
}
`;
    const preprocessed = preprocess(source, 'greeter.gts');
    const result = transform(
      preprocessed,
      'greeter.gts',
      'development',
      false,
      syncFlags,
      source,
    ) as TransformResult;

    // The generated code must use $a alias
    expect(result.code).toContain('$a.');

    expect(result.map).toBeDefined();
    const map = result.map!;

    // @name should map to $a.name in generated code
    expect(
      hasNamedMapping(map, source, result.code, 'name', 'name', 'name')
    ).toBe(true);
    expect(
      hasNamedMapping(map, source, result.code, '$a', '@name', '$a')
    ).toBe(true);
  });

  test('multiple components in one file with @args: all get correct sourcemaps', () => {
    const source = `
import { Component } from '@lifeart/gxt';

export class First extends Component {
  <template>
    <span>{{@alpha}}</span>
  </template>
}

export class Second extends Component {
  <template>
    <span>{{@beta}}</span>
  </template>
}
`;
    const preprocessed = preprocess(source, 'multi.gts');
    const result = transform(
      preprocessed,
      'multi.gts',
      'development',
      false,
      syncFlags,
      source,
    ) as TransformResult;

    expect(result.code).toContain('$a.');
    expect(result.map).toBeDefined();
    const map = result.map!;

    // Both @alpha and @beta should have correct named mappings
    expect(
      hasNamedMapping(map, source, result.code, 'alpha', 'alpha', 'alpha')
    ).toBe(true);
    expect(
      hasNamedMapping(map, source, result.code, 'beta', 'beta', 'beta')
    ).toBe(true);

    // Both should have $a mappings pointing to the correct @ source positions
    const segments = parseMappings(map.mappings);
    const aliasIndex = map.names.indexOf('$a');
    expect(aliasIndex).toBeGreaterThanOrEqual(0);

    const aliasSegments = segments.filter(s => s.nameIndex === aliasIndex);
    // At least 2 $a references (one per template)
    expect(aliasSegments.length).toBeGreaterThanOrEqual(2);

    for (const seg of aliasSegments) {
      const srcOffset = lineColumnToOffset(source, seg.sourceLine, seg.sourceColumn);
      expect(source[srcOffset]).toBe('@');

      const genOffset = lineColumnToOffset(result.code, seg.generatedLine, seg.generatedColumn);
      expect(result.code.slice(genOffset, genOffset + 2)).toBe('$a');
    }
  });

  test('mixed: template with @args and template without @args in same file', () => {
    const source = `
import { Component } from '@lifeart/gxt';

export class WithArgs extends Component {
  <template>
    <div>{{@title}}</div>
  </template>
}

export class WithoutArgs extends Component {
  name = 'test';
  <template>
    <div>{{this.name}}</div>
  </template>
}
`;
    const preprocessed = preprocess(source, 'mixed.gts');
    const result = transform(
      preprocessed,
      'mixed.gts',
      'development',
      false,
      syncFlags,
      source,
    ) as TransformResult;

    expect(result.map).toBeDefined();
    const map = result.map!;

    // @title from the first template should map correctly
    expect(
      hasNamedMapping(map, source, result.code, 'title', 'title', 'title')
    ).toBe(true);

    // this.name from the second template should also map correctly
    expect(
      hasNamedMapping(map, source, result.code, 'name', 'name', 'name')
    ).toBe(true);

    // All segments should have valid generated and source offsets
    const segments = parseMappings(map.mappings);
    for (const seg of segments) {
      const genOffset = lineColumnToOffset(result.code, seg.generatedLine, seg.generatedColumn);
      expect(genOffset).toBeLessThanOrEqual(result.code.length);

      const srcOffset = lineColumnToOffset(source, seg.sourceLine, seg.sourceColumn);
      expect(srcOffset).toBeLessThanOrEqual(source.length);
    }
  });

  test('component with @args + $fw + $slots: all preambles before roots', () => {
    const source = `
import { Component } from '@lifeart/gxt';
import { MyChild } from './child';

export class Complex extends Component {
  <template>
    <MyChild @value={{@input}} as |result|>
      <span>{{result}}</span>
    </MyChild>
  </template>
}
`;
    const preprocessed = preprocess(source, 'complex.gts');
    const result = transform(
      preprocessed,
      'complex.gts',
      'development',
      false,
      syncFlags,
      source,
    ) as TransformResult;

    expect(result.map).toBeDefined();
    const map = result.map!;

    // All segments should have valid positions
    const segments = parseMappings(map.mappings);
    for (const seg of segments) {
      const genOffset = lineColumnToOffset(result.code, seg.generatedLine, seg.generatedColumn);
      expect(genOffset).toBeLessThanOrEqual(result.code.length);

      const srcOffset = lineColumnToOffset(source, seg.sourceLine, seg.sourceColumn);
      expect(srcOffset).toBeLessThanOrEqual(source.length);
    }

    // @input should map to $a.input
    expect(
      hasNamedMapping(map, source, result.code, 'input', 'input', 'input')
    ).toBe(true);
  });

  test('three components in one file: all sourcemap positions are valid', () => {
    const source = `
import { Component } from '@lifeart/gxt';

export class A extends Component {
  <template>
    <div>{{@x}}</div>
  </template>
}

export class B extends Component {
  <template>
    <span>{{@y}}</span>
  </template>
}

export class C extends Component {
  <template>
    <p>{{@z}}</p>
  </template>
}
`;
    const preprocessed = preprocess(source, 'abc.gts');
    const result = transform(
      preprocessed,
      'abc.gts',
      'development',
      false,
      syncFlags,
      source,
    ) as TransformResult;

    expect(result.map).toBeDefined();
    const map = result.map!;

    // Each arg property name should be in the sourcemap
    for (const name of ['x', 'y', 'z']) {
      expect(
        hasNamedMapping(map, source, result.code, name, name, name)
      ).toBe(true);
    }

    // All $a references should point back to @ in source
    const segments = parseMappings(map.mappings);
    const aliasIndex = map.names.indexOf('$a');
    expect(aliasIndex).toBeGreaterThanOrEqual(0);

    const aliasSegments = segments.filter(s => s.nameIndex === aliasIndex);
    expect(aliasSegments.length).toBeGreaterThanOrEqual(3);

    for (const seg of aliasSegments) {
      const srcOffset = lineColumnToOffset(source, seg.sourceLine, seg.sourceColumn);
      expect(source[srcOffset]).toBe('@');

      const genOffset = lineColumnToOffset(result.code, seg.generatedLine, seg.generatedColumn);
      expect(result.code.slice(genOffset, genOffset + 2)).toBe('$a');
    }
  });
});
