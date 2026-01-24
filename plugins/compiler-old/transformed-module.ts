/**
 * Transformed Module
 *
 * Result container with bidirectional offset translation.
 * Similar to Glint's TransformedModule.
 */

import type {
  SourceRange,
  Directive,
  TransformError,
  CorrelatedSpan,
  CodeMapping,
  MappingTreeNode,
} from './types';
import { MappingTree } from './mapping-tree';

/**
 * Result of a template transformation with bidirectional source mapping
 */
export class TransformedModule {
  public readonly transformedContents: string;
  public readonly originalContents: string;
  public readonly errors: ReadonlyArray<TransformError>;
  public readonly directives: ReadonlyArray<Directive>;
  public readonly correlatedSpans: ReadonlyArray<CorrelatedSpan>;
  private readonly mappingTree: MappingTree;

  constructor(options: {
    transformedContents: string;
    originalContents: string;
    errors?: TransformError[];
    directives?: Directive[];
    correlatedSpans?: CorrelatedSpan[];
    mappingTree: MappingTree;
  }) {
    this.transformedContents = options.transformedContents;
    this.originalContents = options.originalContents;
    this.errors = options.errors ?? [];
    this.directives = options.directives ?? [];
    this.correlatedSpans = options.correlatedSpans ?? [];
    this.mappingTree = options.mappingTree;
  }

  /**
   * Get the original offset for a transformed offset
   */
  getOriginalOffset(transformedOffset: number): {
    offset: number;
    found: boolean;
    mapping?: MappingTreeNode;
  } {
    const mapping = this.mappingTree.findNarrowestAtTransformedOffset(transformedOffset);

    if (!mapping) {
      return { offset: 0, found: false };
    }

    // Calculate relative position within the mapping
    const relativeOffset = mapping.getRelativeTransformedOffset(transformedOffset);
    const originalLength = mapping.originalRange.end - mapping.originalRange.start;
    const transformedLength = mapping.transformedRange.end - mapping.transformedRange.start;

    // If lengths match, direct mapping
    if (originalLength === transformedLength) {
      return {
        offset: mapping.originalRange.start + relativeOffset,
        found: true,
        mapping,
      };
    }

    // For size-mismatched mappings, map to start of original
    // (could be improved with more sophisticated mapping)
    if (relativeOffset === 0) {
      return {
        offset: mapping.originalRange.start,
        found: true,
        mapping,
      };
    }

    // Map to proportional position
    const proportion = relativeOffset / transformedLength;
    const originalOffset = Math.floor(mapping.originalRange.start + proportion * originalLength);

    return {
      offset: Math.min(originalOffset, mapping.originalRange.end - 1),
      found: true,
      mapping,
    };
  }

  /**
   * Get the transformed offset for an original offset
   */
  getTransformedOffset(originalOffset: number): {
    offset: number;
    found: boolean;
    mapping?: MappingTreeNode;
  } {
    const mapping = this.mappingTree.findNarrowestAtOriginalOffset(originalOffset);

    if (!mapping) {
      return { offset: 0, found: false };
    }

    const relativeOffset = mapping.getRelativeOriginalOffset(originalOffset);
    const originalLength = mapping.originalRange.end - mapping.originalRange.start;
    const transformedLength = mapping.transformedRange.end - mapping.transformedRange.start;

    if (originalLength === transformedLength) {
      return {
        offset: mapping.transformedRange.start + relativeOffset,
        found: true,
        mapping,
      };
    }

    if (relativeOffset === 0) {
      return {
        offset: mapping.transformedRange.start,
        found: true,
        mapping,
      };
    }

    const proportion = relativeOffset / originalLength;
    const transformedOffset = Math.floor(
      mapping.transformedRange.start + proportion * transformedLength,
    );

    return {
      offset: Math.min(transformedOffset, mapping.transformedRange.end - 1),
      found: true,
      mapping,
    };
  }

  /**
   * Get the transformed range for an original range
   */
  getTransformedRange(originalStart: number, originalEnd: number): SourceRange | null {
    const startResult = this.getTransformedOffset(originalStart);
    const endResult = this.getTransformedOffset(originalEnd);

    if (!startResult.found || !endResult.found) {
      return null;
    }

    return {
      start: startResult.offset,
      end: endResult.offset,
    };
  }

  /**
   * Get the original range for a transformed range
   */
  getOriginalRange(transformedStart: number, transformedEnd: number): SourceRange | null {
    const startResult = this.getOriginalOffset(transformedStart);
    const endResult = this.getOriginalOffset(transformedEnd);

    if (!startResult.found || !endResult.found) {
      return null;
    }

    return {
      start: startResult.offset,
      end: endResult.offset,
    };
  }

