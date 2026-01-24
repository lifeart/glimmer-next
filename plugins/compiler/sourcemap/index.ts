/**
 * Sourcemap Generator
 *
 * Converts the compiler's mapping tree to standard V3 sourcemaps.
 * Supports both inline sourcemaps and external .map files.
 */

import type { MappingTreeNode } from '../types';

/**
 * Sourcemap V3 format.
 */
export interface SourceMapV3 {
  version: 3;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;
}

/**
 * Options for sourcemap generation.
 */
export interface SourceMapOptions {
  /** Source filename */
  file?: string;
  /** Source root path */
  sourceRoot?: string;
  /** Original source content */
  sourceContent?: string;
  /** Include source content in the map */
  includeContent?: boolean;
}

/**
 * VLQ character encoding table.
 */
const VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Encode a number as VLQ.
 */
function encodeVLQ(value: number): string {
  let result = '';
  let vlq = value < 0 ? ((-value) << 1) + 1 : value << 1;

  do {
    let digit = vlq & 0x1f;
    vlq >>>= 5;
    if (vlq > 0) {
      digit |= 0x20; // Set continuation bit
    }
    result += VLQ_CHARS[digit];
  } while (vlq > 0);

  return result;
}

/**
 * Position tracking during sourcemap generation.
 */
interface MappingState {
  generatedLine: number;
  generatedColumn: number;
  sourceIndex: number;
  sourceLine: number;
  sourceColumn: number;
  nameIndex: number;
}

/**
 * Convert source offset to line/column.
 */
function offsetToLineColumn(
  source: string,
  offset: number
): { line: number; column: number } {
  let line = 0;
  let column = 0;
  let pos = 0;

  for (let i = 0; i < source.length && i < offset; i++) {
    if (source[i] === '\n') {
      line++;
      column = 0;
    } else {
      column++;
    }
    pos++;
  }

  return { line, column };
}

/**
 * Convert generated offset to line/column.
 */
function generatedOffsetToLineColumn(
  code: string,
  offset: number
): { line: number; column: number } {
  return offsetToLineColumn(code, offset);
}

/**
 * Generate a mapping segment.
 */
function generateSegment(
  state: MappingState,
  genLine: number,
  genCol: number,
  srcLine: number,
  srcCol: number,
  sourceIndex = 0,
  nameIndex?: number
): string {
  const segments: number[] = [];

  // Column in generated code (relative to previous)
  if (genLine === state.generatedLine) {
    segments.push(genCol - state.generatedColumn);
  } else {
    segments.push(genCol);
  }

  // Source file index (relative)
  segments.push(sourceIndex - state.sourceIndex);

  // Line in source (relative)
  segments.push(srcLine - state.sourceLine);

  // Column in source (relative)
  segments.push(srcCol - state.sourceColumn);

  // Name index (optional, only if present)
  if (nameIndex !== undefined) {
    segments.push(nameIndex - state.nameIndex);
    state.nameIndex = nameIndex;
  }

  // Update state
  state.generatedLine = genLine;
  state.generatedColumn = genCol;
  state.sourceIndex = sourceIndex;
  state.sourceLine = srcLine;
  state.sourceColumn = srcCol;

  return segments.map(encodeVLQ).join('');
}

/**
 * Mapping entry for sorting.
 */
interface MappingEntry {
  generatedLine: number;
  generatedColumn: number;
  sourceLine: number;
  sourceColumn: number;
  name?: string;
}

/**
 * Collect mappings from tree recursively.
 * Skips Template and Synthetic scope nodes which don't correspond to
 * specific source constructs and would create spurious first/last line mappings.
 */
