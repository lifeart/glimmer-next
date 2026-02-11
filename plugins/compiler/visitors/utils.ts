/**
 * Visitor Utilities
 *
 * Shared utilities for visitor implementations.
 * This module contains functions that multiple visitors need to avoid circular dependencies.
 */

import type { ASTv1 } from '@glimmer/syntax';
import type { CompilerContext } from '../context';
import type { SerializedValue, SourceRange, PathPart } from '../types';
import { SYMBOLS, INTERNAL_HELPERS, getBuiltInHelperSymbol } from '../serializers/symbols';
import { B, serializeJS, type JSExpression } from '../builder';
import { isSafeKey, quoteKey } from '../utils/js-utils';

/**
 * Serialize a path expression, using bracket notation for hyphenated property names.
 * Converts "c.my-component" to "c["my-component"]"
 *
 * Note: If the path already contains optional chaining (?.), it's returned as-is
 * since toOptionalChaining has already processed it correctly.
 */
function serializePathExpression(pathStr: string): string {
  // If path already has optional chaining, return as-is
  // This prevents splitting "a?.b" by "." which would incorrectly
  // yield ["a?", "b"] instead of preserving the optional chain
  if (pathStr.includes('?.')) {
    return pathStr;
  }

  const parts = pathStr.split('.');
  if (parts.length === 0) return pathStr;

  let result = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (isSafeKey(part)) {
      result += `.${part}`;
    } else {
      result += `[${JSON.stringify(part)}]`;
    }
  }
  return result;
}

// Line offset cache for converting line/column to byte offset
let cachedSource: string | null = null;
let cachedLineOffsets: number[] = [];

/**
 * Build a line offset index for a source string.
 * Each entry in the array is the byte offset of the start of that line.
 */
