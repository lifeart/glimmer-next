/**
 * Mapping Tree
 *
 * Hierarchical structure for tracking source-to-generated mappings.
 * Similar to Glint's GlimmerASTMappingTree.
 */

import type {
  SourceRange,
  MappingSource,
  CodeInformation,
  MappingTreeNode,
  CodeMapping,
} from './types';

/**
 * Default code information - all features enabled
 */
const DEFAULT_CODE_INFO: CodeInformation = {
  semanticTokens: true,
  completion: true,
  navigation: true,
  verification: true,
  rename: true,
};

/**
 * Hierarchical mapping tree for tracking source positions through transformation.
 */
export class MappingTree implements MappingTreeNode {
  public transformedRange: SourceRange;
  public originalRange: SourceRange;
  public children: MappingTree[] = [];
  public sourceNode: MappingSource;
  public name?: string;
  public codeInformation: CodeInformation;

  constructor(
    sourceNode: MappingSource,
    originalRange: SourceRange,
    transformedRange: SourceRange,
    codeInformation: CodeInformation = DEFAULT_CODE_INFO,
    name?: string,
  ) {
    this.sourceNode = sourceNode;
    this.originalRange = originalRange;
    this.transformedRange = transformedRange;
    this.codeInformation = codeInformation;
    this.name = name;
  }

  /**
   * Add a child mapping
   */
  addChild(child: MappingTree): void {
    this.children.push(child);
  }

  /**
   * Create a child mapping and add it
   */
  createChild(
    sourceNode: MappingSource,
    originalRange: SourceRange,
    transformedRange: SourceRange,
    codeInformation?: CodeInformation,
    name?: string,
  ): MappingTree {
    const child = new MappingTree(
      sourceNode,
      originalRange,
      transformedRange,
      codeInformation ?? this.codeInformation,
      name,
    );
    this.addChild(child);
    return child;
  }

  /**
   * Find the narrowest (most specific) mapping containing the given transformed offset
   */
  findNarrowestAtTransformedOffset(offset: number): MappingTree | null {
    if (!this.containsTransformedOffset(offset)) {
      return null;
    }

    // Check children first (they are more specific)
    for (const child of this.children) {
      const found = child.findNarrowestAtTransformedOffset(offset);
      if (found) {
        return found;
      }
    }

    return this;
  }

  /**
   * Find the narrowest mapping containing the given original offset
   */
  findNarrowestAtOriginalOffset(offset: number): MappingTree | null {
    if (!this.containsOriginalOffset(offset)) {
      return null;
    }

    for (const child of this.children) {
      const found = child.findNarrowestAtOriginalOffset(offset);
      if (found) {
        return found;
      }
    }

    return this;
  }

  /**
   * Find all mappings that overlap with the given original range
   */
  findOverlappingOriginal(range: SourceRange): MappingTree[] {
    const results: MappingTree[] = [];

    if (this.overlapsOriginal(range)) {
      results.push(this);
      for (const child of this.children) {
        results.push(...child.findOverlappingOriginal(range));
      }
    }

    return results;
  }

  /**
   * Find all mappings that overlap with the given transformed range
   */
  findOverlappingTransformed(range: SourceRange): MappingTree[] {
    const results: MappingTree[] = [];

    if (this.overlapsTransformed(range)) {
      results.push(this);
      for (const child of this.children) {
        results.push(...child.findOverlappingTransformed(range));
      }
    }

    return results;
  }

  /**
   * Check if this mapping contains the transformed offset
   */
  containsTransformedOffset(offset: number): boolean {
    return (
      offset >= this.transformedRange.start &&
      offset < this.transformedRange.end
    );
  }

  /**
   * Check if this mapping contains the original offset
   */
  containsOriginalOffset(offset: number): boolean {
    return (
      offset >= this.originalRange.start && offset < this.originalRange.end
    );
  }

  /**
   * Check if this mapping overlaps with the original range
   */
  overlapsOriginal(range: SourceRange): boolean {
    return (
      this.originalRange.start < range.end &&
      this.originalRange.end > range.start
    );
  }

  /**
   * Check if this mapping overlaps with the transformed range
   */
  overlapsTransformed(range: SourceRange): boolean {
    return (
      this.transformedRange.start < range.end &&
      this.transformedRange.end > range.start
    );
  }

  /**
   * Get the relative offset within this mapping for a transformed offset
   */
  getRelativeTransformedOffset(offset: number): number {
    return offset - this.transformedRange.start;
  }

  /**
   * Get the relative offset within this mapping for an original offset
   */
  getRelativeOriginalOffset(offset: number): number {
    return offset - this.originalRange.start;
  }

  /**
   * Convert to flat CodeMapping array (Volar-compatible format)
   */
  toCodeMappings(): CodeMapping[] {
    const mappings: CodeMapping[] = [];
    this.collectMappings(mappings);
    return mappings;
  }

  private collectMappings(mappings: CodeMapping[]): void {
    // Add this node's mapping
    const originalLength = this.originalRange.end - this.originalRange.start;
    const transformedLength =
      this.transformedRange.end - this.transformedRange.start;

    if (originalLength > 0 || transformedLength > 0) {
      // For size-mismatched mappings, use zero-length boundaries
      if (originalLength !== transformedLength) {
        // Start boundary (zero-length)
        mappings.push({
          sourceOffsets: [this.originalRange.start],
          generatedOffsets: [this.transformedRange.start],
          lengths: [0],
          data: this.codeInformation,
        });

        // End boundary (zero-length)
        mappings.push({
          sourceOffsets: [this.originalRange.end],
          generatedOffsets: [this.transformedRange.end],
          lengths: [0],
          data: this.codeInformation,
        });
      } else {
        // Same-size mapping
        mappings.push({
          sourceOffsets: [this.originalRange.start],
          generatedOffsets: [this.transformedRange.start],
          lengths: [originalLength],
          data: this.codeInformation,
        });
      }
    }

    // Collect from children
    for (const child of this.children) {
      child.collectMappings(mappings);
    }
  }

  /**
   * Create a debug string representation
   */
  toDebugString(indent: number = 0): string {
    const prefix = '  '.repeat(indent);
    const origRange = `[${this.originalRange.start}-${this.originalRange.end}]`;
    const transRange = `[${this.transformedRange.start}-${this.transformedRange.end}]`;

    let result = `${prefix}${this.sourceNode} ${origRange} → ${transRange}\n`;

    for (const child of this.children) {
      result += child.toDebugString(indent + 1);
    }

    return result;
  }

  /**
   * Clone this mapping tree
   */
  clone(): MappingTree {
    const cloned = new MappingTree(
      this.sourceNode,
      { ...this.originalRange },
      { ...this.transformedRange },
      { ...this.codeInformation },
    );

    for (const child of this.children) {
      cloned.addChild(child.clone());
    }

    return cloned;
  }

  /**
   * Shift all ranges by an offset (useful when embedding in larger document)
   */
  shiftOriginal(offset: number): void {
    this.originalRange.start += offset;
    this.originalRange.end += offset;

    for (const child of this.children) {
      child.shiftOriginal(offset);
    }
  }

  /**
   * Shift transformed ranges by an offset
   */
  shiftTransformed(offset: number): void {
    this.transformedRange.start += offset;
    this.transformedRange.end += offset;

    for (const child of this.children) {
      child.shiftTransformed(offset);
    }
  }
}

/**
 * Create a root mapping tree for a template
 */
export function createRootMapping(
  originalLength: number,
  transformedLength: number,
): MappingTree {
  return new MappingTree(
    'Template',
    { start: 0, end: originalLength },
    { start: 0, end: transformedLength },
  );
}
