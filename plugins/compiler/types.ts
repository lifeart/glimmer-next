/**
 * Core type definitions for the new compiler architecture.
 * All types are explicitly defined here to ensure type safety throughout.
 */

// ============================================================================
// Source Range & Mapping Types
// ============================================================================

/**
 * Represents a range in the source code.
 */
export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Represents a range in the generated code.
 */
export interface GeneratedRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Types of AST nodes that can be mapped.
 */
export type MappingSource =
  | 'Template'
  | 'ElementNode'
  | 'TextNode'
  | 'MustacheStatement'
  | 'BlockStatement'
  | 'PathExpression'
  | 'StringLiteral'
  | 'NumberLiteral'
  | 'BooleanLiteral'
  | 'NullLiteral'
  | 'UndefinedLiteral'
  | 'SubExpression'
  | 'Hash'
  | 'HashPair'
  | 'AttrNode'
  | 'ConcatStatement'
  | 'ComponentNode'
  | 'ControlNode'
  | 'SlotNode'
  | 'Synthetic';

/**
 * A node in the mapping tree representing source-to-generated mappings.
 */
export interface MappingTreeNode {
  readonly sourceRange: SourceRange;
  readonly generatedRange: GeneratedRange;
  readonly sourceNode: MappingSource;
  readonly children: MappingTreeNode[];
  /** Identifier name for source map `names` array (enables debugger hover resolution) */
  readonly name?: string;
}

// ============================================================================
// Compiler Flags
// ============================================================================

/**
 * Immutable compiler configuration flags.
 */
export interface CompilerFlags {
  readonly IS_GLIMMER_COMPAT_MODE: boolean;
  readonly WITH_HELPER_MANAGER: boolean;
  readonly WITH_MODIFIER_MANAGER: boolean;
}

/**
 * Diagnostic formatting options.
 */
export interface DiagnosticsOptions {
  /** Number of context lines to include around diagnostics. Default: 1 */
  readonly contextLines?: number;
  /** Optional filename to include in diagnostics */
  readonly filename?: string;
  /** Base offset to add to all source ranges (for templates inside larger files) */
  readonly baseOffset?: number;
}

/**
 * Default compiler flags.
 */
export const DEFAULT_FLAGS: CompilerFlags = Object.freeze({
  IS_GLIMMER_COMPAT_MODE: true,
  WITH_HELPER_MANAGER: false, // Must match runtime default (plugins/flags.ts)
  WITH_MODIFIER_MANAGER: false, // Must match runtime default (plugins/flags.ts)
});

/**
 * Creates compiler flags with optional overrides.
 */
export function createFlags(overrides: Partial<CompilerFlags> = {}): CompilerFlags {
  return Object.freeze({
    ...DEFAULT_FLAGS,
    ...overrides,
  });
}

// ============================================================================
// Binding Types
// ============================================================================

/**
 * Types of bindings that can exist in a scope.
 */
export type BindingKind =
  | 'component'    // Imported/local component
  | 'helper'       // Helper function
  | 'modifier'     // Modifier function
  | 'block-param'  // Block parameter (e.g., |item| in {{#each}})
  | 'let-binding'  // Let block binding
  | 'arg'          // Component argument (@arg)
  | 'this';        // this context

/**
 * Information about a binding in a scope.
 */
export interface BindingInfo {
  readonly kind: BindingKind;
  readonly name: string;
  readonly originalName?: string;  // For renamed bindings
  readonly sourceRange?: SourceRange;
}

// ============================================================================
// Serialized Value Types (Replaces $: magic strings)
// ============================================================================

/**
 * Base interface for all serialized values.
 */
interface SerializedValueBase {
  readonly sourceRange?: SourceRange;
}

/**
 * A literal value (string, number, boolean, null, undefined).
 */
export interface LiteralValue extends SerializedValueBase {
  readonly kind: 'literal';
  readonly value: string | number | boolean | null | undefined;
}

/**
 * A path expression (e.g., this.foo.bar, @arg).
 */
interface PathValueBase extends SerializedValueBase {
  readonly kind: 'path';
  readonly expression: string;
  readonly isArg: boolean;
}