function buildLineOffsets(source: string): number[] {
  const offsets: number[] = [0]; // Line 1 starts at offset 0
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

/**
 * Convert line/column to byte offset.
 * Line is 1-based, column is 0-based.
 */
function lineColumnToOffset(source: string, line: number, column: number): number {
  // Update cache if source changed
  if (cachedSource !== source) {
    cachedSource = source;
    cachedLineOffsets = buildLineOffsets(source);
  }

  // Get the start offset of the line (1-based to 0-based index)
  const lineIndex = line - 1;
  if (lineIndex < 0 || lineIndex >= cachedLineOffsets.length) {
    // Line out of bounds - return column as best guess
    return column;
  }

  const lineStart = cachedLineOffsets[lineIndex];
  return lineStart + column;
}

/**
 * Get source range from an AST node's location.
 * Converts line/column to actual byte offsets for proper source mapping.
 */
export function getNodeRange(node: ASTv1.Node): SourceRange | undefined {
  if (!node.loc) return undefined;

  // We need the cached source (set via setSourceForRanges) to accurately
  // convert line/column to byte offsets. Glimmer's loc.source is a module
  // identifier string (e.g., "an unknown module"), not the actual source content.
  if (!cachedSource) {
    return undefined;
  }

  // Calculate byte offsets from line/column using the actual template source
  const start = lineColumnToOffset(cachedSource, node.loc.start.line, node.loc.start.column);
  const end = lineColumnToOffset(cachedSource, node.loc.end.line, node.loc.end.column);

  return { start, end };
}

/**
 * Set the source string for line/column to offset conversion.
 * Call this before visiting to ensure accurate source mapping.
 */
export function setSourceForRanges(source: string): void {
  cachedSource = source;
  cachedLineOffsets = buildLineOffsets(source);
}

/**
 * Get the source range for an attribute name.
 */
export function getAttributeNameRange(attr: ASTv1.AttrNode): SourceRange | undefined {
  if (!attr.loc || !cachedSource) return undefined;

  const start = lineColumnToOffset(cachedSource, attr.loc.start.line, attr.loc.start.column);
  const end = start + attr.name.length;
  return { start, end };
}

/**
 * Build a normalized path string from PathExpression head/tail.
 * Uses head/tail instead of deprecated parts/data/this.
 */
export function getPathExpressionString(node: ASTv1.PathExpression): string {
  const head = node.head;
  let headText = '';

  if (head.type === 'ThisHead') {
    headText = 'this';
  } else if (head.type === 'AtHead') {
    const name = (head as ASTv1.AtHead).name ?? head.original;
    headText = name.startsWith('@') ? name : `@${name}`;
  } else {
    const varHead = head as ASTv1.VarHead;
    headText = varHead.name ?? head.original;
  }

  if (node.tail && node.tail.length > 0) {
    return `${headText}.${node.tail.join('.')}`;
  }

  return headText;
}

export function getPathPartRanges(node: ASTv1.PathExpression): { parts: PathPart[]; rootRange?: SourceRange } | null {
  if (!node.loc || !cachedSource) return null;

  const start = lineColumnToOffset(cachedSource, node.loc.start.line, node.loc.start.column);
  const end = lineColumnToOffset(cachedSource, node.loc.end.line, node.loc.end.column);
  const text = cachedSource.slice(start, end);

  // Skip complex paths with bracket notation or parent scope paths for now
  if (text.includes('[') || text.includes(']') || text.includes('/')) return null;

  const head = node.head;
  const isAtHead = head.type === 'AtHead';
  const headText = getPathExpressionString(node).split('.')[0] ?? '';
  const tailTokens = node.tail ?? [];
  const tokens = [headText, ...tailTokens];
  if (tokens.length === 0) return null;

  const parts: PathPart[] = tokens.map((token, index) => ({
    name: index === 0 && isAtHead ? token.replace(/^@/, '') : token,
  }));

  let searchIndex = 0;
  let rootRange: SourceRange | undefined;

  for (let i = 0; i < tokens.length && i < parts.length; i++) {
    const token = tokens[i];
    const tokenIndex = text.indexOf(token, searchIndex);
    if (tokenIndex === -1) {
      return null;
    }

    const tokenStart = start + tokenIndex;
    const tokenEnd = tokenStart + token.length;

    if (i === 0 && isAtHead && token.startsWith('@')) {
      const partStart = tokenStart + 1;
      const partName = token.slice(1);
      parts[i] = { name: partName, range: { start: partStart, end: tokenEnd } };
      rootRange = { start: tokenStart, end: tokenEnd };
    } else {
      parts[i] = { name: parts[i].name, range: { start: tokenStart, end: tokenEnd } };
      if (i === 0) {
        rootRange = { start: tokenStart, end: tokenEnd };
      }
    }

    searchIndex = tokenIndex + token.length;
  }

  return { parts, rootRange };
}

/**
 * Get source ranges for block params in a block statement (e.g., {{#each ... as |item index|}}).
 */
export function getBlockParamRanges(node: ASTv1.BlockStatement): SourceRange[] | null {
  if (!node.loc || !cachedSource) return null;

  const blockParams = node.program.blockParams;
  if (!blockParams || blockParams.length === 0) return null;

  // Prefer AST param nodes when available (VarHead[] in newer glimmer/syntax)
  if (node.program.params && node.program.params.length === blockParams.length) {
    const ranges: SourceRange[] = [];
    for (const param of node.program.params) {
      if (!param.loc) {
        ranges.length = 0;
        break;
      }
      const start = lineColumnToOffset(cachedSource, param.loc.start.line, param.loc.start.column);
      const end = lineColumnToOffset(cachedSource, param.loc.end.line, param.loc.end.column);
      ranges.push({ start, end });
    }
    if (ranges.length === blockParams.length) {
      return ranges;
    }
  }

  const start = lineColumnToOffset(cachedSource, node.loc.start.line, node.loc.start.column);
  let openEnd = -1;
  if (node.program?.loc) {
    const programStart = lineColumnToOffset(
      cachedSource,
      node.program.loc.start.line,
      node.program.loc.start.column
    );
    if (programStart > start) {
      openEnd = cachedSource.lastIndexOf('}}', programStart);
    }
  }
  if (openEnd === -1) {
    openEnd = cachedSource.indexOf('}}', start);
  }
  if (openEnd === -1) return null;

  const openText = cachedSource.slice(start, openEnd + 2);
  const matches = [...openText.matchAll(/\bas\s*\|([^|]*)\|/gm)];
  const match = matches.length > 0 ? matches[matches.length - 1] : null;
  if (!match) return null;

  const paramsText = match[1];
  const paramsTextOffset = match.index + match[0].indexOf(paramsText);
  const paramsStart = start + paramsTextOffset;

  const tokenMatches = [...paramsText.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)];
  if (tokenMatches.length === 0) return null;

  const tokenRanges = tokenMatches.map((token) => ({
    name: token[0],
    range: {
      start: paramsStart + token.index,
      end: paramsStart + token.index + token[0].length,
    },
  }));

  if (tokenRanges.length === blockParams.length) {
    const ranges: SourceRange[] = [];
    for (let i = 0; i < blockParams.length; i++) {
      if (tokenRanges[i].name !== blockParams[i]) {
        break;
      }
      ranges.push(tokenRanges[i].range);
    }
    if (ranges.length === blockParams.length) {
      return ranges;
    }
  }

  const ranges: SourceRange[] = [];
  let tokenIndex = 0;
  for (const param of blockParams) {
    let foundIndex = -1;
    for (let i = tokenIndex; i < tokenRanges.length; i++) {
      if (tokenRanges[i].name === param) {
        foundIndex = i;
        break;
      }
    }
    if (foundIndex === -1) return null;
    ranges.push(tokenRanges[foundIndex].range);
    tokenIndex = foundIndex + 1;
  }

  return ranges.length > 0 ? ranges : null;
}