function collectMappings(
  node: MappingTreeNode,
  source: string,
  generatedCode: string,
  entries: MappingEntry[]
): void {
  // Skip Template nodes (they span the entire template) and Synthetic nodes
  // (generated wrapper code without direct source correspondence)
  const sourceNode = node.sourceNode;
  const isUsefulNode = sourceNode !== 'Template' && sourceNode !== 'Synthetic';

  // Only add mapping entries for nodes with valid source ranges and useful types
  if (isUsefulNode && node.sourceRange.start >= 0 && node.sourceRange.end > node.sourceRange.start) {
    const srcPos = offsetToLineColumn(source, node.sourceRange.start);
    const genPos = generatedOffsetToLineColumn(generatedCode, node.generatedRange.start);

    entries.push({
      generatedLine: genPos.line,
      generatedColumn: genPos.column,
      sourceLine: srcPos.line,
      sourceColumn: srcPos.column,
      name: node.name,
    });
  }

  // Always process children to find specific element/block mappings
  for (const child of node.children) {
    collectMappings(child, source, generatedCode, entries);
  }
}

/**
 * Generate V3 sourcemap from mapping tree.
 *
 * @param mappingTree - The mapping tree from compilation
 * @param source - Original source code
 * @param generatedCode - Generated JavaScript code
 * @param options - Sourcemap options
 * @returns V3 sourcemap object
 */
export function generateSourceMap(
  mappingTree: MappingTreeNode,
  source: string,
  generatedCode: string,
  options: SourceMapOptions = {}
): SourceMapV3 {
  const sourceFile = options.file ?? 'template.hbs';

  // Collect all mappings
  const entries: MappingEntry[] = [];
  collectMappings(mappingTree, source, generatedCode, entries);

  // Collect unique names
  const nameSet = new Set<string>();
  for (const entry of entries) {
    if (entry.name) {
      nameSet.add(entry.name);
    }
  }
  const names = Array.from(nameSet).sort();

  // Create name index map
  const nameIndexMap = new Map<string, number>();
  names.forEach((name, index) => {
    nameIndexMap.set(name, index);
  });

  // Sort by generated position
  entries.sort((a, b) => {
    if (a.generatedLine !== b.generatedLine) {
      return a.generatedLine - b.generatedLine;
    }
    return a.generatedColumn - b.generatedColumn;
  });

  // Generate VLQ-encoded mappings string
  const state: MappingState = {
    generatedLine: 0,
    generatedColumn: 0,
    sourceIndex: 0,
    sourceLine: 0,
    sourceColumn: 0,
    nameIndex: 0,
  };

  const lines: string[][] = [];
  let currentLine = 0;

  for (const entry of entries) {
    // Add empty lines if needed
    while (currentLine < entry.generatedLine) {
      lines.push([]);
      currentLine++;
      state.generatedColumn = 0;
    }

    // Ensure current line exists
    if (!lines[currentLine]) {
      lines[currentLine] = [];
    }

    // Add segment
    const segment = generateSegment(
      state,
      entry.generatedLine,
      entry.generatedColumn,
      entry.sourceLine,
      entry.sourceColumn,
      0, // sourceIndex
      entry.name ? nameIndexMap.get(entry.name) : undefined
    );

    lines[currentLine].push(segment);
  }

  // Join lines with semicolons, segments with commas
  const mappings = lines.map(line => line.join(',')).join(';');

  const map: SourceMapV3 = {
    version: 3,
    sources: [sourceFile],
    names,
    mappings,
  };

  if (options.file) {
    map.file = options.file.replace(/\.(hbs|gts|gjs)$/, '.js');
  }

  if (options.sourceRoot) {
    map.sourceRoot = options.sourceRoot;
  }

  if (options.includeContent && options.sourceContent) {
    map.sourcesContent = [options.sourceContent];
  }

  return map;
}

/**
 * Generate inline sourcemap comment.
 */
export function generateInlineSourceMap(
  mappingTree: MappingTreeNode,
  source: string,
  generatedCode: string,
  options: SourceMapOptions = {}
): string {
  const map = generateSourceMap(mappingTree, source, generatedCode, {
    ...options,
    includeContent: true,
    sourceContent: source,
  });

  const base64 = btoa(JSON.stringify(map));
  return `//# sourceMappingURL=data:application/json;base64,${base64}`;
}

/**
 * Append inline sourcemap to code.
 */
export function appendInlineSourceMap(
  code: string,
  mappingTree: MappingTreeNode,
  source: string,
  options: SourceMapOptions = {}
): string {
  const comment = generateInlineSourceMap(mappingTree, source, code, options);
  return `${code}\n${comment}`;
}