export type PathValue =
  | (PathValueBase & {
      readonly parts: readonly PathPart[];
      readonly rootRange?: SourceRange;
    })
  | (PathValueBase & {
      readonly parts?: undefined;
      readonly rootRange?: undefined;
    });

export interface PathPart {
  readonly name: string;
  readonly range?: SourceRange;
}

/**
 * A spread expression (e.g., ...attributes).
 */
export interface SpreadValue extends SerializedValueBase {
  readonly kind: 'spread';
  readonly expression: string;
}

/**
 * Raw JavaScript code (already serialized).
 */
export interface RawValue extends SerializedValueBase {
  readonly kind: 'raw';
  readonly code: string;
}

/**
 * A helper/subexpression call.
 */
export interface HelperValue extends SerializedValueBase {
  readonly kind: 'helper';
  readonly name: string;
  readonly positional: SerializedValue[];
  readonly named: Map<string, SerializedValue>;
  /** Source range of the helper path expression (for source map name resolution) */
  readonly pathRange?: SourceRange;
}

/**
 * A getter wrapper (() => value) for lazy evaluation.
 * Used for reactive values that need to be re-evaluated.
 */
export interface GetterValue extends SerializedValueBase {
  readonly kind: 'getter';
  readonly value: SerializedValue;
}

/**
 * A concatenation of parts: [part1, part2, ...].join('')
 * Used for attribute interpolation like class="foo {{bar}} baz".
 */
export interface ConcatValue extends SerializedValueBase {
  readonly kind: 'concat';
  readonly parts: SerializedValue[];
}

/**
 * Union of all serialized value types.
 */
export type SerializedValue =
  | LiteralValue
  | PathValue
  | SpreadValue
  | RawValue
  | HelperValue
  | GetterValue
  | ConcatValue;

// ============================================================================
// HBS Node Types (Internal Representation)
// ============================================================================

/**
 * A runtime symbol reference for dynamic tags (namespace providers, dynamic components).
 * Replaces the `$:` magic prefix with a proper type.
 */
export interface RuntimeTag {
  readonly type: 'runtime';
  readonly symbol: string;
}

/**
 * Tag can be either:
 * - A static string (HTML element names like 'div', component names like 'MyComponent')
 * - A RuntimeTag (for namespace providers like $_SVGProvider, dynamic components)
 *
 * Use `isRuntimeTag()` to check the variant and `getTagName()` to get the string representation.
 */
export type HBSTag = string | RuntimeTag;

/**
 * Attribute tuple: [key, value, sourceRange?]
 */
export type AttributeTuple = readonly [string, SerializedValue, SourceRange?, SourceRange?];

/**
 * Event tuple: [eventName, handler, sourceRange?]
 */
export type EventTuple = readonly [string, SerializedValue, SourceRange?];

/**
 * Property tuple: [propName, value, sourceRange?]
 */
export type PropertyTuple = readonly [string, SerializedValue, SourceRange?];

/**
 * Represents an element or component node.
 */
export interface HBSNode {
  /** Type discriminator for reliable type guards */
  readonly _nodeType: 'element';
  readonly tag: HBSTag;
  readonly attributes: readonly AttributeTuple[];
  readonly properties: readonly PropertyTuple[];
  readonly events: readonly EventTuple[];
  readonly children: readonly HBSChild[];
  readonly blockParams: readonly string[];
  /** Source ranges for element block params (if available) */
  readonly blockParamRanges?: ReadonlyArray<SourceRange>;
  readonly selfClosing: boolean;
  readonly hasStableChild: boolean;
  readonly sourceRange?: SourceRange;
  /** Source range of just the tag name (for component source mapping) */
  readonly tagRange?: SourceRange;
}

/**
 * Control flow expression types.
 */
export type ControlType = 'if' | 'each' | 'yield' | 'in-element';

/**
 * Represents a control flow expression (if, each, yield, etc.).
 */
