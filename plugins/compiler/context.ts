/**
 * CompilerContext - The central context object for compilation.
 *
 * All compiler functions receive this context as their first parameter,
 * eliminating the need for global state.
 */

import type { ASTv1 } from '@glimmer/syntax';
import type {
  CompilerFlags,
  CompilerError,
  CompilerWarning,
  SourceRange,
  ElementContext,
  CompileOptions,
  FormatOptions,
  SerializedValue,
  HBSChild,
  HBSNode,
  HBSControlExpression,
} from './types';
import { createFlags, DEFAULT_FLAGS, DEFAULT_FORMAT_OPTIONS } from './types';
import { ScopeTracker, createScopeTracker } from './tracking/scope-tracker';
import { CodeEmitter, createCodeEmitter } from './tracking/code-emitter';
import { enrichError, enrichWarning } from './errors';
import { PURE_FUNCTIONS } from './serializers/symbols';

// ============================================================================
// Visitor Registry Types
// ============================================================================

/**
 * Result of visiting a node.
 * Can be:
 * - SerializedValue: For expressions and values
 * - HBSNode: For elements and components
 * - HBSControlExpression: For control flow
 * - string: For text content
 * - null: For filtered/invalid nodes
 */
export type VisitResult = SerializedValue | HBSNode | HBSControlExpression | string | null;

/**
 * Visitor function type for visiting AST nodes.
 */
export type VisitFn = (
  ctx: CompilerContext,
  node: ASTv1.Node,
  wrap?: boolean
) => VisitResult;

/**
 * Visitor function type for visiting children.
 */
export type VisitChildrenFn = (
  ctx: CompilerContext,
  children: ASTv1.Statement[]
) => HBSChild[];

/**
 * Serialize child function type (for let blocks).
 */
export type SerializeChildFn = (
  ctx: CompilerContext,
  child: HBSChild,
  ctxName: string
) => string | null;

/**
 * Registry for visitor functions.
 * This allows visitors to call each other without circular import dependencies.
 */
export interface VisitorRegistry {
  /** Visit an AST node and return the appropriate value */
  visit: VisitFn;
  /** Visit children nodes and return HBSChild array */
  visitChildren: VisitChildrenFn;
  /** Serialize a child for let blocks (set from compile.ts) */
  serializeChild: SerializeChildFn | null;
}

/**
 * Formatter utility for generating indented code.
 */
export class Formatter {
  private indentLevel = 0;

  constructor(readonly options: FormatOptions) {}

  /** Get current indentation string */
  get indent(): string {
    if (!this.options.enabled) return '';
    return this.options.indent.repeat(this.indentLevel);
  }

  /** Get newline string (empty if formatting disabled) */
  get newline(): string {
    if (!this.options.enabled) return '';
    return this.options.newline;
  }

  /** Get space (for separating elements) */
  get space(): string {
    if (!this.options.enabled) return ' ';
    return ' ';
  }

  /** Increase indentation level */
  push(): void {
    this.indentLevel++;
  }

  /** Decrease indentation level */
  pop(): void {
    if (this.indentLevel > 0) {
      this.indentLevel--;
    }
  }

  /** Execute function with increased indentation */
  withIndent<T>(fn: () => T): T {
    this.push();
    try {
      return fn();
    } finally {
      this.pop();
    }
  }

  /** Format an array with proper indentation */
  array(items: string[], inline = false): string {
    if (items.length === 0) return '[]';

    if (!this.options.enabled || inline) {
      return `[${items.join(', ')}]`;
    }

    // Format with newlines when formatting is enabled
    this.push();
    const content = items
      .map(item => `${this.indent}${item}`)
      .join(`,${this.newline}`);
    this.pop();

    return `[${this.newline}${content}${this.newline}${this.indent}]`;
  }

  /** Format an object with proper indentation */
  object(pairs: [string, string][], inline = false): string {
    if (pairs.length === 0) return '{}';

    if (!this.options.enabled || inline) {
      const content = pairs.map(([k, v]) => `${k}: ${v}`).join(', ');
      return `{ ${content} }`;
    }

