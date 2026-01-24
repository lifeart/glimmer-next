/**
 * Adapter Layer for Backward Compatibility
 *
 * This module provides compatibility with the old converter-v2 API
 * while using the new compiler internally. This allows gradual migration.
 */

import type { Flags } from '../flags';
import type {
  MappingTreeNode as OldMappingTreeNode,
  RewriteResult,
  SourceRange,
  Directive,
  TransformError,
} from '../compiler-old/types';
import { compile, type CompileOptions, type MappingTreeNode } from './index';
import { offsetToLineColumn, formatErrorForDisplay } from './errors';

/**
 * Format options for template compilation.
 */
export interface TemplateFormatOptions {
  /** Whether to format output (for dev mode readability) */
  enabled?: boolean;
  /** Base indentation to prepend to all output lines */
  baseIndent?: string;
}

/**
 * Convert a template string to JavaScript with source mapping.
 * This function provides the same API as converter-v2's templateToTypescript.
 *
 * @param template - The template source string
 * @param flags - Compiler flags
 * @param bindings - Set of known bindings (component names, etc.)
 * @param format - Whether to format output (for dev mode readability), or format options object
 * @returns RewriteResult compatible with converter-v2
 */
export function templateToTypescript(
  template: string,
  flags: Flags,
  bindings: Set<string> = new Set(),
  format: boolean | TemplateFormatOptions = false
): RewriteResult {
  // Normalize format option
  const formatOptions = typeof format === 'boolean'
    ? (format ? { enabled: true } : undefined)
    : (format.enabled ? format : undefined);

  // Convert flags to new compiler options
  const options: CompileOptions = {
    bindings,
    flags: {
      IS_GLIMMER_COMPAT_MODE: flags.IS_GLIMMER_COMPAT_MODE ?? true,
    },
    // Enable formatting for dev mode - this happens during serialization
    // so sourcemaps are generated for the formatted output
    format: formatOptions,
  };

  // Use the new compiler
  const result = compile(template, options);

  // Convert the new mapping tree format to the old format
  const mapping = convertMappingTree(result.mappingTree);

  // Convert errors to old format
  const errors: TransformError[] = result.errors.map((err) => {
    const loc: TransformError['location'] = err.sourceRange ? {
      start: { line: err.line!, column: err.column! },
      end: offsetToLineColumn(template, err.sourceRange.end)
    } : undefined;

    return {
      message: formatErrorForDisplay(err),
      source: err.code,
      location: loc,
    };
  });

  return {
    code: result.code,
    mapping,
    directives: [], // New compiler doesn't handle directives yet
    errors,
  };
}

/**
 * Convert the new MappingTreeNode format to the old format.
 * The old format uses:
 * - transformedRange (instead of generatedRange)
 * - originalRange (instead of sourceRange)
 * - Methods for cloning and shifting
 */
function convertMappingTree(node: MappingTreeNode): OldMappingTreeNode {
  const result: OldMappingTreeNode = {
    transformedRange: {
      start: node.generatedRange.start,
      end: node.generatedRange.end,
    },
    originalRange: {
      start: node.sourceRange.start,
      end: node.sourceRange.end,
    },
    children: node.children.map(convertMappingTree),
    sourceNode: node.sourceNode as OldMappingTreeNode['sourceNode'],
    name: node.name,

    // Add methods required by old API
    clone(): OldMappingTreeNode {
      return convertMappingTree({
        sourceRange: { ...node.sourceRange },
        generatedRange: { ...node.generatedRange },
        sourceNode: node.sourceNode,
        children: node.children.map((c) => ({
          sourceRange: { ...c.sourceRange },
          generatedRange: { ...c.generatedRange },
          sourceNode: c.sourceNode,
          children: [...c.children],
        })),
      });
    },

    shiftOriginal(offset: number): void {
      result.originalRange.start += offset;
      result.originalRange.end += offset;
      for (const child of result.children) {
        child.shiftOriginal(offset);
      }
    },

    shiftTransformed(offset: number): void {
      result.transformedRange.start += offset;
      result.transformedRange.end += offset;
      for (const child of result.children) {
        child.shiftTransformed(offset);
      }
    },

    addChild(child: OldMappingTreeNode): void {
      result.children.push(child);
    },

    toCodeMappings(): import('../compiler-old/types').CodeMapping[] {
      // For adapter compatibility, return empty array
      // Full implementation would require collecting mappings from the tree
      return [];
    },
  };

  return result;
}

/**
 * Create a converter compatible with the old convert() API.
 * This is provided for backward compatibility during migration.
 *
 * @deprecated Use compile() directly instead
 */
export function createLegacyConverter(
  _seenNodes: Set<unknown>,
  flags: Flags,
  bindings: Set<string>,
  _template: string
) {
  // The new compiler doesn't need seenNodes or template passed here
  // since it handles everything internally
  // Note: bindings and flags are available for the returned functions if needed
  void bindings; // Mark as used
  void flags; // Mark as used

  return {
    // These functions are provided for compatibility but use the new compiler
    // The actual conversion happens in compile(), not here
    ToJSType: () => {
      console.warn('createLegacyConverter().ToJSType() is deprecated. Use compile() directly.');
      return null;
    },
    ElementToNode: () => {
      console.warn('createLegacyConverter().ElementToNode() is deprecated. Use compile() directly.');
      return null;
    },
  };
}

// Re-export types for convenience
export type { RewriteResult, SourceRange, Directive, TransformError };