export interface HBSControlExpression {
  /** Type discriminator for reliable type guards */
  readonly _nodeType: 'control';
  readonly type: ControlType;
  readonly condition: SerializedValue;
  readonly children: readonly HBSChild[];
  readonly inverse: readonly HBSChild[] | null;
  readonly blockParams: readonly string[];
  /** Source ranges for block params in the opening statement (if available) */
  readonly blockParamRanges?: ReadonlyArray<SourceRange>;
  readonly key: string | null;
  readonly isSync: boolean;
  readonly sourceRange?: SourceRange;
}

/**
 * Union of all possible children in an HBS template.
 */
export type HBSChild =
  | string                  // Text content
  | SerializedValue         // Expression
  | HBSNode                 // Element/component
  | HBSControlExpression;   // Control flow

// ============================================================================
// Compiler Error/Warning Types
// ============================================================================

/**
 * Base interface for compiler diagnostics (errors and warnings).
 * Contains location information and optional formatting fields.
 */
export interface CompilerDiagnostic {
  readonly message: string;
  readonly sourceRange?: SourceRange;
  readonly code: string;
  /** Source line(s) containing the diagnostic */
  readonly snippet?: string;
  /** Pointer string (e.g., "    ^^^^^^") */
  readonly pointer?: string;
  /** Suggestion for fixing the issue */
  readonly hint?: string;
  /** 1-indexed line number */
  readonly line?: number;
  /** 1-indexed column number */
  readonly column?: number;
  /** Immediate character context (+-5 symbols) around the error for quick preview */
  readonly lexicalContext?: string;
  /** Filename where the error occurred */
  readonly filename?: string;
}

/**
 * Compiler error with location information and optional formatting.
 * Errors are code prefixed with 'E' (e.g., E001).
 */
export interface CompilerError extends CompilerDiagnostic {}

/**
 * Compiler warning with location information and optional formatting.
 * Warnings are code prefixed with 'W' (e.g., W001).
 */
export interface CompilerWarning extends CompilerDiagnostic {}

// ============================================================================
// Compiler Result Types
// ============================================================================

/**
 * V3 Sourcemap format.
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
 * Result of compiling a template.
 */
export interface CompileResult {
  readonly code: string;
  readonly mappingTree: MappingTreeNode;
  readonly errors: readonly CompilerError[];
  readonly warnings: readonly CompilerWarning[];
  readonly bindings: ReadonlySet<string>;
  /** V3 sourcemap (only present if sourcemap option is enabled) */
  readonly sourceMap?: SourceMapV3;
}

/**
 * Options for code formatting.
 */
export interface FormatOptions {
  /** Whether to format output with indentation. Default: false */
  readonly enabled: boolean;
  /** Indentation string (e.g., '  ' for 2 spaces). Default: '  ' */
  readonly indent: string;
  /** Newline string. Default: '\n' */
  readonly newline: string;
  /**
   * Base indentation to prepend to all output lines.
   * Useful when embedding compiled templates in indented contexts.
   * Default: '' (no base indentation)
   */
  readonly baseIndent: string;
  /**
   * Emit PURE annotations for tree-shaking.
   * Default: true when enabled is false (production), false when enabled is true (dev mode)
   */
  readonly emitPure: boolean;
}

/**
 * Default formatting options (minified).
 */
export const DEFAULT_FORMAT_OPTIONS: FormatOptions = Object.freeze({
  enabled: false,
  indent: '  ',
  newline: '\n',
  baseIndent: '',
  emitPure: true,
});

/**
 * Options for sourcemap generation.
 */
export interface SourceMapOptions {
  /** Generate sourcemap. Default: false */
  readonly enabled?: boolean;
  /** Include source content in the map. Default: true */
  readonly includeContent?: boolean;
  /** Generate inline sourcemap comment. Default: false */
  readonly inline?: boolean;
  /** Source root path */
  readonly sourceRoot?: string;
}

/**
 * Options for the compile() function.
 */
export interface CompileOptions {
  readonly flags?: Partial<CompilerFlags>;
  readonly bindings?: ReadonlySet<string>;
  readonly filename?: string;
  /** Code formatting options. When enabled, output is pretty-printed. */
  readonly format?: Partial<FormatOptions> | boolean;
  /** Sourcemap generation options. */
  readonly sourceMap?: SourceMapOptions | boolean;
  /** Diagnostic formatting options. */
  readonly diagnostics?: DiagnosticsOptions;
  /**
   * In loose mode, this hook allows embedding environments to customize the name of an
   * angle-bracket component.
   */
  readonly customizeComponentName?: (input: string) => string;
  /** CALLBACK to determine if a variable is in the lexical scope of the template. */
  readonly lexicalScope?: (variable: string) => boolean;
}

