/**
 * Compile Entry Point
 *
 * The main compile() function that ties together parsing, visiting, and serialization.
 * This provides a clean, dependency-injected interface for template compilation.
 */

import {
  preprocess,
  traverse,
  builders,
  print,
  Walker,
  type ASTv1,
  type ASTPlugin,
  type ASTPluginBuilder,
  type ASTPluginEnvironment,
  type NodeVisitor,
} from '@glimmer/syntax';

/**
 * Find the index of the first whitespace character in a string, or -1 if none.
 * Whitespace = space (32), tab (9), LF (10), CR (13). Used by error-span
 * refinement on the parser's "tag name" / "attribute name" reports.
 *
 * @internal
 */
export function findFirstWhitespace(str: string): number {
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) return i; // space, tab, LF, CR
  }
  return -1;
}

/**
 * Find the index of the first character that is NOT a valid bare-attr-name
 * character (a-zA-Z0-9 plus `_ - = @ :`). Used by error-span refinement to
 * end the highlighted range at the first non-name char in the source line.
 *
 * @internal
 */
export function findFirstNonIdentChar(str: string): number {
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) ||
          c === 95 || c === 45 || c === 61 || c === 64 || c === 58)) return i;
  }
  return -1;
}

/** Parse "@ line N : column M" or "- N:M" from error messages. */
function parseTokenizerLocation(msg: string): { line: number; column: number } | null {
  // Try "@ line N : column M"
  let idx = msg.indexOf('@ line ');
  if (idx !== -1) {
    const afterLine = msg.substring(idx + 7);
    const lineEnd = afterLine.indexOf(' ');
    if (lineEnd !== -1) {
      const line = parseInt(afterLine.substring(0, lineEnd), 10);
      const colIdx = afterLine.indexOf(': column ');
      if (colIdx !== -1) {
        const col = parseInt(afterLine.substring(colIdx + 9), 10);
        if (!isNaN(line) && !isNaN(col)) return { line, column: col };
      }
    }
  }
  // Try "- N:M" at end
  idx = msg.lastIndexOf('- ');
  if (idx !== -1) {
    const rest = msg.substring(idx + 2);
    const colonIdx = rest.indexOf(':');
    if (colonIdx !== -1 && rest === rest.trim()) {
      const line = parseInt(rest.substring(0, colonIdx), 10);
      const col = parseInt(rest.substring(colonIdx + 1), 10);
      if (!isNaN(line) && !isNaN(col)) return { line, column: col };
    }
  }
  return null;
}

/** Parse "Lexical error on line N" from error messages. */
function parseLexicalErrorLine(msg: string): number | null {
  const marker = 'Lexical error on line ';
  const idx = msg.indexOf(marker);
  if (idx === -1) return null;
  const numStr = msg.substring(idx + marker.length);
  const line = parseInt(numStr, 10);
  return isNaN(line) ? null : line;
}

/** Extract module name from "error occurred in 'module.hbs'" pattern. */
function parseModuleName(msg: string): string | null {
  const marker = "error occurred in '";
  const idx = msg.indexOf(marker);
  if (idx === -1) return null;
  const afterMarker = msg.substring(idx + marker.length);
  const endQuote = afterMarker.indexOf("'");
  if (endQuote === -1) return null;
  return afterMarker.substring(0, endQuote);
}
import type { AstTransform, CompileOptions, CompileResult, HBSChild, SourceMapV3, SourceMapOptions } from './types';
import { createContext, initializeVisitors, setSerializeChildFunction, type CompilerContext } from './context';
import { visit, visitChildren, setSourceForRanges } from './visitors';
import { serialize, build, B, serializeJS } from './serializers';
import { generateSourceMap, appendInlineSourceMap } from './sourcemap';
import { enrichError, lineColumnToOffset, determineErrorCode, type ParseError } from './errors';

