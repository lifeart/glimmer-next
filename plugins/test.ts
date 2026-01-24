// https://astexplorer.net/#/gist/c2f0f7e4bf505471c94027c580af8329/c67119639ba9e8fd61a141e8e2f4cbb6f3a31de9
// https://astexplorer.net/#/gist/4e3b4c288e176bb7ce657f9dea95f052/8dcabe8144c7dc337d21e8c771413db30ca5d397
import { preprocess, type ASTv1 } from '@glimmer/syntax';
import {
  type PluginItem,
  transformSync,
  transformAsync,
  type BabelFileResult,
} from '@babel/core';
import { Preprocessor } from 'content-tag';
import { processTemplate, type ResolvedHBS } from './babel';
import { compile, formatErrorForDisplay, generateSourceMap, type MappingTreeNode, type SourceMapV3 } from './compiler/index';

import { SYMBOLS } from './symbols';
import { defaultFlags, type Flags } from './flags';

function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') offsets.push(i + 1);
  }
  return offsets;
}

function offsetToLineColumn(offsets: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = offsets.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const lineStart = offsets[mid];
    const nextLineStart = offsets[mid + 1] ?? Infinity;
    if (offset < lineStart) {
      high = mid - 1;
    } else if (offset >= nextLineStart) {
      low = mid + 1;
    } else {
      return { line: mid, column: offset - lineStart };
    }
  }
  const lastLine = offsets.length - 1;
  return { line: lastLine, column: Math.max(0, offset - offsets[lastLine]) };
}

/**
 * Extract basename from file path for source maps.
 *
 * Following the same pattern as @sveltejs/vite-plugin-svelte:
 * - file field: basename of output file
 * - sources: basename of source file (relative to same directory)
 *
 * This is the standard approach that browsers expect.
 * The sourcesContent field contains the full original source for debugging.
 */
function getBasename(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/');
  return lastSlash !== -1 ? filePath.slice(lastSlash + 1) : filePath;
}

/**
 * Information about a processed template for source mapping
 */
interface ProcessedTemplate {
  /** Generated JavaScript code for the template */
  code: string;
  /** Source mapping tree from template conversion */
  mapping: MappingTreeNode;
  /** Original template source string */
  originalSource: string;
  /** Location of template in original file (line/column based) */
  originalLoc?: ResolvedHBS['loc'];
  /** Template flags */
  flags: ResolvedHBS['flags'];
}

/**
 * Result of transform function - matches Vite's expected format
 */
export interface TransformResult {
  code: string;
  map?: SourceMapV3 | null;
}

const p = new Preprocessor();

function isSimpleElement(element: ASTv1.ElementNode) {
  const tag = element.tag;
  if (tag.includes('.') || tag.startsWith(':')) {
    return false;
  }
  return tag.toLowerCase() === tag;
}

export function isAllChildNodesSimpleElements(children: ASTv1.Node[]): boolean {
  return children.every((child: ASTv1.Node) => {
    if (child.type === 'ElementNode') {
      return (
        isSimpleElement(child) && isAllChildNodesSimpleElements(child.children)
      );
    } else if (child.type === 'TextNode') {
      return true;
    } else if (child.type === 'MustacheCommentStatement') {
      return true;
    } else if (child.type === 'CommentStatement') {
      return true;
    } else if (child.type === 'MustacheStatement') {
      if (child.path.type !== 'PathExpression') {
        return false;
      } else if (
        child.path.original === 'yield' ||
        child.path.original === 'outlet'
      ) {
        return false;
      } else if (child.path.head?.type === 'AtHead') {
        return true;
      }
    }
    return false;
  });
}

/**
 * Convert line/column position to character offset in source
 */
function lineColumnToOffset(source: string, line: number, column: number): number {
  const lines = source.split('\n');
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for newline
  }
  return offset + column;
}

/**
 * Shift mapping tree positions by an offset (for embedding in larger file)
 */
type MutableMappingTreeNode = {
  sourceRange: { start: number; end: number };
  generatedRange: { start: number; end: number };
  children: MutableMappingTreeNode[];
};

function shiftMappingTree(
  tree: MutableMappingTreeNode,
  originalOffset: number,
  transformedOffset: number,
): void {
  tree.sourceRange.start += originalOffset;
  tree.sourceRange.end += originalOffset;
  tree.generatedRange.start += transformedOffset;
  tree.generatedRange.end += transformedOffset;
  for (const child of tree.children) {
    shiftMappingTree(child, originalOffset, transformedOffset);
  }
}

function shiftGeneratedTree(tree: MutableMappingTreeNode, transformedOffset: number): void {
  tree.generatedRange.start += transformedOffset;
  tree.generatedRange.end += transformedOffset;
  for (const child of tree.children) {
    shiftGeneratedTree(child, transformedOffset);
  }
}

