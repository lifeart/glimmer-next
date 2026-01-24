/**
 * Source Map Generator
 *
 * Converts MappingTree to standard source map format (v3) for Vite integration.
 */

import type { MappingTreeNode } from './types';

/**
 * Standard source map v3 format
 */
export interface RawSourceMap {
  version: 3;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;
}

/**
 * A single mapping segment
 */
interface MappingSegment {
  generatedColumn: number;
  sourceIndex: number;
  originalLine: number;
  originalColumn: number;
  /** Index into the names array (5th VLQ field) for identifier resolution */
  nameIndex?: number;
}

/**
 * Name tracking for source map names array.
 * Maps identifier strings to their index in the names array.
 */
class NameTracker {
  private names: string[] = [];
  private nameMap = new Map<string, number>();

  /** Get or add a name, returning its index */
  getIndex(name: string): number {
    let idx = this.nameMap.get(name);
    if (idx === undefined) {
      idx = this.names.length;
      this.names.push(name);
      this.nameMap.set(name, idx);
    }
    return idx;
  }

  /** Get the final names array */
  getNames(): string[] {
    return this.names;
  }
}

/**
 * VLQ encoding characters
 */
const VLQ_BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Encode a single VLQ value
 */
function encodeVLQ(value: number): string {
  let result = '';
  let vlq = value < 0 ? (-value << 1) + 1 : value << 1;

  do {
    let digit = vlq & 0x1f;
    vlq >>>= 5;
    if (vlq > 0) {
      digit |= 0x20;
    }
    result += VLQ_BASE64[digit];
  } while (vlq > 0);

  return result;
}

/**
 * Convert character offset to line/column
 */
function offsetToLineColumn(
  source: string,
  offset: number,
): { line: number; column: number } {
  let line = 0;
  let column = 0;
  const clampedOffset = Math.min(offset, source.length);

  for (let i = 0; i < clampedOffset; i++) {
    if (source[i] === '\n') {
      line++;
      column = 0;
    } else {
      column++;
    }
  }

  return { line, column };
}

/**
 * Collect all mappings from a mapping tree.
 * Includes both leaf and non-leaf nodes so that parent elements
 * (e.g., a <div> containing a <span>) are also breakpointable.
 * Skips Template and Synthetic scope nodes which don't correspond to
 * specific source constructs and would create spurious first/last line mappings.
 */
function collectLeafMappings(
  tree: MappingTreeNode,
  result: MappingTreeNode[] = [],
): MappingTreeNode[] {
  // Skip Template nodes (they span the entire template and create
  // misleading first/last line mappings) and Synthetic nodes (generated
  // wrapper code without direct source correspondence)
  const sourceNode = tree.sourceNode;
  if (sourceNode !== 'Template' && sourceNode !== 'Synthetic') {
    result.push(tree);
  }
  // Always recurse into children to find specific element/block mappings
  for (const child of tree.children) {
    collectLeafMappings(child, result);
  }
  return result;
}

/**
 * Generate mappings string from mapping segments grouped by generated line
 */
function generateMappingsString(
  lineSegments: Map<number, MappingSegment[]>,
  maxLine: number,
): string {
  const lines: string[] = [];

  let prevGeneratedColumn = 0;
  let prevSourceIndex = 0;
  let prevOriginalLine = 0;
  let prevOriginalColumn = 0;
  let prevNameIndex = 0;

  for (let line = 0; line <= maxLine; line++) {
    const segments = lineSegments.get(line) || [];

    // Sort segments by generated column
    segments.sort((a, b) => a.generatedColumn - b.generatedColumn);

    const lineResult: string[] = [];
    prevGeneratedColumn = 0; // Reset for each line

    for (const segment of segments) {
      let encoded = '';

      // Generated column (relative to previous in this line)
      encoded += encodeVLQ(segment.generatedColumn - prevGeneratedColumn);
      prevGeneratedColumn = segment.generatedColumn;

      // Source index (relative)
      encoded += encodeVLQ(segment.sourceIndex - prevSourceIndex);
      prevSourceIndex = segment.sourceIndex;

      // Original line (relative, 0-based)
      encoded += encodeVLQ(segment.originalLine - prevOriginalLine);
      prevOriginalLine = segment.originalLine;

      // Original column (relative)
      encoded += encodeVLQ(segment.originalColumn - prevOriginalColumn);
      prevOriginalColumn = segment.originalColumn;

      // Name index (5th VLQ field, relative) - enables debugger hover resolution
      if (segment.nameIndex !== undefined) {
        encoded += encodeVLQ(segment.nameIndex - prevNameIndex);
        prevNameIndex = segment.nameIndex;
      }

      lineResult.push(encoded);
    }

    lines.push(lineResult.join(','));
  }

  return lines.join(';');
}

/**
 * Generate a source map from a mapping tree
 */