// ============================================================================
// Namespace Types
// ============================================================================

/**
 * XML namespaces for elements.
 */
export type ElementNamespace = 'html' | 'svg' | 'mathml';

/**
 * Context for element processing.
 */
export interface ElementContext {
  readonly namespace: ElementNamespace;
  readonly parentNamespace: ElementNamespace;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is an HBSNode.
 * Uses the _nodeType discriminator for reliable identification.
 */
export function isHBSNode(value: unknown): value is HBSNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_nodeType' in value &&
    (value as HBSNode)._nodeType === 'element'
  );
}

/**
 * Check if a value is an HBSControlExpression.
 * Uses the _nodeType discriminator for reliable identification.
 */
export function isHBSControlExpression(value: unknown): value is HBSControlExpression {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_nodeType' in value &&
    (value as HBSControlExpression)._nodeType === 'control'
  );
}

/**
 * Check if a value is a SerializedValue.
 */
export function isSerializedValue(value: unknown): value is SerializedValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof (value as SerializedValue).kind === 'string'
  );
}

/**
 * Check if a child is a text string.
 */
export function isTextChild(child: HBSChild): child is string {
  return typeof child === 'string';
}

/**
 * Check if a tag is a RuntimeTag (runtime symbol reference).
 */
export function isRuntimeTag(tag: HBSTag): tag is RuntimeTag {
  return typeof tag === 'object' && tag !== null && tag.type === 'runtime';
}

/**
 * Get the string representation of a tag for comparison/display.
 */
export function getTagName(tag: HBSTag): string {
  return isRuntimeTag(tag) ? tag.symbol : tag;
}

// ============================================================================
// Value Constructors (Factory Functions)
// ============================================================================

/**
 * Create a literal value.
 */
export function literal(
  value: string | number | boolean | null | undefined,
  sourceRange?: SourceRange
): LiteralValue {
  return { kind: 'literal', value, sourceRange };
}

/**
 * Create a path value.
 */
export function path(
  expression: string,
  isArg = false,
  sourceRange?: SourceRange,
  parts?: readonly PathPart[],
  rootRange?: SourceRange
): PathValue {
  if (parts && parts.length > 0) {
    return {
      kind: 'path',
      expression,
      isArg,
      sourceRange,
      parts,
      rootRange,
    };
  }

  return {
    kind: 'path',
    expression,
    isArg,
    sourceRange,
  };
}

/**
 * Create a spread value.
 */
export function spread(expression: string, sourceRange?: SourceRange): SpreadValue {
  return { kind: 'spread', expression, sourceRange };
}

/**
 * Create a raw code value.
 */
export function raw(code: string, sourceRange?: SourceRange): RawValue {
  return { kind: 'raw', code, sourceRange };
}

/**
 * Create a helper call value.
 */
export function helper(
  name: string,
  positional: SerializedValue[] = [],
  named: Map<string, SerializedValue> = new Map(),
  sourceRange?: SourceRange,
  pathRange?: SourceRange
): HelperValue {
  return { kind: 'helper', name, positional, named, sourceRange, pathRange };
}

/**
 * Create a getter wrapper value (() => value).
 */
export function getter(value: SerializedValue, sourceRange?: SourceRange): GetterValue {
  return { kind: 'getter', value, sourceRange };
}

/**
 * Create a concatenation value.
 */
export function concat(parts: SerializedValue[], sourceRange?: SourceRange): ConcatValue {
  return { kind: 'concat', parts, sourceRange };
}

/**
 * Create a runtime tag (for namespace providers and dynamic components).
 * @throws Error if symbol is empty or whitespace-only
 */
export function runtimeTag(symbol: string): RuntimeTag {
  if (!symbol || !symbol.trim()) {
    throw new Error('RuntimeTag symbol cannot be empty');
  }
  return { type: 'runtime', symbol };
}