/**
 * Get source ranges for element block params in a component invocation (e.g., <Comp as |item|>).
 */
export function getElementBlockParamRanges(node: ASTv1.ElementNode): SourceRange[] | null {
  if (!cachedSource) return null;
  if (!node.params || node.params.length === 0) return null;
  if (node.blockParams.length !== node.params.length) return null;

  const ranges: SourceRange[] = [];
  for (const param of node.params) {
    if (!param.loc) return null;
    const start = lineColumnToOffset(cachedSource, param.loc.start.line, param.loc.start.column);
    const end = lineColumnToOffset(cachedSource, param.loc.end.line, param.loc.end.column);
    ranges.push({ start, end });
  }

  return ranges;
}

/**
 * Convert a path to use optional chaining for safety (3+ segments).
 * e.g., foo.bar.baz -> foo?.bar?.baz
 */
export function toOptionalChaining(str: string): string {
  if (typeof str !== 'string') return str;

  // Don't modify quoted strings
  if (str.includes("'") || str.includes('"')) return str;

  // Don't modify runtime symbols
  if (str.includes('$_')) return str;

  // Already has optional chaining
  if (str.includes('?.')) return str;

  // Only apply to paths with 3+ segments
  if (str.split('.').length < 3) return str;

  // Apply optional chaining, handling spread operator
  const result = str
    .split('...')
    .map((el) => el.split('.').join('?.'))
    .join('...');

  // Fix: this?. -> this. (this is never null)
  // Use split/join pattern for ES5 compatibility (replaceAll requires ES2021)
  let fixed = result;
  if (fixed.includes('this?.')) {
    fixed = fixed.split('this?.').join('this.');
  }

  // Fix: this[$args]?. -> this[$args]. (args are always present)
  const argsOptional = `this[${SYMBOLS.ARGS_PROPERTY}]?.`;
  const argsNonOptional = `this[${SYMBOLS.ARGS_PROPERTY}].`;
  if (fixed.includes(argsOptional)) {
    fixed = fixed.split(argsOptional).join(argsNonOptional);
  }

  return fixed;
}

/**
 * Resolve a path expression, handling this/args/bindings.
 */
export function resolvePath(ctx: CompilerContext, pathStr: string): string {
  // Handle @args - uses $a.argName format (alias for this[$args])
  if (pathStr.startsWith('@')) {
    const argPath = pathStr.slice(1); // e.g., "aria-label" or "foo.bar.baz"
    const segments = argPath.split('.');
    const firstSegment = segments[0];
    // Use bracket notation for names with special characters (like hyphens)
    const needsBracket = !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(firstSegment);

    let resolved: string;
    if (needsBracket) {
      // First segment needs brackets, rest use dot notation
      resolved = `${SYMBOLS.ARGS_ALIAS}["${firstSegment}"]`;
      if (segments.length > 1) {
        resolved += '.' + segments.slice(1).join('.');
      }
    } else {
      resolved = `${SYMBOLS.ARGS_ALIAS}.${argPath}`;
    }
    return toOptionalChaining(resolved);
  }

  // Handle explicit this
  if (pathStr.startsWith('this.') || pathStr === 'this') {
    return toOptionalChaining(pathStr);
  }

  // Check if first segment is a known binding
  const firstSegment = pathStr.split('.')[0];
  const isKnown = ctx.scopeTracker.hasBinding(firstSegment);

  if (isKnown) {
    // It's a local binding, use as-is with optional chaining
    return toOptionalChaining(pathStr);
  }

  // Unknown paths are kept as-is (with optional chaining for safety)
  // This matches the behavior of the original converter which does NOT
  // add "this." prefix to unknown paths. This allows:
  // - Compile-time constants (IS_GLIMMER_COMPAT_MODE, IS_DEV_MODE)
  // - Namespaced paths that Vite's define can replace
  // - Any path that should be resolved at runtime without this. prefix
  return toOptionalChaining(pathStr);
}

/**
 * Serialize a value to its JavaScript string representation.
 * This is the string-based version used during visiting phase.
 * Note: For CodeBuilder-based serialization during serialization phase,
 * use serializeValue from serializers/value.ts instead.
 */