export function generateSourceMap(
  originalSource: string,
  generatedSource: string,
  mappingTree: MappingTreeNode,
  sourceFileName: string,
  generatedFileName?: string,
): RawSourceMap {
  // Collect leaf mappings (most specific)
  const leafMappings = collectLeafMappings(mappingTree);

  // Track names for identifier resolution in debuggers
  const nameTracker = new NameTracker();

  // Group mapping segments by generated line
  const lineSegments = new Map<number, MappingSegment[]>();
  let maxGeneratedLine = 0;

  for (const mapping of leafMappings) {
    const originalLength = mapping.originalRange.end - mapping.originalRange.start;
    const transformedLength = mapping.transformedRange.end - mapping.transformedRange.start;

    // Skip mappings without meaningful source range (zero-length original
    // range means no source position to map to, would incorrectly map to offset 0)
    if (originalLength === 0) {
      continue;
    }

    // Use the name from the mapping tree node for debugger hover evaluation (5th VLQ field)
    let nameIndex: number | undefined;
    if (mapping.name) {
      nameIndex = nameTracker.getIndex(mapping.name);
    }

    // Get line/column for start of generated range
    const genPos = offsetToLineColumn(generatedSource, mapping.transformedRange.start);
    const origPos = offsetToLineColumn(originalSource, mapping.originalRange.start);

    maxGeneratedLine = Math.max(maxGeneratedLine, genPos.line);

    const segment: MappingSegment = {
      generatedColumn: genPos.column,
      sourceIndex: 0, // Single source file
      originalLine: origPos.line,
      originalColumn: origPos.column,
      nameIndex,
    };

    if (!lineSegments.has(genPos.line)) {
      lineSegments.set(genPos.line, []);
    }
    lineSegments.get(genPos.line)!.push(segment);

    // For ranges with length, also map the end
    if (originalLength > 0 && transformedLength > 0) {
      const genEndPos = offsetToLineColumn(generatedSource, mapping.transformedRange.end);
      const origEndPos = offsetToLineColumn(originalSource, mapping.originalRange.end);

      maxGeneratedLine = Math.max(maxGeneratedLine, genEndPos.line);

      const endSegment: MappingSegment = {
        generatedColumn: genEndPos.column,
        sourceIndex: 0,
        originalLine: origEndPos.line,
        originalColumn: origEndPos.column,
      };

      if (!lineSegments.has(genEndPos.line)) {
        lineSegments.set(genEndPos.line, []);
      }
      lineSegments.get(genEndPos.line)!.push(endSegment);
    }
  }

  // Generate the mappings string
  const mappings = generateMappingsString(lineSegments, maxGeneratedLine);

  return {
    version: 3,
    file: generatedFileName,
    sources: [sourceFileName],
    sourcesContent: [originalSource],
    names: nameTracker.getNames(),
    mappings,
  };
}

/**
 * Generate an empty source map (identity mapping)
 */
export function generateEmptySourceMap(
  source: string,
  fileName: string,
): RawSourceMap {
  // Count lines
  const lines = source.split('\n');
  const mappings = lines.map(() => '').join(';');

  return {
    version: 3,
    file: fileName,
    sources: [fileName],
    sourcesContent: [source],
    names: [],
    mappings,
  };
}

/**
 * Merge source maps when one transformation is applied after another
 * This is a simplified merge - for complex cases, use @ampproject/remapping
 */
export function mergeSourceMaps(
  _original: RawSourceMap,
  transformed: RawSourceMap,
): RawSourceMap {
  // For now, return the transformed map
  // A proper implementation would trace through the mappings
  return transformed;
}

/**
 * Shift all mappings in a source map by an offset
 * Useful when embedding a template's source map into a larger file's map
 */
export function shiftSourceMap(
  map: RawSourceMap,
  generatedLineOffset: number,
): RawSourceMap {
  if (generatedLineOffset === 0) {
    return map;
  }

  // Add empty lines before the mappings
  const prefix = new Array(generatedLineOffset).fill('').join(';');
  const newMappings = prefix + (map.mappings ? ';' + map.mappings : '');

  return {
    ...map,
    mappings: newMappings,
  };
}

/**
 * Create a source map for a simple string replacement
 */
export function createIdentityMap(
  source: string,
  fileName: string,
): RawSourceMap {
  const lines = source.split('\n');
  const mappingLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 0) {
      // Map start of line to itself: column 0, source 0, line i, column 0
      // First line: AAAA (all zeros)
      // Subsequent lines: AACA (line increments by 1)
      mappingLines.push(i === 0 ? 'AAAA' : 'AACA');
    } else {
      mappingLines.push('');
    }
  }

  return {
    version: 3,
    file: fileName,
    sources: [fileName],
    sourcesContent: [source],
    names: [],
    mappings: mappingLines.join(';'),
  };
}

/**
 * Convert source map to inline data URL
 */
export function sourceMapToDataUrl(map: RawSourceMap): string {
  const json = JSON.stringify(map);
  const base64 = Buffer.from(json).toString('base64');
  return `data:application/json;charset=utf-8;base64,${base64}`;
}

/**
 * Append inline source map comment to code
 */
export function appendSourceMapComment(
  code: string,
  map: RawSourceMap,
): string {
  const dataUrl = sourceMapToDataUrl(map);
  return `${code}\n//# sourceMappingURL=${dataUrl}`;
}