type ParsedTemplate = {
  contents: string;
  contentRange: { startUtf16Codepoint: number };
};

function normalizeParsedTemplates(parsed: unknown): ParsedTemplate[] {
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry) => {
    const contentRange = (entry as ParsedTemplate | undefined)?.contentRange;
    return typeof (entry as ParsedTemplate | undefined)?.contents === 'string'
      && typeof contentRange?.startUtf16Codepoint === 'number';
  }) as ParsedTemplate[];
}

function stripTemplateIndent(raw: string): {
  stripped: string;
  startLine: number;
  minIndent: number;
  rawLines: string[];
  rawLineOffsets: number[];
} {
  const rawLines = raw.split('\n');
  const normalizedLines = rawLines.map((line) => (
    line.endsWith('\r') ? line.slice(0, -1) : line
  ));
  let startLine = 0;
  while (startLine < normalizedLines.length && normalizedLines[startLine].trim() === '') {
    startLine += 1;
  }
  let endLine = normalizedLines.length - 1;
  while (endLine >= startLine && normalizedLines[endLine].trim() === '') {
    endLine -= 1;
  }
  const contentLines = normalizedLines.slice(startLine, endLine + 1);
  let minIndent = Number.POSITIVE_INFINITY;
  for (const line of contentLines) {
    if (line.trim() === '') continue;
    const match = line.match(/^[ \t]*/);
    const indent = match ? match[0].length : 0;
    if (indent < minIndent) minIndent = indent;
  }
  if (!Number.isFinite(minIndent)) {
    minIndent = 0;
  }
  const strippedLines = contentLines.map((line) => line.slice(Math.min(minIndent, line.length)));
  return {
    stripped: strippedLines.join('\n'),
    startLine,
    minIndent,
    rawLines: normalizedLines,
    rawLineOffsets: buildLineOffsets(raw),
  };
}

function remapMappingTreeWithParsed(
  mapping: MappingTreeNode,
  strippedTemplate: string,
  parsed: ParsedTemplate,
): MutableMappingTreeNode | null {
  const info = stripTemplateIndent(parsed.contents);
  if (info.stripped !== strippedTemplate) return null;

  const cloned = JSON.parse(JSON.stringify(mapping)) as MutableMappingTreeNode;
  const templateOffsets = buildLineOffsets(strippedTemplate);

  const mapOffset = (offset: number): number | null => {
    const { line, column } = offsetToLineColumn(templateOffsets, offset);
    const rawLineIndex = info.startLine + line;
    if (rawLineIndex >= info.rawLines.length) return null;
    const rawLine = info.rawLines[rawLineIndex];
    let rawColumn = column + info.minIndent;
    if (rawColumn > rawLine.length) {
      rawColumn = rawLine.length;
    }
    const rawOffset = info.rawLineOffsets[rawLineIndex] + rawColumn;
    return parsed.contentRange.startUtf16Codepoint + rawOffset;
  };

  const remapNode = (node: MutableMappingTreeNode): boolean => {
    const start = mapOffset(node.sourceRange.start);
    const end = mapOffset(node.sourceRange.end);
    if (start === null || end === null) return false;
    node.sourceRange.start = start;
    node.sourceRange.end = end;
    for (const child of node.children) {
      if (!remapNode(child)) return false;
    }
    return true;
  };

  return remapNode(cloned) ? cloned : null;
}

