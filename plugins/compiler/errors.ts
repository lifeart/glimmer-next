/**
 * Error Formatting Utilities
 *
 * Provides enhanced error messages with source snippets, pointers, and hints.
 * Transforms basic errors into developer-friendly diagnostic messages.
 */

import type { SourceRange, CompilerError, CompilerWarning, DiagnosticsOptions } from './types';

/**
 * Hints for common error codes.
 * Maps error/warning codes to helpful suggestions.
 */
export const ERROR_HINTS: Readonly<Record<string, string>> = {
  // Warnings
  'W001': 'Check for typos in the binding name or ensure the component/helper is imported.',
  'W002': 'Avoid using browser globals (window, document, console) as binding names.',
  'W003': 'Use @identity or a property name for each block keys.',
  'W004': 'Consider using a more descriptive binding name.',
  'W005': 'Positional parameters are not supported on component block invocations. Use named arguments (@name=value) instead.',

  // Errors
  'E001': 'Check template syntax for unclosed tags or invalid expressions.',
  'E002': 'Ensure the component or helper is properly imported.',
  'E003': 'Check for mismatched opening and closing tags.',
  'E004': 'Verify the expression syntax is valid.',
  'E005': 'Syntax error in template.',
  'E006': 'Unclosed element tag. Ensure all tags are properly closed with > or />.',
  'E007': 'Mismatched closing tag. The closing tag does not match the last opened tag.',
  'E008': 'Unexpected content inside element or expression.',
  'E009': 'Invalid attribute syntax. Check for unquoted values or missing equals signs.',
  'E010': 'Invalid mustache expression. Check for balanced braces.',
  'E011': 'Unclosed block statement. Ensure {{#block}} is closed with {{/block}}.',
  'E012': 'Mismatched block closing. The closing {{/block}} does not match the opening {{#block}}.',
  'E013': 'Glimmer/Handlebars parsing error.',
  'E014': 'Lexical error. Unrecognized text or character.',
  'E015': 'Invalid block parameters syntax. Check for proper pipe definitions like `as |item|`.',
  'E016': 'Invalid end tag. Closing tags must not have attributes.',
};

/**
 * Result of extracting a snippet from source.
 */
export interface SnippetResult {
  /** The source lines (formatted with line numbers) */
  lines: string[];
  /** The starting line number (1-indexed) */
  startLine: number;
  /** The column where the error starts (1-indexed) */
  column: number;
  /** Index of the error line in the 'lines' array */
  errorLineIndex: number;
}

/**
 * Convert a source offset to line and column numbers.
 * Both line and column are 1-indexed for human-readable output.
 *
 * Note: This differs from sourcemap/index.ts's offsetToLineColumn which returns
 * 0-indexed values for source map generation. This version returns 1-indexed
 * values for human-readable error messages.
 */