export function serializeValueToString(value: SerializedValue): string {
  switch (value.kind) {
    case 'literal':
      if (value.value === undefined) return 'undefined';
      if (value.value === null) return 'null';
      if (typeof value.value === 'string') return JSON.stringify(value.value);
      return String(value.value);

    case 'path':
      return serializePathExpression(value.expression);

    case 'spread':
      return value.expression;

    case 'raw':
      return value.code;

    case 'helper':
      return serializeHelperCall(value);

    case 'getter':
      return `() => ${serializeValueToString(value.value)}`;

    case 'concat':
      return `[${value.parts.map(p => serializeValueToString(p)).join(',')}].join('')`;

    default:
      // Exhaustive check - TypeScript will error if a kind is not handled
      const _exhaustive: never = value;
      throw new Error(`Unknown value kind: ${(_exhaustive as SerializedValue).kind}`);
  }
}

function buildValueToExpr(value: SerializedValue): JSExpression {
  switch (value.kind) {
    case 'literal':
      if (value.value === undefined) return B.undef(value.sourceRange);
      if (value.value === null) return B.nil(value.sourceRange);
      if (typeof value.value === 'string') return B.string(value.value, value.sourceRange);
      if (typeof value.value === 'boolean') return B.bool(value.value, value.sourceRange);
      return B.num(value.value, value.sourceRange);
    case 'path':
      return B.runtimeRef(value.expression, value.sourceRange);
    case 'spread':
      return B.spread(B.runtimeRef(value.expression, value.sourceRange), value.sourceRange);
    case 'raw':
      return B.raw(value.code, value.sourceRange);
    case 'helper':
      switch (value.name) {
        case INTERNAL_HELPERS.ELEMENT_HELPER:
          return buildElementHelperExpr(value);
        case INTERNAL_HELPERS.ON_HANDLER:
          return buildOnHandlerExpr(value);
        case INTERNAL_HELPERS.ON_CREATED_HANDLER:
          return buildOnCreatedHandlerExpr(value);
        default:
          return B.raw(serializeHelperCall(value));
      }
    case 'getter':
      return B.reactiveGetter(buildValueToExpr(value.value), value.sourceRange);
    case 'concat': {
      const exprs = value.parts.map((part) => buildValueToExpr(part));
      return B.methodCall(B.array(exprs), 'join', [B.string('')], value.sourceRange);
    }
    default:
      return B.raw('');
  }
}

function buildElementHelperExpr(value: SerializedValue & { kind: 'helper' }): JSExpression {
  const tagValue = value.positional[0];
  let tagExpr: JSExpression;

  if (!tagValue) {
    tagExpr = B.string('div');
  } else if (tagValue.kind === 'literal' || tagValue.kind === 'getter') {
    tagExpr = buildValueToExpr(tagValue);
  } else {
    tagExpr = B.reactiveGetter(buildValueToExpr(tagValue));
  }

  return B.elementHelperWrapper(tagExpr, {
    GET_ARGS: SYMBOLS.GET_ARGS,
    GET_FW: SYMBOLS.GET_FW,
    GET_SLOTS: SYMBOLS.GET_SLOTS,
    FINALIZE_COMPONENT: SYMBOLS.FINALIZE_COMPONENT,
    TAG: SYMBOLS.TAG,
    SLOT: SYMBOLS.SLOT,
    LOCAL_FW: SYMBOLS.LOCAL_FW,
    LOCAL_SLOTS: SYMBOLS.LOCAL_SLOTS,
  }, value.sourceRange);
}

function buildOnHandlerExpr(value: SerializedValue & { kind: 'helper' }): JSExpression {
  const [handlerArg, ...tailArgs] = value.positional;
  const handlerExpr = handlerArg ? buildValueToExpr(handlerArg) : B.nil();
  const tailExprs = tailArgs.map((arg) => buildValueToExpr(arg));
  const callArgs: JSExpression[] = [B.id('$e'), B.id('$n'), ...tailExprs];
  return B.arrow(['$e', '$n'], B.call(handlerExpr, callArgs), value.sourceRange);
}

function buildOnCreatedHandlerExpr(value: SerializedValue & { kind: 'helper' }): JSExpression {
  const [handlerArg, ...tailArgs] = value.positional;
  const handlerExpr = handlerArg ? buildValueToExpr(handlerArg) : B.nil();
  const tailExprs = tailArgs.map((arg) => buildValueToExpr(arg));
  const callArgs: JSExpression[] = [B.id('$n'), ...tailExprs];
  return B.arrow(['$n'], B.call(handlerExpr, callArgs), value.sourceRange);
}

