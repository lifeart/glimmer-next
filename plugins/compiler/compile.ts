/**
 * Compile Entry Point
 *
 * The main compile() function that ties together parsing, visiting, and serialization.
 * This provides a clean, dependency-injected interface for template compilation.
 */

import { preprocess, type ASTv1 } from '@glimmer/syntax';
import type { CompileOptions, CompileResult, HBSChild, SourceMapV3, SourceMapOptions } from './types';
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
          const nextSpace = contentFromStart.search(/\s/);
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
          const nextSpace = contentFromStart.search(/\s/);
          if (nextSpace !== -1 && nextSpace > 0) {
            refinedEnd = start + nextSpace;
          } else {
            const nextNewline = contentFromStart.indexOf('\n');
            refinedEnd = start + (nextNewline !== -1 ? nextNewline : contentFromStart.length);
          }
        }
      } else {
        // Identify alphanumeric "word" symbols (attributes, args, identifiers)
        const nextBoundary = contentFromStart.search(/[^a-zA-Z0-9_\-=@:]/);
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
      let tokenizerMatch = errorMsg.match(/@ line (\d+) : column (\d+)/);
      if (!tokenizerMatch) {
         tokenizerMatch = errorMsg.match(/-\s(\d+):(\d+)$/);
      }
      
      // Lexical errors
      let lexicalMatch = null;
      if (!tokenizerMatch) {
        lexicalMatch = errorMsg.match(/Lexical error on line (\d+)/);
      }

      if (tokenizerMatch || lexicalMatch) {
        const line = tokenizerMatch ? parseInt(tokenizerMatch[1], 10) : parseInt(lexicalMatch![1], 10);
        const column = tokenizerMatch ? parseInt(tokenizerMatch[2], 10) : 0; 
        
        const start = lineColumnToOffset(template, line, column);
        const end = refineErrorSpan(start, start + 1);

        const rawMessage = errorMsg.split('\n')[0];
        
        // Extract module name if available in message: (error occurred in 'module.hbs' @ line ...)
        const moduleMatch = errorMsg.match(/error occurred in '([^']+)'/);
        let filename = options.filename;

        if (moduleMatch && moduleMatch[1] && moduleMatch[1] !== 'an unknown module') {
            filename = moduleMatch[1];
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