    this.push();
    const content = pairs
      .map(([k, v]) => `${this.indent}${k}: ${v}`)
      .join(`,${this.newline}`);
    this.pop();

    return `{${this.newline}${content}${this.newline}${this.indent}}`;
  }

  /** Format a function call with proper indentation */
  call(name: string, args: string[], multiline = false): string {
    // Add PURE annotation for known side-effect-free functions (enables tree-shaking)
    // Skip in dev mode when emitPure is false
    const prefix = this.options.emitPure && PURE_FUNCTIONS.has(name) ? '/*#__PURE__*/' : '';

    if (!this.options.enabled || !multiline || args.length <= 2) {
      return `${prefix}${name}(${args.join(', ')})`;
    }

    this.push();
    const content = args
      .map(arg => `${this.indent}${arg}`)
      .join(`,${this.newline}`);
    this.pop();

    return `${prefix}${name}(${this.newline}${content}${this.newline}${this.indent})`;
  }
}

/**
 * The compiler context holds all state needed during compilation.
 * It is passed explicitly to all compiler functions.
 */
export interface CompilerContext {
  /** Compiler configuration flags */
  readonly flags: CompilerFlags;

  /** Scope and binding tracker */
  readonly scopeTracker: ScopeTracker;

  /** Code emitter with source mapping */
  readonly emitter: CodeEmitter;

  /** Collected errors */
  readonly errors: CompilerError[];

  /** Collected warnings */
  readonly warnings: CompilerWarning[];

  /** Original source code */
  readonly source: string;

  /** Optional filename for error messages */
  readonly filename?: string;

  /** Current element namespace context */
  elementContext: ElementContext;

  /** Counter for generating unique context names */
  contextCounter: number;

  /** Counter for generating unique let block variable names */
  letBlockCounter: number;

  /** Set of already-processed nodes (prevents double processing) */
  readonly seenNodes: Set<ASTv1.Node>;

  /** Code formatter */
  readonly formatter: Formatter;

  /** Visitor registry for breaking circular dependencies */
  readonly visitors: VisitorRegistry;
 
  /** CALLBACK to customize component names (for traceability/normalization) */
  readonly customizeComponentName?: (input: string) => string;
  
  /** CALLBACK to determine lexical scope */
  readonly lexicalScope?: (variable: string) => boolean;
}

/**
 * Resolve format options from user input.
 */
function resolveFormatOptions(format: CompileOptions['format']): FormatOptions {
  if (format === true) {
    // Dev mode: formatting enabled, no PURE annotations
    return { ...DEFAULT_FORMAT_OPTIONS, enabled: true, emitPure: false };
  }
  if (format === false || format === undefined) {
    return DEFAULT_FORMAT_OPTIONS;
  }
  const enabled = format.enabled ?? true;
  return {
    ...DEFAULT_FORMAT_OPTIONS,
    ...format,
    enabled,
    // Default emitPure to opposite of enabled (no PURE in dev mode)
    emitPure: format.emitPure ?? !enabled,
  };
}

/**
 * Create a new compiler context.
 */
export function createContext(
  source: string,
  options: CompileOptions = {}
): CompilerContext {
  const flags = options.flags
    ? createFlags(options.flags)
    : DEFAULT_FLAGS;

  const scopeTracker = createScopeTracker(options.bindings, options.lexicalScope);
  const emitter = createCodeEmitter(source.length);
  const formatOptions = resolveFormatOptions(options.format);
  const formatter = new Formatter(formatOptions);

  return {
    flags,
    scopeTracker,
    emitter,
    errors: [],
    warnings: [],
    source,
    filename: options.filename,
    elementContext: {
      namespace: 'html',
      parentNamespace: 'html',
    },
    contextCounter: 0,
    letBlockCounter: 0,
    seenNodes: new Set(),
    formatter,
    visitors: {
      visit: () => { throw new Error('Visitor registry not initialized. Call initializeVisitors first.'); },
      visitChildren: () => { throw new Error('Visitor registry not initialized. Call initializeVisitors first.'); },
      serializeChild: null,
    },
    customizeComponentName: options.customizeComponentName,
    lexicalScope: options.lexicalScope,
  };
}