  /**
   * Convert to Volar-compatible CodeMapping array
   */
  toCodeMappings(): CodeMapping[] {
    return this.mappingTree.toCodeMappings();
  }

  /**
   * Get the mapping tree for inspection
   */
  getMappingTree(): MappingTree {
    return this.mappingTree;
  }

  /**
   * Get a debug string showing all mappings
   */
  toDebugString(): string {
    let result = '=== TransformedModule ===\n\n';

    result += '--- Original ---\n';
    result += this.originalContents + '\n\n';

    result += '--- Transformed ---\n';
    result += this.transformedContents + '\n\n';

    result += '--- Mapping Tree ---\n';
    result += this.mappingTree.toDebugString();

    if (this.errors.length > 0) {
      result += '\n--- Errors ---\n';
      for (const error of this.errors) {
        result += `  ${error.message}`;
        if (error.location) {
          result += ` at ${error.location.start.line}:${error.location.start.column}`;
        }
        result += '\n';
      }
    }

    if (this.directives.length > 0) {
      result += '\n--- Directives ---\n';
      for (const directive of this.directives) {
        result += `  @glint-${directive.kind} at [${directive.location.start}-${directive.location.end}]\n`;
      }
    }

    return result;
  }

  /**
   * Check if a directive applies to a given original offset
   */
  hasDirectiveAt(offset: number, kind?: Directive['kind']): boolean {
    return this.directives.some((d) => {
      if (kind && d.kind !== kind) return false;
      return offset >= d.areaOfEffect.start && offset < d.areaOfEffect.end;
    });
  }

  /**
   * Get all mappings overlapping with an original range
   */
  getMappingsForOriginalRange(start: number, end: number): MappingTreeNode[] {
    return this.mappingTree.findOverlappingOriginal({ start, end });
  }

  /**
   * Get all mappings overlapping with a transformed range
   */
  getMappingsForTransformedRange(start: number, end: number): MappingTreeNode[] {
    return this.mappingTree.findOverlappingTransformed({ start, end });
  }
}

/**
 * Builder for creating TransformedModule instances
 */
export class TransformedModuleBuilder {
  private transformedParts: string[] = [];
  private correlatedSpans: CorrelatedSpan[] = [];
  private errors: TransformError[] = [];
  private directives: Directive[] = [];
  private currentTransformedOffset = 0;

  constructor(private readonly originalContents: string) {}

  /**
   * Add a correlated span (mapping between original and transformed)
   */
  addCorrelatedSpan(
    originalStart: number,
    originalLength: number,
    transformedSource: string,
    mappingTree?: MappingTree,
  ): this {
    const span: CorrelatedSpan = {
      originalStart,
      originalLength,
      transformedStart: this.currentTransformedOffset,
      transformedLength: transformedSource.length,
      transformedSource,
      mappingTree,
    };

    this.correlatedSpans.push(span);
    this.transformedParts.push(transformedSource);
    this.currentTransformedOffset += transformedSource.length;

    return this;
  }

  /**
   * Add untransformed content (passed through as-is)
   */
  addPassthrough(originalStart: number, originalEnd: number): this {
    const content = this.originalContents.slice(originalStart, originalEnd);
    return this.addCorrelatedSpan(originalStart, originalEnd - originalStart, content);
  }

  /**
   * Add an error
   */
  addError(error: TransformError): this {
    this.errors.push(error);
    return this;
  }

  /**
   * Add a directive
   */
  addDirective(directive: Directive): this {
    this.directives.push(directive);
    return this;
  }

  /**
   * Build the final TransformedModule
   */
  build(): TransformedModule {
    const transformedContents = this.transformedParts.join('');

    // Build a combined mapping tree from all correlated spans
    const rootMapping = new MappingTree(
      'Template',
      { start: 0, end: this.originalContents.length },
      { start: 0, end: transformedContents.length },
    );

    for (const span of this.correlatedSpans) {
      if (span.mappingTree) {
        // Clone and shift the mapping tree
        const cloned = span.mappingTree.clone() as MappingTree;
        cloned.shiftOriginal(span.originalStart);
        cloned.shiftTransformed(span.transformedStart);
        rootMapping.addChild(cloned);
      } else {
        // Create a simple mapping for passthrough content
        const mapping = new MappingTree(
          'Synthetic',
          { start: span.originalStart, end: span.originalStart + span.originalLength },
          { start: span.transformedStart, end: span.transformedStart + span.transformedLength },
        );
        rootMapping.addChild(mapping);
      }
    }

    return new TransformedModule({
      transformedContents,
      originalContents: this.originalContents,
      errors: this.errors,
      directives: this.directives,
      correlatedSpans: this.correlatedSpans,
      mappingTree: rootMapping,
    });
  }
}