/**
 * Compile a Glimmer template to JavaScript.
 *
 * @param template - The template source string
 * @param options - Compilation options
 * @returns The compilation result with code, mappings, errors, and warnings
 *
 * @example
 * ```typescript
 * const result = compile('<div>{{this.name}}</div>', {
 *   bindings: new Set(['MyComponent']),
 *   flags: { IS_GLIMMER_COMPAT_MODE: true },
 * });
 *
 * console.log(result.code);  // Generated JavaScript
 * console.log(result.errors); // Any compilation errors
 * ```
 */
export function compile(
  template: string,
  options: CompileOptions = {}
): CompileResult {
  // Create compilation context (counters are automatically fresh per context)
  const ctx = createContext(template, options);

  // Initialize the visitor registry
  initializeVisitors(ctx, visit, visitChildren);

  // Set the serialize child function for let blocks
  setSerializeChildFunction(ctx, serialize);

  try {
    // Parse the template
    const ast = preprocess(template, {
      mode: 'codemod',
      meta: {
        moduleName: options.filename,
      },
      parseOptions: {
        srcName: options.filename,
      },
      customizeComponentName: options.customizeComponentName,
      lexicalScope: options.lexicalScope,
    } as any);

    // Set source for accurate line/column to offset conversion
    setSourceForRanges(template);

    // Public AST-transform hook: run any caller-supplied `@glimmer/syntax`
    // visitors/plugins on the parsed AST before lowering/codegen. When no
    // transforms are passed this is a no-op (the `for` loop never runs), so
    // behavior is byte-identical to today.
    applyTransforms(ast, options.transforms, options.filename);

    // Visit and convert the AST
    const children = visitAndFilter(ctx, ast.body);

    // Serialize to JavaScript
    const code = serializeTemplate(ctx, children);

    // Generate sourcemap if requested
    const mappingTree = ctx.emitter.getMappingTree();
    let sourceMap: SourceMapV3 | undefined;
    let finalCode = code;

    const sourceMapOpts = resolveSourceMapOptions(options.sourceMap);
    if (sourceMapOpts.enabled) {
      sourceMap = generateSourceMap(mappingTree, template, code, {
        file: options.filename,
        sourceRoot: sourceMapOpts.sourceRoot,
        includeContent: sourceMapOpts.includeContent,
        sourceContent: template,
      });

      // Append inline sourcemap if requested
      if (sourceMapOpts.inline) {
        finalCode = appendInlineSourceMap(code, mappingTree, template, {
          file: options.filename,
          sourceRoot: sourceMapOpts.sourceRoot,
        });
      }
    }

    // Build the result
    return {
      code: finalCode,
      mappingTree,
      errors: ctx.errors,
      warnings: ctx.warnings,
      bindings: ctx.scopeTracker.getAllBindingNames(),
      sourceMap,
    };
  } catch (error: unknown) {
    const parseError = error as ParseError;
    let enrichedError: import('./types').CompilerError;


    // Helper to refine the error span using heuristics
    const refineErrorSpan = (start: number, end: number): number => {
      // If we already have a reasonably large span, keep it. 
      // Threshold 2 allows us to refine 2-char tokens like '{{' or '</' which are often incomplete.
      if (end - start > 2) return end;

      const contentFromStart = template.slice(start);
      let refinedEnd = end;

      if (contentFromStart.startsWith('</') || contentFromStart.startsWith('<')) {
        const closeIndex = contentFromStart.indexOf('>');
        if (closeIndex !== -1) {
          refinedEnd = start + closeIndex + 1;
        } else {
          const nextSpace = findFirstWhitespace(contentFromStart);
          if (nextSpace !== -1 && nextSpace > 0) {
            refinedEnd = start + nextSpace;
          } else {
            const nextNewline = contentFromStart.indexOf('\n');
            refinedEnd = start + (nextNewline !== -1 ? nextNewline : contentFromStart.length);
          }
        }
      } else if (contentFromStart.startsWith('{{')) {
        const closeIndex = contentFromStart.indexOf('}}');
        if (closeIndex !== -1) {
          refinedEnd = start + closeIndex + 2;
        } else {
          const nextSpace = findFirstWhitespace(contentFromStart);
          if (nextSpace !== -1 && nextSpace > 0) {
            refinedEnd = start + nextSpace;
          } else {
            const nextNewline = contentFromStart.indexOf('\n');
            refinedEnd = start + (nextNewline !== -1 ? nextNewline : contentFromStart.length);
          }
        }
      } else {
        // Identify alphanumeric "word" symbols (attributes, args, identifiers)
        const nextBoundary = findFirstNonIdentChar(contentFromStart);
        if (nextBoundary !== -1 && nextBoundary > 0) {
          refinedEnd = start + nextBoundary;
        }
      }

      // Clamp to line end
      const nextNewline = template.indexOf('\n', start);
      if (nextNewline !== -1 && refinedEnd > nextNewline) {
        refinedEnd = nextNewline;
      }

      return refinedEnd;
    };

    // Handle Parser Error
    if (parseError.hash?.loc) {
      const { first_line, first_column, last_line, last_column } = parseError.hash.loc;
      
      let start = lineColumnToOffset(template, first_line, first_column);
      let end = lineColumnToOffset(template, last_line, last_column);

      if (last_line > first_line) {
        start = end;
        end = start + 1; 
      }

      // Refine span if it's too small
      end = refineErrorSpan(start, end);

      let message = parseError.message.split('\n')[0];
      if (parseError.hash.token) {
        message += ` Got '${parseError.hash.token}'.`;
      }
      if (parseError.hash.expected && parseError.hash.expected.length > 0) {
        message += ` Expected: ${parseError.hash.expected.join(', ')}`;
      }

      enrichedError = enrichError({
        message,
        code: determineErrorCode(parseError),
        sourceRange: { start, end },
      }, template, { ...options.diagnostics, filename: options.filename });
    } else {
      // Try to parse Glimmer tokenizer style errors which contain location in message
      const errorMsg = error instanceof Error ? error.message : '';
      const tokenizerLoc = parseTokenizerLocation(errorMsg);
      const lexicalLine = tokenizerLoc ? null : parseLexicalErrorLine(errorMsg);

      if (tokenizerLoc || lexicalLine !== null) {
        const line = tokenizerLoc ? tokenizerLoc.line : lexicalLine!;
        const column = tokenizerLoc ? tokenizerLoc.column : 0;

        const start = lineColumnToOffset(template, line, column);
        const end = refineErrorSpan(start, start + 1);

        const rawMessage = errorMsg.split('\n')[0];

        // Extract module name if available in message: (error occurred in 'module.hbs' @ line ...)
        const moduleName = parseModuleName(errorMsg);
        let filename = options.filename;

        if (moduleName && moduleName !== 'an unknown module') {
            filename = moduleName;
        }

        enrichedError = enrichError({
          message: rawMessage,
          code: determineErrorCode(rawMessage),
          sourceRange: { start, end },
        }, template, { ...options.diagnostics, filename });
      } else {
        // Generic error
        const message = error instanceof Error ? error.message : 'Unknown compilation error';
        enrichedError = enrichError({
          message,
          code: 'E001',
        }, template, { ...options.diagnostics, filename: options.filename });
      }
    }

    ctx.errors.push(enrichedError);

    return {
      code: '[]',
      mappingTree: ctx.emitter.getMappingTree(),
      errors: ctx.errors,
      warnings: ctx.warnings,
      bindings: ctx.scopeTracker.getAllBindingNames(),
    };
  }
}