/**
 * Initialize the visitor registry with the actual visitor functions.
 *
 * This must be called after the context is created but before visiting any nodes.
 * The visitor functions enable the visitor pattern to work without circular imports
 * by providing the visit and visitChildren functions through the context.
 *
 * @param ctx - The compiler context to initialize
 * @param visit - The main visitor function that processes individual AST nodes
 * @param visitChildren - Function to visit and filter children nodes
 *
 * @example
 * ```typescript
 * const ctx = createContext(template);
 * initializeVisitors(ctx, visit, visitChildren);
 * // Now ctx.visitors.visit and ctx.visitors.visitChildren are available
 * ```
 *
 * @throws Error if visitors are already initialized (to catch double initialization)
 */
export function initializeVisitors(
  ctx: CompilerContext,
  visit: VisitFn,
  visitChildren: VisitChildrenFn
): void {
  // Cast away readonly for initialization
  (ctx.visitors as VisitorRegistry).visit = visit;
  (ctx.visitors as VisitorRegistry).visitChildren = visitChildren;
}

/**
 * Set the serialize child function for let block handling.
 *
 * Let blocks need to serialize their children differently, requiring access
 * to the full serialization function. This function provides that capability
 * through the visitor registry.
 *
 * @param ctx - The compiler context
 * @param fn - The serialize function that converts HBSChild to JavaScript code
 *
 * @example
 * ```typescript
 * const ctx = createContext(template);
 * initializeVisitors(ctx, visit, visitChildren);
 * setSerializeChildFunction(ctx, serialize);
 * // Now ctx.visitors.serializeChild is available for let blocks
 * ```
 */
export function setSerializeChildFunction(
  ctx: CompilerContext,
  fn: SerializeChildFn
): void {
  (ctx.visitors as VisitorRegistry).serializeChild = fn;
}

/**
 * Add an error to the context.
 * Errors are automatically enriched with source snippets and hints.
 */
export function addError(
  ctx: CompilerContext,
  message: string,
  code: string,
  sourceRange?: SourceRange
): void {
  const error = enrichError({ message, code, sourceRange }, ctx.source);
  ctx.errors.push(error);
}

/**
 * Add a warning to the context.
 * Warnings are automatically enriched with source snippets and hints.
 */
export function addWarning(
  ctx: CompilerContext,
  message: string,
  code: string,
  sourceRange?: SourceRange
): void {
  const warning = enrichWarning({ message, code, sourceRange }, ctx.source);
  ctx.warnings.push(warning);
}

/**
 * Generate a unique context name (ctx0, ctx1, etc.).
 */
export function nextContextName(ctx: CompilerContext): string {
  const name = `ctx${ctx.contextCounter}`;
  ctx.contextCounter++;
  return name;
}

/**
 * Reset the context counter (useful for testing).
 */
export function resetContextCounter(ctx: CompilerContext): void {
  ctx.contextCounter = 0;
}

/**
 * Execute a function with a different element namespace.
 */
export function withElementContext<T>(
  ctx: CompilerContext,
  elementContext: ElementContext,
  fn: () => T
): T {
  const previous = ctx.elementContext;
  ctx.elementContext = elementContext;
  try {
    return fn();
  } finally {
    ctx.elementContext = previous;
  }
}

/**
 * Check if a name is a known binding (component, helper, etc.).
 */
export function isKnownBinding(ctx: CompilerContext, name: string): boolean {
  return ctx.scopeTracker.hasBinding(name);
}

/**
 * Resolve a binding in the current scope.
 */
export function resolveBinding(ctx: CompilerContext, name: string) {
  return ctx.scopeTracker.resolve(name);
}

/**
 * Get all binding names visible from the current scope.
 */
export function getAllBindingNames(ctx: CompilerContext): Set<string> {
  return ctx.scopeTracker.getAllBindingNames();
}