// Note: Built-in helper resolution uses getBuiltInHelperSymbol from serializers/symbols.ts (the single source of truth)

/**
 * Serialize a helper call to JavaScript.
 */
function serializeHelperCall(value: SerializedValue & { kind: 'helper' }): string {
  let args: string[] = [];
  let helperName = value.name;

  if (
    helperName === INTERNAL_HELPERS.ELEMENT_HELPER ||
    helperName === INTERNAL_HELPERS.ON_HANDLER ||
    helperName === INTERNAL_HELPERS.ON_CREATED_HANDLER
  ) {
    return serializeJS(buildValueToExpr(value));
  }

  // Handle @arg-prefixed helper names (helper passed as argument)
  // e.g., (@myHelper arg) -> this[$args].myHelper(arg)
  if (helperName.startsWith('@')) {
    const argName = helperName.slice(1);
    // Use bracket notation for names with special characters (like hyphens)
    const needsBracket = !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(argName);
    helperName = needsBracket
      ? `this[${SYMBOLS.ARGS_PROPERTY}]["${argName}"]`
      : `this[${SYMBOLS.ARGS_PROPERTY}].${argName}`;
  }

  // Handle unless -> if transformation (swap args)
  if (value.name === 'unless') {
    helperName = 'if';
    // unless(cond, true, false) -> if(cond, false, true)
    if (value.positional.length >= 2) {
      args.push(serializeValueToString(value.positional[0])); // condition
      if (value.positional.length >= 3) {
        args.push(serializeValueToString(value.positional[2])); // false value (becomes true branch)
        args.push(serializeValueToString(value.positional[1])); // true value (becomes false branch)
      } else {
        args.push('""'); // empty string for false branch
        args.push(serializeValueToString(value.positional[1])); // true value becomes false branch
      }
    } else {
      // Just condition - pass through
      for (const arg of value.positional) {
        args.push(serializeValueToString(arg));
      }
    }
  } else {
    // Add positional args normally
    for (const arg of value.positional) {
      args.push(serializeValueToString(arg));
    }
  }

  // Use symbol for built-in helpers
  const symbolName = getBuiltInHelperSymbol(helperName) ?? helperName;

  // Special handling for hash helper - wrap values in getters for lazy evaluation
  // This prevents $__hash from auto-calling function values
  if (symbolName === SYMBOLS.HASH) {
    const namedPairs: string[] = [];
    for (const [key, val] of value.named) {
      // Wrap each value in a getter
      namedPairs.push(`${quoteKey(key)}: () => ${serializeValueToString(val)}`);
    }
    return `${symbolName}({ ${namedPairs.join(', ')} })`;
  }

  // Add named args as object
  if (value.named.size > 0) {
    const namedPairs: string[] = [];
    for (const [key, val] of value.named) {
      namedPairs.push(`${quoteKey(key)}: ${serializeValueToString(val)}`);
    }
    args.push(`{ ${namedPairs.join(', ')} }`);
  }

  // Special handling for has-block helpers - they need .bind(this, $slots)
  if (symbolName === SYMBOLS.HAS_BLOCK || symbolName === SYMBOLS.HAS_BLOCK_PARAMS) {
    if (args.length > 0) {
      return `${symbolName}.bind(this, $slots)(${args.join(', ')})`;
    }
    return `${symbolName}.bind(this, $slots)`;
  }

  // Special handling for debugger - prepend this and use .call
  if (symbolName === SYMBOLS.DEBUGGER) {
    return `${symbolName}.call(this${args.length > 0 ? `, ${args.join(', ')}` : ''})`;
  }

  // Special handling for component/helper/modifier helpers
  // These expect: $_componentHelper([...positional], {...named})
  // NOT: $_componentHelper(...positional, named)
  if (
    symbolName === SYMBOLS.COMPONENT_HELPER ||
    symbolName === SYMBOLS.HELPER_HELPER ||
    symbolName === SYMBOLS.MODIFIER_HELPER
  ) {
    // Build positional as array
    const positionalArgs = value.positional.map(arg => serializeValueToString(arg));
    // Build named as object
    const namedPairs: string[] = [];
    for (const [key, val] of value.named) {
      namedPairs.push(`${quoteKey(key)}: ${serializeValueToString(val)}`);
    }
    const namedObj = namedPairs.length > 0 ? `{ ${namedPairs.join(', ')} }` : '{}';
    return `${symbolName}([${positionalArgs.join(', ')}], ${namedObj})`;
  }

  return `${symbolName}(${args.join(', ')})`;
}

/**
 * Escape a string for use in JavaScript code.
 */
export function escapeString(str: string): string {
  return JSON.stringify(str);
}