/**
 * Apply caller-supplied AST transforms to the parsed template AST.
 *
 * Accepts the standard `@glimmer/syntax` AST-plugin shapes (the same ones
 * classic Ember AST plugins use):
 *   - a bare `NodeVisitor` object, or
 *   - an `ASTPluginBuilder` factory `(env) => ({ name, visitor })`.
 *
 * Each transform is applied in order via `@glimmer/syntax`'s `traverse`, which
 * mutates the AST in place. When `transforms` is `undefined`/empty the loop
 * never runs, so this is a true no-op (the critical behavior-neutral invariant).
 *
 * @internal
 */
function applyTransforms(
  ast: ASTv1.Template,
  transforms: readonly AstTransform[] | undefined,
  filename: string | undefined
): void {
  if (!transforms || transforms.length === 0) {
    return;
  }

  // A `Syntax` environment mirroring `@glimmer/syntax`'s public surface, so
  // builder-style plugins can use `env.syntax.builders` etc. just like they
  // would inside Ember's classic `plugins.ast` pipeline.
  const syntax = {
    parse: preprocess,
    builders,
    print,
    traverse,
    Walker,
  };

  for (const transform of transforms) {
    let visitor: NodeVisitor;

    if (typeof transform === 'function') {
      // ASTPluginBuilder: (env) => { name, visitor }
      const env: ASTPluginEnvironment = {
        meta: { moduleName: filename } as object,
        syntax: syntax as ASTPluginEnvironment['syntax'],
      };
      const plugin: ASTPlugin = (transform as ASTPluginBuilder)(env);
      visitor = plugin.visitor;
    } else {
      // Bare NodeVisitor object
      visitor = transform as NodeVisitor;
    }

    traverse(ast, visitor);
  }
}