function processTransformedFiles(
  babelResult: BabelFileResult | null,
  hbsToProcess: ResolvedHBS[],
  flags: Flags,
  fileName: string,
  programResults: string[],
  originalSource: string,
  format: boolean = false,
): TransformResult {
  const txt = babelResult?.code ?? '';

  const globalFlags = flags;
  const processedTemplates: ProcessedTemplate[] = [];

  // Process each template using the new compiler
  hbsToProcess.forEach((content) => {
    const templateFlags = content.flags;
    const bindings = content.bindings;

    // Compile template with the new compiler
    // Pass format option for dev mode pretty-printing (happens during serialization so sourcemaps are preserved)
    // Use baseIndent of 6 spaces to match the function wrapper's indentation
    const result = compile(content.template, {
      bindings,
      filename: fileName,
      lexicalScope: content.lexicalScope,
      flags: {
        IS_GLIMMER_COMPAT_MODE: globalFlags.IS_GLIMMER_COMPAT_MODE ?? true,
      },
      format: format ? { enabled: true, baseIndent: '      ' } : false,
      diagnostics: {
        baseOffset: content.loc?.start.offset,
      },
    });

    // Throw on compiler errors
    if (result.errors.length > 0) {
      const error = result.errors[0];
      const formattedError = formatErrorForDisplay(error);
      throw new Error(formattedError);
    }

    // Check if template has complex content (for hasThisAccess detection)
    const ast = preprocess(content.template);
    const isSimple = isAllChildNodesSimpleElements(ast.body);
    if (!isSimple && templateFlags.hasThisAccess === false) {
      templateFlags.hasThisAccess = true;
    }

    processedTemplates.push({
      code: result.code,
      mapping: result.mappingTree,
      originalSource: content.template,
      originalLoc: content.loc,
      flags: templateFlags,
    });
  });

  // Generate wrapped function code for each template
  processedTemplates.forEach((template) => {
    const isClass = txt?.includes('template = ') ?? false;
    const isTemplateTag = fileName.endsWith('.gts') || fileName.endsWith('.gjs');

    let result = '';
    const finContext = template.flags.hasThisAccess ? 'this' : 'this';
    const hasFw = template.code.includes('$fw');
    const hasSlots = template.code.includes('$slots');
    const slotsResolution = `const $slots = ${SYMBOLS.$_GET_SLOTS}(this, arguments);`;
    const maybeFw = hasFw ? `const $fw = ${SYMBOLS.$_GET_FW}(this, arguments);` : '';
    const maybeSlots = hasSlots ? slotsResolution : '';
    const declareRoots = `const roots = ${template.code};`;
    const declareReturn = `return ${SYMBOLS.FINALIZE_COMPONENT}(roots, ${finContext});`;

    if (isTemplateTag) {
      result = `function () {
      ${maybeFw}
      ${SYMBOLS.$_GET_ARGS}(this, arguments);
      ${maybeSlots}
      ${declareRoots}
      ${declareReturn}
    }`;
    } else {
      result = isClass
        ? `() => {
      ${maybeSlots}
      ${maybeFw}
      ${declareRoots}
      ${declareReturn}
    }`
        : `(() => {
      ${SYMBOLS.$_GET_ARGS}(this, arguments);
      ${maybeSlots}
      ${maybeFw}
      ${declareRoots}
      ${declareReturn}
    })()`;
    }

    programResults.push(result);
  });

  // Build final code by replacing $placeholder markers
  let src = txt ?? '';
  const templateInsertPositions: { start: number; end: number; templateIndex: number }[] = [];

  programResults.forEach((result, index) => {
    const placeholderPos = src.indexOf('$placeholder');
    if (placeholderPos !== -1) {
      templateInsertPositions.push({
        start: placeholderPos,
        end: placeholderPos + result.length,
        templateIndex: index,
      });
      src = src.replace('$placeholder', result);
    }
  });

  const code = src.split('$:').join('');

  // Generate source map combining Babel's map with template mappings
  let map: SourceMapV3 | null = null;

  // Check if we have template source mappings to use
  if (processedTemplates.length > 0 && originalSource) {
    const parsedTemplates = normalizeParsedTemplates(p.parse(originalSource, { filename: fileName }));
    // Create a combined source map from all template mappings
    const allMappings: MutableMappingTreeNode[] = [];

    processedTemplates.forEach((template, index) => {
      const insertPos = templateInsertPositions[index];
      if (!insertPos) return;

      // Try to remap template using content-tag parse ranges (handles indentation stripping)
      const parsed = parsedTemplates[index];
      if (parsed) {
        const remapped = remapMappingTreeWithParsed(
          template.mapping,
          template.originalSource,
          parsed,
        );
        if (remapped) {
          const generatedCode = programResults[index];
          const rootsArrayStart = generatedCode.indexOf('[');
          if (rootsArrayStart !== -1) {
            shiftGeneratedTree(remapped, insertPos.start + rootsArrayStart);
            allMappings.push(remapped);
            return;
          }
        }
      }

      // Find the template content in the original source
      // Strategy:
      // 1. For .gts/.gjs files: look for <template> tags (content-tag preprocessing)
      // 2. For .ts/.js files: look for hbs`...` template literals
      // 3. Fall back to using babel's captured loc if available
      let originalOffset = -1;

      // Fallback: try to find <template> tags (for .gts/.gjs files)
      const templateTagRegex = /<template[^>]*>([\s\S]*?)<\/template>/g;
      let match;
      let matchIndex = 0;
      while ((match = templateTagRegex.exec(originalSource)) !== null) {
        if (matchIndex === index) {
          // The template content starts after <template>
          originalOffset = match.index + match[0].indexOf('>') + 1;
          break;
        }
        matchIndex++;
      }

      // If no <template> tags found, try hbs`...` template literals (for .ts/.js files)
      if (originalOffset === -1) {
        const hbsTemplateRegex = /hbs\s*`([^`]*)`/g;
        matchIndex = 0;
        while ((match = hbsTemplateRegex.exec(originalSource)) !== null) {
          if (matchIndex === index) {
            // The template content starts after hbs`
            originalOffset = match.index + match[0].indexOf('`') + 1;
            break;
          }
          matchIndex++;
        }
      }

      // If still not found, use babel's captured loc (line/column to offset)
      if (originalOffset === -1 && template.originalLoc) {
        originalOffset = lineColumnToOffset(
          originalSource,
          template.originalLoc.start.line,
          template.originalLoc.start.column,
        );
      }

      // If we found the template position, create shifted mappings
      if (originalOffset !== -1) {
        // Clone and shift the mapping tree
        const shiftedMapping = JSON.parse(JSON.stringify(template.mapping)) as MutableMappingTreeNode;

        const generatedCode = programResults[index];
        const rootsArrayStart = generatedCode.indexOf('[');

        if (rootsArrayStart !== -1) {
          shiftMappingTree(
            shiftedMapping,
            originalOffset,
            insertPos.start + rootsArrayStart,
          );
          allMappings.push(shiftedMapping);
        }
      }
    });

    // Generate source map from the combined mappings
    if (allMappings.length > 0) {
      // Use basenames following Svelte's approach - sourcesContent has the full source
      const sourceBasename = getBasename(fileName);
      const outputBasename = sourceBasename.replace('.gts', '.js').replace('.gjs', '.js');

      // Merge all template mappings into a single root node
      const rootMapping: MappingTreeNode = allMappings.length === 1
        ? (allMappings[0] as MappingTreeNode)
        : {
            sourceRange: { start: 0, end: originalSource.length },
            generatedRange: { start: 0, end: code.length },
            children: allMappings as MappingTreeNode[],
            sourceNode: 'Template',
          };

      map = generateSourceMap(rootMapping, originalSource, code, {
        file: sourceBasename,
        includeContent: true,
        sourceContent: originalSource,
      });

      // Match Vite/Svelte conventions: sources are basenames, output file is .js
      map.file = outputBasename;
    }
  }

  // Fall back to Babel's source map if no template source map was generated
  if (!map && babelResult?.map) {
    // Use basenames following Svelte's approach
    const sourceBasename = getBasename(fileName);
    const outputBasename = sourceBasename.replace('.gts', '.js').replace('.gjs', '.js').replace('.ts', '.js');
    map = {
      version: 3,
      file: outputBasename,
      sources: [sourceBasename],
      sourcesContent: originalSource ? [originalSource] : (babelResult.map.sourcesContent as (string | null)[] | undefined),
      names: babelResult.map.names as string[],
      mappings: babelResult.map.mappings as string,
    };
  }

  return { code, map };
}

