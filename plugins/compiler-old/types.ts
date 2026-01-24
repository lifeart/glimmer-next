/**
 * Converter V2 Types
 *
 * Glint-style source mapping infrastructure for template-to-JavaScript transformation.
 */

import type { ASTv1 } from '@glimmer/syntax';

/**
 * Represents a range in source code
 */
export interface SourceRange {
  start: number;
  end: number;
}

/**
 * Source location with line/column information
 */
export interface SourceLocation {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

/**
 * Code information for controlling language features
 * Similar to Volar's CodeInformation
 */
export interface CodeInformation {
  /** Enable semantic tokens */
  semanticTokens?: boolean;
  /** Enable completions */
  completion?: boolean;
  /** Enable navigation (go to definition, references) */
  navigation?: boolean;
  /** Enable verification (type checking, diagnostics) */
  verification?: boolean;
  /** Enable rename refactoring */
  rename?: boolean;
}

/**
 * A mapping between source and generated code ranges
 */
export interface CodeMapping {
  /** Offsets in the source (original) code */
  sourceOffsets: number[];
  /** Offsets in the generated (transformed) code */
  generatedOffsets: number[];
  /** Lengths of each mapped region */
  lengths: number[];
  /** Code information for this mapping */
  data: CodeInformation;
}

/**
 * Mapping source - what AST node type created this mapping
 */
export type MappingSource =
  | 'Template'
  | 'ElementNode'
  | 'TextNode'
  | 'MustacheStatement'
  | 'BlockStatement'
  | 'SubExpression'
  | 'PathExpression'
  | 'StringLiteral'
  | 'NumberLiteral'
  | 'BooleanLiteral'
  | 'NullLiteral'
  | 'UndefinedLiteral'
  | 'ConcatStatement'
  | 'AttrNode'
  | 'HashPair'
  | 'Comment'
  | 'Identifier'
  | 'Synthetic'; // Generated code with no direct source

/**
 * A directive from template comments (@glint-ignore, @glint-expect-error)
 */
export interface Directive {
  kind: 'ignore' | 'expect-error' | 'nocheck';
  /** Range in original source where directive applies */
  areaOfEffect: SourceRange;
  /** Location of the directive comment itself */
  location: SourceRange;
}

/**
 * Error that occurred during transformation
 */
export interface TransformError {
  message: string;
  location?: SourceLocation;
  source?: string;
}

/**
 * Result of mapping template contents
 */
export interface RewriteResult {
  /** The generated code */
  code: string;
  /** The mapping tree for this transformation */
  mapping: MappingTreeNode;
  /** Any directives found in the template */
  directives: Directive[];
  /** Any errors encountered */
  errors: TransformError[];
}

/**
 * Node in the mapping tree
 */
export interface MappingTreeNode {
  /** Range in the generated/transformed code */
  transformedRange: SourceRange;
  /** Range in the original source code */
  originalRange: SourceRange;
  /** Child mappings (hierarchical) */
  children: MappingTreeNode[];
  /** What AST node type created this mapping */
  sourceNode: MappingSource;
  /** Identifier name for source map `names` array (enables debugger hover resolution) */
  name?: string;
  /** Code information for language features */
  codeInformation?: CodeInformation;
  /** Clone this node and all children */
  clone(): MappingTreeNode;
  /** Shift original range by offset */
  shiftOriginal(offset: number): void;
  /** Shift transformed range by offset */
  shiftTransformed(offset: number): void;
  /** Add a child mapping */
  addChild(child: MappingTreeNode): void;
  /** Convert to flat CodeMapping array (Volar-compatible format) */
  toCodeMappings(): CodeMapping[];
}

/**
 * Options for the Mapper
 */
export interface MapperOptions {
  /** The original template source */
  template: string;
  /** Starting offset in the containing file */
  templateOffset?: number;
}

/**
 * A correlated span linking source to transformed code
 */
export interface CorrelatedSpan {
  /** Start offset in original source */
  originalStart: number;
  /** Length in original source */
  originalLength: number;
  /** Start offset in transformed code */
  transformedStart: number;
  /** Length in transformed code */
  transformedLength: number;
  /** The transformed source code for this span */
  transformedSource: string;
  /** Hierarchical mapping tree for Glimmer templates */
  mappingTree?: MappingTreeNode;
}

/**
 * Input for module rewriting
 */
export interface RewriteInput {
  /** The script content */
  script: string;
  /** The filename */
  filename: string;
}

/**
 * Intermediate node representation with location info
 */
export interface HBSNodeV2 {
  tag: string;
  attributes: [string, unknown, SourceRange?][];
  properties: [string, unknown, SourceRange?][];
  selfClosing: boolean;
  hasStableChild: boolean;
  blockParams: string[];
  events: [string, string, SourceRange?][];
  children: (string | HBSNodeV2 | HBSControlExpressionV2)[];
  /** Original source range */
  loc?: SourceRange;
}

/**
 * Control expression with location info
 */
export interface HBSControlExpressionV2 {
  type: 'each' | 'if' | 'in-element' | 'yield';
  isControl: true;
  condition: string;
  blockParams: string[];
  children: (string | HBSNodeV2 | HBSControlExpressionV2)[];
  inverse: (string | HBSNodeV2 | HBSControlExpressionV2)[] | null;
  key: string | null;
  isSync: boolean;
  /** Original source range */
  loc?: SourceRange;
}

export type ComplexJSTypeV2 = null | number | string | boolean | undefined | HBSControlExpressionV2 | HBSNodeV2;

/**
 * Get the range from a Glimmer AST node
 */
export function getNodeRange(node: ASTv1.Node): SourceRange {
  if (!node.loc) {
    return { start: 0, end: 0 };
  }
  // In codemod mode, Glimmer adds offset to SourcePosition
  const loc = node.loc as { start: { offset?: number }; end: { offset?: number } };
  return {
    start: loc.start.offset ?? 0,
    end: loc.end.offset ?? 0,
  };
}

/**
 * Get SourceLocation from a Glimmer AST node
 */
export function getSourceLocation(node: ASTv1.Node): SourceLocation | undefined {
  if (!node.loc) {
    return undefined;
  }
  return {
    start: { line: node.loc.start.line, column: node.loc.start.column },
    end: { line: node.loc.end.line, column: node.loc.end.column },
  };
}