/**
 * Visit AST body and filter to HBSChild array.
 */
function visitAndFilter(
  ctx: CompilerContext,
  body: ASTv1.Statement[]
): HBSChild[] {
  return visitChildren(ctx, body);
}

/**
 * Serialize the template children to JavaScript code.
 * Uses streaming serialization with emitter for per-token source mapping.
 */
function serializeTemplate(
  ctx: CompilerContext,
  children: HBSChild[]
): string {
  const fmt = ctx.formatter;

  if (children.length === 0) {
    // Emit empty array through emitter for tracking
    ctx.emitter.emit('[]');
    return ctx.emitter.getCode();
  }

  // Use emitter for source-mapped output
  ctx.emitter.pushScope({ start: 0, end: ctx.source.length }, 'Template');

  // Build JSExpression tree from all children
  const childExprs = children
    .map((child) => build(ctx, child, 'this'))
    .filter((expr): expr is NonNullable<typeof expr> => expr !== null);

  // Create array expression with all children (use formattedArray for formatted output)
  const arrayExpr = fmt.options.enabled
    ? B.formattedArray(childExprs, true)
    : B.array(childExprs);

  // Single-pass streaming serialization with emitter for per-token source mapping
  serializeJS(arrayExpr, {
    emitter: ctx.emitter,
    streaming: true,
    format: fmt.options.enabled,
    indent: fmt.options.indent,
    baseIndent: fmt.options.baseIndent,
    emitPure: fmt.options.emitPure,
  });

  ctx.emitter.popScope();

  return ctx.emitter.getCode();
}


/**
 * Compile a template and return just the code string.
 * Convenience function for simple use cases.
 *
 * @param template - The template source string
 * @param options - Compilation options
 * @returns The generated JavaScript code
 */
export function compileToCode(
  template: string,
  options: CompileOptions = {}
): string {
  return compile(template, options).code;
}

/**
 * Check if a template compiles without errors.
 *
 * @param template - The template source string
 * @param options - Compilation options
 * @returns True if compilation succeeded without errors
 */
export function isValidTemplate(
  template: string,
  options: CompileOptions = {}
): boolean {
  const result = compile(template, options);
  return result.errors.length === 0;
}

/**
 * Get compilation errors for a template.
 *
 * @param template - The template source string
 * @param options - Compilation options
 * @returns Array of compilation errors
 */
export function getTemplateErrors(
  template: string,
  options: CompileOptions = {}
): readonly import('./types').CompilerError[] {
  return compile(template, options).errors;
}

/**
 * Resolve sourcemap options from user input.
 */
function resolveSourceMapOptions(opts: CompileOptions['sourceMap']): Required<SourceMapOptions> {
  if (opts === true) {
    return {
      enabled: true,
      includeContent: true,
      inline: false,
      sourceRoot: '',
    };
  }

  if (!opts) {
    return {
      enabled: false,
      includeContent: true,
      inline: false,
      sourceRoot: '',
    };
  }

  return {
    enabled: opts.enabled ?? true,
    includeContent: opts.includeContent ?? true,
    inline: opts.inline ?? false,
    sourceRoot: opts.sourceRoot ?? '',
  };
}