export function transform(
  source: string,
  fileName: string,
  mode: 'development' | 'production',
  isLibBuild: boolean = false,
  flags: Flags = defaultFlags(),
  originalGtsSource?: string,
): TransformResult | Promise<TransformResult> {
  const rawTxt: string = source;
  const hbsToProcess: ResolvedHBS[] = [];
  const programResults: string[] = [];
  const isAsync = flags.ASYNC_COMPILE_TRANSFORMS;

  const plugins: PluginItem[] = [processTemplate(hbsToProcess, mode)];
  if (!isLibBuild) {
    plugins.push('module:decorator-transforms');
  }
  const replacedFileName = fileName
    .replace('.gts', '.ts')
    .replace('.gjs', '.js');
  const babelConfig = {
    plugins,
    filename: replacedFileName,
    presets: [
      [
        '@babel/preset-typescript',
        { allExtensions: true, onlyRemoveTypeImports: true, allowDeclareFields: true },
      ],
    ],
    // Enable source maps
    sourceMaps: true,
    sourceFileName: fileName,
  };

  // Use original GTS source for source maps if available, otherwise fall back to preprocessed source
  const sourceForMaps = originalGtsSource || rawTxt;
  const preprocessed = p.process(rawTxt, { filename: fileName });
  const intermediate = preprocessed.code;

  if (isAsync) {
    return transformAsync(intermediate, babelConfig).then((babelResult) => {
      return processTransformedFiles(
        babelResult,
        hbsToProcess,
        flags,
        fileName,
        programResults,
        sourceForMaps,
        mode === 'development', // Enable formatting in dev mode
      );
    });
  } else {
    const babelResult = transformSync(intermediate, babelConfig);
    return processTransformedFiles(
      babelResult,
      hbsToProcess,
      flags,
      fileName,
      programResults,
      sourceForMaps,
      mode === 'development', // Enable formatting in dev mode
    );
  }
}