export function offsetToLineColumn(
  source: string,
  offset: number
): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let column = 1;

  for (let i = 0; i < safeOffset; i++) {
    if (source[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }

  return { line, column };
}

/**
 * Convert a line and column number to a source offset.
 * Line is 1-indexed, Column is 0-indexed (as per Glimmer/Handlebars parser).
 */
export function lineColumnToOffset(
  source: string,
  line: number,
  column: number
): number {
  let currentLine = 1;
  let offset = 0;

  // Fast forward to the correct line
  while (currentLine < line && offset < source.length) {
    const char = source[offset];
    if (char === '\n') {
      currentLine++;
    }
    offset++;
  }

  // Add column offset
  return Math.min(offset + column, source.length);
}

/**
 * Extract source lines around an error location.
 * supports an optional secondary line reference (e.g. for mismatched tags).
 */
export function extractSnippet(
  source: string,
  sourceRange: SourceRange,
  contextLines = 0,
  secondaryLine?: number
): SnippetResult {
  const lines = source.split('\n');
  const startPos = offsetToLineColumn(source, sourceRange.start);
  const endPos = offsetToLineColumn(source, sourceRange.end);

  // Calculate primary line range
  const firstLine = Math.max(1, startPos.line - contextLines);
  const lastLine = Math.min(lines.length, endPos.line + contextLines);

  const result: string[] = [];
  let errorLineIndex = -1;

  // 1. Process Secondary Line (if any and not in primary range)
  if (secondaryLine && secondaryLine > 0 && secondaryLine < firstLine) {
    const maxLineNumWidth = String(lastLine).length;
    const lineNum = String(secondaryLine).padStart(maxLineNumWidth, ' ');
    const lineContent = lines[secondaryLine - 1] ?? '';
    result.push(`${lineNum} | ${lineContent}`);
    result.push(' '.repeat(maxLineNumWidth) + ' : ...');
  }

  // 2. Process Primary Range
  const maxLineNumWidth = String(lastLine).length;
  for (let i = firstLine; i <= lastLine; i++) {
    if (i === startPos.line) {
        errorLineIndex = result.length;
    }
    const lineNum = String(i).padStart(maxLineNumWidth, ' ');
    const lineContent = lines[i - 1] ?? '';
    result.push(`${lineNum} | ${lineContent}`);
  }

  // 3. Process Secondary Line (if any and after primary range)
  if (secondaryLine && secondaryLine > lastLine) {
    result.push(' '.repeat(maxLineNumWidth) + ' : ...');
    const lineNum = String(secondaryLine).padStart(maxLineNumWidth, ' ');
    const lineContent = lines[secondaryLine - 1] ?? '';
    result.push(`${lineNum} | ${lineContent}`);
  }

  return {
    lines: result,
    startLine: firstLine,
    column: startPos.column,
    errorLineIndex
  };
}


/**
 * Generate a pointer string that underlines the error location.
 * Example: "    ^^^^^^"
 *
 * Note: For multi-line errors, this only generates a pointer for the first line.
 * The pointer length is based on the total error span, which may extend beyond
 * the first line. Consider this a limitation for display purposes.
 */
export function generatePointer(
  column: number,
  length: number,
  lineNumWidth: number
): string {
  // Account for line number prefix: "  5 | "
  const prefixWidth = lineNumWidth + 3; // digits + " | "
  const padding = ' '.repeat(prefixWidth + column - 1);
  const pointer = '^'.repeat(Math.max(1, length));
  return padding + pointer;
}

/**
 * Get the hint for an error code.
 */
export function getErrorHint(code: string): string | undefined {
  return ERROR_HINTS[code];
}

/**
 * Enrich an error with source snippet and formatting information.
 */
export function enrichError(
  error: { message: string; code: string; sourceRange?: SourceRange },
  source: string,
  options?: DiagnosticsOptions
): CompilerError {
  if (!error.sourceRange) {
    return {
      message: error.message,
      code: error.code,
      hint: getErrorHint(error.code),
    };
  }

  const { start, end } = error.sourceRange;
  const baseOffset = options?.baseOffset ?? 0;
  
  // Shift range if baseOffset provided
  const shiftedRange = baseOffset !== 0 
    ? { start: start + baseOffset, end: end + baseOffset }
    : error.sourceRange;

  const pos = offsetToLineColumn(source, start);
  const length = end - start;

  // Extract the relevant source line(s) with configured context lines
  const contextLines = options?.contextLines ?? 2;

  // Heuristic: Check if error message contains a reference to another line (e.g. mismatched opening tag)
  const lineRefMatch = error.message.match(/\(on line (\d+)\)/);
  const secondaryLine = lineRefMatch ? parseInt(lineRefMatch[1], 10) : undefined;

  const snippet = extractSnippet(source, error.sourceRange, contextLines, secondaryLine);
  
  // Calculate max line number width based on all lines in snippet
  // snippet.lines contains formatted strings like " 13 | content"
  const lastLineInSnippet = snippet.lines[snippet.lines.length - 1];
  const lastLineNumMatch = lastLineInSnippet.match(/^\s*(\d+)\s*\|/);
  const maxLineNumWidth = lastLineNumMatch ? lastLineNumMatch[1].length : 0;

  // Generate pointer
  // Use errorLineIndex from snippet result to find where the pointer belongs
  const pointer = snippet.errorLineIndex !== -1
    ? generatePointer(pos.column, length, maxLineNumWidth)
    : undefined;

  // Embed pointer into snippet
  const snippetLines = [...snippet.lines];
  if (pointer && snippet.errorLineIndex !== -1) {
    snippetLines.splice(snippet.errorLineIndex + 1, 0, pointer);
  }

  return {
    message: error.message,
    code: error.code,
    sourceRange: shiftedRange,
    snippet: snippetLines.join('\n'), // Pointer is now inside
    pointer, // Keeping it for programmatic access if needed, but display logic should prefer snippet
    hint: getErrorHint(error.code),
    line: pos.line,
    column: pos.column,
    lexicalContext: extractLexicalContext(source, error.sourceRange),
    filename: options?.filename,
  };
}

/**
 * Extract a short preview of the error with 5 symbols of context before and after.
 */
function extractLexicalContext(source: string, range: SourceRange): string {
  const contextLen = 5;
  const start = Math.max(0, range.start - contextLen);
  const end = Math.min(source.length, range.end + contextLen);
  
  const before = source.slice(start, range.start).replace(/\n/g, ' ');
  const error = source.slice(range.start, range.end).replace(/\n/g, ' ');
  const after = source.slice(range.end, end).replace(/\n/g, ' ');

  let result = '';
  if (start > 0) result += '...';
  result += `${before}[${error}]${after}`;
  if (end < source.length) result += '...';

  return result;
}

/**
 * Enrich a warning with source snippet and formatting information.
 */
export function enrichWarning(
  warning: { message: string; code: string; sourceRange?: SourceRange },
  source: string,
  options?: DiagnosticsOptions
): CompilerWarning {
  // Same implementation as enrichError - warnings have the same structure
  return enrichError(warning, source, options);
}

/**
 * Format a diagnostic (error or warning) for display.
 * Internal helper to avoid code duplication.
 */
function formatDiagnosticForDisplay(
  diagnostic: CompilerError | CompilerWarning,
  severity: 'Error' | 'Warning'
): string {
  const parts: string[] = [];
  const sevLower = severity.toLowerCase();
  
  // 1. Header: error: Title. (Exxx)
  let title = diagnostic.message;
  // Strip redundant Glimmer footer from title if present
  if (title.includes(' (error occurred in')) {
    title = title.split(' (error occurred in')[0];
  }

  if (diagnostic.hint) {
    const hintParts = diagnostic.hint.split('. ');
    title = hintParts[0];
    if (!title.endsWith('.')) title += '.';
  }
  parts.push(`${sevLower}: ${title} (${diagnostic.code})`);

  // 2. Location: --> filename:line:col
  if (diagnostic.line !== undefined && diagnostic.column !== undefined) {
    const filePart = diagnostic.filename ? `${diagnostic.filename}:` : '';
    parts.push(`  --> ${filePart}${diagnostic.line}:${diagnostic.column}`);
  }

  // 3. Source Snippet
  if (diagnostic.snippet) {
    parts.push('   |');
    parts.push(diagnostic.snippet);
    parts.push('   |');
  }

  // 4. Reasons & Advice
  if (diagnostic.hint) {
    const hintParts = diagnostic.hint.split('. ');
    if (hintParts.length > 1) {
      parts.push(`  help: ${hintParts.slice(1).join('. ')}`);
    }
  }

  // Technical Note if it differs from Title
  let rawMsg = diagnostic.message;
  if (rawMsg.includes(' (error occurred in')) {
    rawMsg = rawMsg.split(' (error occurred in')[0];
  }

  if (rawMsg && diagnostic.hint && !rawMsg.includes(diagnostic.hint.split('. ')[0])) {
      parts.push(`  note: ${rawMsg}`);
  } else if (!diagnostic.hint && rawMsg) {
      parts.push(`  note: ${rawMsg}`);
  }

  return parts.join('\n');
}

/**
 * Format an error for display (e.g., in console output).
 */
export function formatErrorForDisplay(error: CompilerError): string {
  return formatDiagnosticForDisplay(error, 'Error');
}

/**
 * Format a warning for display (e.g., in console output).
 */
export function formatWarningForDisplay(warning: CompilerWarning): string {
  return formatDiagnosticForDisplay(warning, 'Warning');
}
/**
 * Interface for Handlebars Parse Error (from @glimmer/syntax)
 */
export interface ParseError extends Error {
  hash?: {
    loc?: {
      first_line: number;
      first_column: number;
      last_line: number;
      last_column: number;
    };
    expected?: string[];
    token?: string;
  };
}



/**
 * Determine the specific error code based on the error message and context.
 */
export function determineErrorCode(error: ParseError | Error | string): string {
  const msg = typeof error === 'string' ? error : error.message;

  // Unclosed Element
  if (msg.includes('Unclosed element')) return 'E006';
  
  // Mismatched Element (Tokenizer)
  if (msg.includes('did not match last open tag')) return 'E007';
  
  // Specific End Tag Error (Attributes on closing tag)
  if (msg.includes('Invalid end tag') || msg.includes('closing tag must not have attributes')) {
    return 'E016';
  }

  // General Invalid Attribute / Tokenizer Char Errors
  if (msg.includes('valid character within attribute names')) {
    return 'E009';
  }
  
  // Lexical Error
  if (msg.includes('Lexical error')) return 'E014';

  // Block Mismatch (Tokenizer)
  if (msg.includes("doesn't match")) return 'E012';

  // Unexpected content / Unclosed tag
  if (msg.includes('Unexpected content') || msg.includes('Expecting \'OPEN_TAG_End\'')) return 'E008';
  
  // Invalid attribute
  if (msg.includes('Invalid attribute') || msg.includes('unquoted attribute value')) return 'E009';
  
  // Invalid Mustache
  if (msg.includes('Invalid mustache') || msg.includes('Got \'INVALID\'') || (error as ParseError).hash?.token === 'INVALID') return 'E010';
  
  // Parse Errors
  if (msg.includes('Parse error')) {
    // Check structured data if available
    const expected = (error as ParseError).hash?.expected;
    
    // Block Params Error
    if ((msg.includes("Expected:") && msg.includes("'CLOSE_BLOCK_PARAMS'")) || 
        expected?.includes("'CLOSE_BLOCK_PARAMS'")) {
      return 'E015';
    }

    // If we expected an end block but got something else, it's unclosed block
    if ((expected && expected.includes("'OPEN_ENDBLOCK'")) || (msg.includes('Expected:') && msg.includes('OPEN_ENDBLOCK'))) {
      return 'E011';
    }
    
    // If we got an end block but expected something else, it's mismatched/unexpected closing
    if (msg.toLowerCase().includes("got 'open_endblock'")) return 'E012';
    
    return 'E013';
  }
  
  return 'E005';
}
