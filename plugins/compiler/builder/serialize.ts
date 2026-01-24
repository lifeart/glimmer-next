/**
 * Code Serializer
 *
 * Converts JS AST-like nodes to JavaScript code strings.
 * Handles proper escaping and formatting.
 */

import type { CodeEmitter } from '../tracking/code-emitter';
import type { SourceRange, MappingSource } from '../types';
import { PURE_FUNCTIONS } from '../serializers/symbols';
import { isSafeKey } from '../utils/js-utils';
import type {
  JSExpression,
  JSStatement,
  JSLiteral,
  JSIdentifier,
  JSMemberExpression,
  JSCallExpression,
  JSMethodCall,
  JSArrowFunction,
  JSFunction,
  JSArrayExpression,
  JSObjectExpression,
  JSProperty,
  JSSpreadElement,
  JSBinaryExpression,
  JSConditionalExpression,
  JSRaw,
  JSRuntimeRef,
  JSReactiveGetter,
  JSMethodBinding,
  JSIife,
  JSFormattedArray,
  JSVariableDeclaration,
  JSReturnStatement,
  JSExpressionStatement,
  JSAny,
  JSParam,
} from './types';

/**
 * Serialization options.
 */
export interface SerializeOptions {
  /** Emit through CodeEmitter for source mapping */
  emitter?: CodeEmitter;
  /** Indent string (default: '  ') */
  indent?: string;
  /** Current indentation level (default: 0) */
  indentLevel?: number;
  /** Use formatting (newlines, indentation) */
  format?: boolean;
  /**
   * Enable streaming mode for per-token source mapping.
   * When true, each node with sourceRange emits its code via emitMapped.
   * When false (default), code is built as strings and emitted at the end.
   */
  streaming?: boolean;
  /**
   * Emit PURE annotations for tree-shaking.
   * Default: true in production, false when format is enabled.
   */
  emitPure?: boolean;
  /**
   * Base indentation to prepend to all output lines.
   * Useful when embedding compiled templates in indented contexts.
   * Default: '' (no base indentation)
   */
  baseIndent?: string;
}

/**
 * Serialize a JS node to code string.
 * In streaming mode, emits per-token sourcemaps through the emitter.
 */
export function serializeJS(
  node: JSAny,
  options: SerializeOptions = {}
): string {
  const streaming = options.streaming ?? (options.emitter !== undefined);
  const format = options.format ?? false;

  const ctx: SerializeContext = {
    emitter: options.emitter,
    indent: options.indent ?? '  ',
    indentLevel: options.indentLevel ?? 0,
    format,
    streaming,
    // In formatted/dev mode, skip PURE annotations by default
    emitPure: options.emitPure ?? !format,
    baseIndent: options.baseIndent ?? '',
  };

  if (streaming && ctx.emitter) {
    // Streaming mode: emit per-token mappings directly
    // Note: baseIndent is NOT emitted at the start - the first line is positioned
    // by the caller (e.g., template literal). baseIndent is only applied after
    // newlines via getNewlineWithBase().
    serializeNodeStreaming(node, ctx);
    return ctx.emitter.getCode();
  }

  // Non-streaming mode: build code string, then emit at once
  const code = serializeNode(node, ctx);

  if (ctx.emitter) {
    ctx.emitter.emit(code);
  }

  return code;
}

/**
 * Internal serialization context.
 */
interface SerializeContext {
  emitter?: CodeEmitter;
  indent: string;
  indentLevel: number;
  format: boolean;
  streaming: boolean;
  emitPure: boolean;
  baseIndent: string;
}

/**
 * Serialize any node.
 */
function serializeNode(node: JSAny, ctx: SerializeContext): string {
  switch (node.type) {
    case 'literal':
      return serializeLiteral(node, ctx);
    case 'identifier':
      return serializeIdentifier(node, ctx);
    case 'member':
      return serializeMember(node, ctx);
    case 'call':
      return serializeCall(node, ctx);
    case 'methodCall':
      return serializeMethodCall(node, ctx);
    case 'arrow':
      return serializeArrow(node, ctx);
    case 'function':
      return serializeFunction(node, ctx);
    case 'array':
      return serializeArray(node, ctx);
    case 'object':
      return serializeObject(node, ctx);
    case 'spread':
      return serializeSpread(node, ctx);
    case 'binary':
      return serializeBinary(node, ctx);
    case 'conditional':
      return serializeConditional(node, ctx);
    case 'raw':
      return serializeRaw(node, ctx);
    case 'runtimeRef':
      return serializeRuntimeRef(node, ctx);
    case 'reactiveGetter':
      return serializeReactiveGetter(node, ctx);
    case 'methodBinding':
      return serializeMethodBinding(node, ctx);
    case 'iife':
      return serializeIife(node, ctx);
    case 'formattedArray':
      return serializeFormattedArray(node, ctx);
    case 'varDecl':
      return serializeVarDecl(node, ctx);
    case 'return':
      return serializeReturn(node, ctx);
    case 'exprStmt':
      return serializeExprStmt(node, ctx);
    default:
      throw new Error(`Unknown node type: ${(node as JSAny).type}`);
  }
}

// ============================================================================
// Streaming Serialization (Per-Token Source Mapping)
// ============================================================================

/**
 * Serialize a node in streaming mode, emitting per-token mappings.
 */
function serializeNodeStreaming(node: JSAny, ctx: SerializeContext): void {
  switch (node.type) {
    case 'literal':
      serializeLiteralStreaming(node, ctx);
      break;
    case 'identifier':
      serializeIdentifierStreaming(node, ctx);
      break;
    case 'member':
      serializeMemberStreaming(node, ctx);
      break;
    case 'call':
      serializeCallStreaming(node, ctx);
      break;
    case 'methodCall':
      serializeMethodCallStreaming(node, ctx);
      break;
    case 'arrow':
      serializeArrowStreaming(node, ctx);
      break;
    case 'function':
      serializeFunctionStreaming(node, ctx);
      break;
    case 'array':
      serializeArrayStreaming(node, ctx);
      break;
    case 'object':
      serializeObjectStreaming(node, ctx);
      break;
    case 'spread':
      serializeSpreadStreaming(node, ctx);
      break;
    case 'binary':
      serializeBinaryStreaming(node, ctx);
      break;
    case 'conditional':
      serializeConditionalStreaming(node, ctx);
      break;
    case 'raw':
      serializeRawStreaming(node, ctx);
      break;
    case 'runtimeRef':
      serializeRuntimeRefStreaming(node, ctx);
      break;
    case 'reactiveGetter':
      serializeReactiveGetterStreaming(node, ctx);
      break;
    case 'methodBinding':
      serializeMethodBindingStreaming(node, ctx);
      break;
    case 'iife':
      serializeIifeStreaming(node, ctx);
      break;
    case 'formattedArray':
      serializeFormattedArrayStreaming(node, ctx);
      break;
    case 'varDecl':
      serializeVarDeclStreaming(node, ctx);
      break;
    case 'return':
      serializeReturnStreaming(node, ctx);
      break;
    case 'exprStmt':
      serializeExprStmtStreaming(node, ctx);
      break;
    default:
      throw new Error(`Unknown node type: ${(node as JSAny).type}`);
  }
}

function formatStringLiteral(value: string, quote?: '"' | "'"): string {
  if (quote === "'") {
    const json = JSON.stringify(value);
    const inner = json.slice(1, -1).replace(/'/g, "\\'");
    return `'${inner}'`;
  }
  return JSON.stringify(value);
}

function serializeLiteralStreaming(node: JSLiteral, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;
  let code: string;
  let mappingSource: MappingSource;

  if (node.value === null) {
    code = 'null';
    mappingSource = 'NullLiteral';
  } else if (node.value === undefined) {
    code = 'undefined';
    mappingSource = 'UndefinedLiteral';
  } else if (typeof node.value === 'string') {
    code = formatStringLiteral(node.value, node.quote);
    mappingSource = 'StringLiteral';
  } else if (typeof node.value === 'boolean') {
    code = String(node.value);
    mappingSource = 'BooleanLiteral';
  } else {
    code = String(node.value);
    mappingSource = 'NumberLiteral';
  }

  if (node.sourceRange) {
    emitter.emitMapped(code, node.sourceRange, mappingSource);
  } else {
    emitter.emit(code);
  }
}

function serializeIdentifierStreaming(node: JSIdentifier, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;
  if (node.sourceRange) {
    const mappingName = node.mappingName ?? node.name;
    emitter.emitMapped(node.name, node.sourceRange, node.sourceNode || 'PathExpression', mappingName);
  } else {
    emitter.emit(node.name);
  }
}

function paramName(param: JSParam): string {
  return typeof param === 'string' ? param : param.name;
}

function serializeParamStreaming(param: JSParam, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;
  if (typeof param === 'string') {
    emitter.emit(param);
  } else {
    serializeIdentifierStreaming(param, ctx);
  }
}

function serializeParamListStreaming(
  params: readonly JSParam[],
  ctx: SerializeContext,
  wrap: boolean
): void {
  const emitter = ctx.emitter!;
  if (wrap) emitter.emit('(');
  for (let i = 0; i < params.length; i++) {
    if (i > 0) emitter.emit(', ');
    serializeParamStreaming(params[i], ctx);
  }
  if (wrap) emitter.emit(')');
}

function formatParamList(params: readonly JSParam[]): string {
  return params.map(paramName).join(', ');
}

function serializeMemberStreaming(node: JSMemberExpression, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;

  serializeNodeStreaming(node.object, ctx);

  if (node.computed) {
    emitter.emit(node.optional ? '?.[' : '[');
    serializeNodeStreaming(node.property as JSExpression, ctx);
    emitter.emit(']');
  } else {
    const prop = node.property as string;

    // Use bracket notation for property names that aren't valid JS identifiers
    // (e.g., hyphenated names like "my-component")
    if (!isSafeKey(prop)) {
      emitter.emit(node.optional ? '?.[' : '[');
      // Preserve source mapping for hyphenated properties when available
      if (node.propertySourceRange) {
        emitter.emitMapped(JSON.stringify(prop), node.propertySourceRange, 'PathExpression', prop);
      } else {
        emitter.emit(JSON.stringify(prop));
      }
      emitter.emit(']');
    } else {
      const accessor = node.optional ? '?.' : '.';
      emitter.emit(accessor);
      if (node.propertySourceRange) {
        emitter.emitMapped(prop, node.propertySourceRange, 'PathExpression', prop);
      } else {
        emitter.emit(prop);
      }
    }
  }
}

function serializeCallStreaming(node: JSCallExpression, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;

  // Get callee string for PURE check (need to serialize first)
  const calleeCode = serializeNode(node.callee, { ...ctx, streaming: false });
  const prefix = ctx.emitPure && PURE_FUNCTIONS.has(calleeCode) ? '/*#__PURE__*/' : '';

  if (prefix) {
    emitter.emit(prefix);
  }

  // Start a scope for the entire call if it has a sourceRange
  // Use the specified mappingSource or default to 'SubExpression'
  if (node.sourceRange) {
    emitter.pushScope(node.sourceRange, node.mappingSource || 'SubExpression');
  }

  serializeNodeStreaming(node.callee, ctx);

  // Use formatted output with newlines between arguments when formatted flag is set
  if (node.formatted && node.arguments.length > 1) {
    ctx.indentLevel++;
    const indent = getRelativeIndent(ctx);
    emitter.emit('(' + getNewlineWithBase(ctx));
    for (let i = 0; i < node.arguments.length; i++) {
      emitter.emit(indent);
      serializeNodeStreaming(node.arguments[i], ctx);
      if (i < node.arguments.length - 1) {
        emitter.emit(',' + getNewlineWithBase(ctx));
      } else {
        emitter.emit(getNewlineWithBase(ctx));
      }
    }
    ctx.indentLevel--;
    emitter.emit(getRelativeIndent(ctx) + ')');
  } else {
    emitter.emit('(');
    for (let i = 0; i < node.arguments.length; i++) {
      if (i > 0) emitter.emit(', ');
      serializeNodeStreaming(node.arguments[i], ctx);
    }
    emitter.emit(')');
  }

  if (node.sourceRange) {
    emitter.popScope();
  }
}

function serializeMethodCallStreaming(node: JSMethodCall, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;

  if (node.sourceRange) {
    emitter.pushScope(node.sourceRange, 'SubExpression');
  }

  serializeNodeStreaming(node.object, ctx);
  emitter.emit('.' + node.method + '(');

  for (let i = 0; i < node.arguments.length; i++) {
    if (i > 0) emitter.emit(', ');
    serializeNodeStreaming(node.arguments[i], ctx);
  }

  emitter.emit(')');

  if (node.sourceRange) {
    emitter.popScope();
  }
}

function serializeArrowStreaming(node: JSArrowFunction, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;

  if (node.sourceRange) {
    emitter.pushScope(node.sourceRange, 'Synthetic');
  }

  const wrapParams = node.params.length !== 1;
  serializeParamListStreaming(node.params, ctx, wrapParams);
  emitter.emit(' => ');

  // Disable PURE annotations inside arrow bodies (tree-shakers can't eliminate nested calls)
  const bodyCtx = ctx.emitPure ? { ...ctx, emitPure: false } : ctx;

  if (node.expression) {
    serializeNodeStreaming(node.body as JSExpression, bodyCtx);
  } else {
    emitter.emit('{ ');
    const stmts = node.body as JSStatement[];
    for (let i = 0; i < stmts.length; i++) {
      if (i > 0) emitter.emit(' ');
      serializeNodeStreaming(stmts[i], bodyCtx);
    }
    emitter.emit(' }');
  }

  if (node.sourceRange) {
    emitter.popScope();
  }
}

function serializeFunctionStreaming(node: JSFunction, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;
  const name = node.name || '';

  if (node.sourceRange) {
    emitter.pushScope(node.sourceRange, 'Synthetic');
  }

  // Disable PURE annotations inside function bodies (tree-shakers can't eliminate nested calls)
  const bodyCtx = ctx.emitPure ? { ...ctx, emitPure: false } : ctx;

  const useFormatted = node.formatted || (ctx.format && node.body.length > 1);
  const fnPrefix = `function${name ? ' ' + name : ''}`;

  if (useFormatted) {
    bodyCtx.indentLevel++;
    const indent = getRelativeIndent(bodyCtx);
    emitter.emit(fnPrefix);
    serializeParamListStreaming(node.params, bodyCtx, true);
    emitter.emit('{' + getNewlineWithBase(bodyCtx));
    for (let i = 0; i < node.body.length; i++) {
      emitter.emit(indent);
      serializeNodeStreaming(node.body[i], bodyCtx);
      emitter.emit(getNewlineWithBase(bodyCtx));
    }
    bodyCtx.indentLevel--;
    emitter.emit(getRelativeIndent(bodyCtx) + '}');
  } else {
    emitter.emit(fnPrefix);
    serializeParamListStreaming(node.params, bodyCtx, true);
    emitter.emit('{');
    for (const stmt of node.body) {
      serializeNodeStreaming(stmt, bodyCtx);
    }
    emitter.emit('}');
  }

  if (node.sourceRange) {
    emitter.popScope();
  }
}

function serializeArrayStreaming(node: JSArrayExpression, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;

  if (node.sourceRange) {
    emitter.pushScope(node.sourceRange, node.mappingSource || 'Synthetic');
  }

  if (node.elements.length === 0) {
    emitter.emit('[]');
  } else if (ctx.format && node.elements.length > 2) {
    ctx.indentLevel++;
    const indent = getRelativeIndent(ctx);
    emitter.emit('[' + getNewlineWithBase(ctx));
    for (let i = 0; i < node.elements.length; i++) {
      emitter.emit(indent);
      serializeNodeStreaming(node.elements[i], ctx);
      if (i < node.elements.length - 1) {
        emitter.emit(',' + getNewlineWithBase(ctx));
      } else {
        emitter.emit(getNewlineWithBase(ctx));
      }
    }
    ctx.indentLevel--;
    emitter.emit(getRelativeIndent(ctx) + ']');
  } else {
    emitter.emit('[');
    for (let i = 0; i < node.elements.length; i++) {
      if (i > 0) emitter.emit(', ');
      serializeNodeStreaming(node.elements[i], ctx);
    }
    emitter.emit(']');
  }

  if (node.sourceRange) {
    emitter.popScope();
  }
}

function serializeObjectStreaming(node: JSObjectExpression, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;

  if (node.sourceRange) {
    emitter.pushScope(node.sourceRange, 'Synthetic');
  }

  if (node.properties.length === 0) {
    emitter.emit('{}');
  } else if (ctx.format && node.properties.length > 2) {
    ctx.indentLevel++;
    const indent = getRelativeIndent(ctx);
    emitter.emit('{' + getNewlineWithBase(ctx));
    for (let i = 0; i < node.properties.length; i++) {
      emitter.emit(indent);
      serializePropertyStreaming(node.properties[i], ctx);
      if (i < node.properties.length - 1) {
        emitter.emit(',' + getNewlineWithBase(ctx));
      } else {
        emitter.emit(getNewlineWithBase(ctx));
      }
    }
    ctx.indentLevel--;
    emitter.emit(getRelativeIndent(ctx) + '}');
  } else {
    emitter.emit('{ ');
    for (let i = 0; i < node.properties.length; i++) {
      if (i > 0) emitter.emit(', ');
      serializePropertyStreaming(node.properties[i], ctx);
    }
    emitter.emit(' }');
  }

  if (node.sourceRange) {
    emitter.popScope();
  }
}

function serializePropertyStreaming(prop: JSProperty, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;

  if (prop.sourceRange) {
    emitter.pushScope(prop.sourceRange, 'HashPair');
  }

  if (prop.shorthand) {
    if (prop.keySourceRange) {
      emitter.emitMapped(prop.key, prop.keySourceRange, 'HashPair', prop.key);
    } else {
      emitter.emit(prop.key);
    }
  } else if (prop.computed) {
    const tuple = prop.value as JSArrayExpression;
    emitter.emit('[');
    serializeNodeStreaming(tuple.elements[0], ctx);
    emitter.emit(']: ');
    serializeNodeStreaming(tuple.elements[1], ctx);
  } else {
    const key = isSafeKey(prop.key) ? prop.key : JSON.stringify(prop.key);
    if (prop.keySourceRange) {
      emitter.emitMapped(key, prop.keySourceRange, 'HashPair', prop.key);
    } else {
      emitter.emit(key);
    }
    emitter.emit(': ');
    serializeNodeStreaming(prop.value, ctx);
  }

  if (prop.sourceRange) {
    emitter.popScope();
  }
}

function serializeSpreadStreaming(node: JSSpreadElement, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;
  emitter.emit('...');
  serializeNodeStreaming(node.argument, ctx);
}

function serializeBinaryStreaming(node: JSBinaryExpression, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;

  if (node.sourceRange) {
    emitter.pushScope(node.sourceRange, 'Synthetic');
  }

  serializeNodeStreaming(node.left, ctx);
  emitter.emit(' ' + node.operator + ' ');
  serializeNodeStreaming(node.right, ctx);

  if (node.sourceRange) {
    emitter.popScope();
  }
}

function serializeConditionalStreaming(node: JSConditionalExpression, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;

  if (node.sourceRange) {
    emitter.pushScope(node.sourceRange, 'Synthetic');
  }

  serializeNodeStreaming(node.test, ctx);
  emitter.emit(' ? ');
  serializeNodeStreaming(node.consequent, ctx);
  emitter.emit(' : ');
  serializeNodeStreaming(node.alternate, ctx);

  if (node.sourceRange) {
    emitter.popScope();
  }
}

function serializeRawStreaming(node: JSRaw, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;
  if (node.sourceRange) {
    emitter.emitMapped(node.code, node.sourceRange, 'Synthetic');
  } else {
    emitter.emit(node.code);
  }
}

function serializeRuntimeRefStreaming(node: JSRuntimeRef, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;
  if (node.sourceRange) {
    emitter.emitMapped(node.symbol, node.sourceRange, 'PathExpression', node.symbol);
  } else {
    emitter.emit(node.symbol);
  }
}

function serializeReactiveGetterStreaming(node: JSReactiveGetter, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;

  // Don't push scope for reactive getter - let the inner expression handle mapping
  // if (node.sourceRange) {
  //   emitter.pushScope(node.sourceRange, 'PathExpression');
  // }

  emitter.emit('() => ');
  serializeNodeStreaming(node.expression, ctx);

  // if (node.sourceRange) {
  //   emitter.popScope();
  // }
}

function serializeMethodBindingStreaming(node: JSMethodBinding, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;

  if (node.sourceRange) {
    emitter.pushScope(node.sourceRange, 'Synthetic');
  }

  serializeNodeStreaming(node.fn, ctx);
  emitter.emit('.bind(');
  serializeNodeStreaming(node.thisArg, ctx);

  for (const arg of node.boundArgs) {
    emitter.emit(', ');
    serializeNodeStreaming(arg, ctx);
  }

  emitter.emit(')');

  if (node.sourceRange) {
    emitter.popScope();
  }
}

function serializeIifeStreaming(node: JSIife, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;

  if (node.sourceRange) {
    emitter.pushScope(node.sourceRange, 'Synthetic');
  }

  emitter.emit('(function');
  serializeParamListStreaming(node.params, ctx, true);
  emitter.emit('{');
  for (const stmt of node.body) {
    serializeNodeStreaming(stmt, ctx);
  }
  emitter.emit('})(');

  for (let i = 0; i < node.args.length; i++) {
    if (i > 0) emitter.emit(', ');
    serializeNodeStreaming(node.args[i], ctx);
  }

  emitter.emit(')');

  if (node.sourceRange) {
    emitter.popScope();
  }
}

function serializeFormattedArrayStreaming(node: JSFormattedArray, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;

  if (node.sourceRange) {
    emitter.pushScope(node.sourceRange, 'Synthetic');
  }

  if (node.elements.length === 0) {
    emitter.emit('[]');
  } else if (node.multiline) {
    ctx.indentLevel++;
    const indent = getRelativeIndent(ctx);
    emitter.emit('[' + getNewlineWithBase(ctx));
    for (let i = 0; i < node.elements.length; i++) {
      emitter.emit(indent);
      serializeNodeStreaming(node.elements[i], ctx);
      if (i < node.elements.length - 1) {
        emitter.emit(',' + getNewlineWithBase(ctx));
      } else {
        emitter.emit(getNewlineWithBase(ctx));
      }
    }
    ctx.indentLevel--;
    emitter.emit(getRelativeIndent(ctx) + ']');
  } else {
    emitter.emit('[');
    for (let i = 0; i < node.elements.length; i++) {
      if (i > 0) emitter.emit(', ');
      serializeNodeStreaming(node.elements[i], ctx);
    }
    emitter.emit(']');
  }

  if (node.sourceRange) {
    emitter.popScope();
  }
}

function serializeVarDeclStreaming(node: JSVariableDeclaration, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;
  emitter.emit(`${node.kind} ${node.name}`);
  if (node.init) {
    emitter.emit(' = ');
    serializeNodeStreaming(node.init, ctx);
  }
  emitter.emit(';');
}

function serializeReturnStreaming(node: JSReturnStatement, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;
  emitter.emit('return');
  if (node.argument) {
    emitter.emit(' ');
    serializeNodeStreaming(node.argument, ctx);
  }
  emitter.emit(';');
}

function serializeExprStmtStreaming(node: JSExpressionStatement, ctx: SerializeContext): void {
  const emitter = ctx.emitter!;
  serializeNodeStreaming(node.expression, ctx);
  emitter.emit(';');
}

/**
 * Emit code, optionally through the emitter.
 *
 * IMPORTANT: To avoid duplicate emissions when parent nodes assemble child strings,
 * only emit when `shouldEmit` is true. Child nodes that have already been serialized
 * and included in a parent's code string should not be emitted again.
 */
function emit(
  code: string,
  ctx: SerializeContext,
  sourceRange?: SourceRange,
  nodeType?: MappingSource,
  shouldEmit: boolean = false
): string {
  // Only emit if explicitly requested (for leaf nodes or top-level composites)
  // This prevents duplicate emissions when parent nodes include child code in their output
  if (shouldEmit && ctx.emitter && sourceRange) {
    ctx.emitter.emitMapped(code, sourceRange, nodeType || 'Synthetic');
  }
  return code;
}

/**
 * Get relative indentation (just indent * level, without baseIndent).
 * Use this after getNewlineWithBase() which already includes baseIndent.
 */
function getRelativeIndent(ctx: SerializeContext): string {
  return ctx.indent.repeat(ctx.indentLevel);
}

/**
 * Get newline string with baseIndent for continuation.
 */
function getNewline(ctx: SerializeContext): string {
  if (!ctx.format) return '';
  return '\n';
}

/**
 * Get newline followed by base indentation for streaming mode.
 * After this, use getRelativeIndent() to add level-based indentation.
 */
function getNewlineWithBase(ctx: SerializeContext): string {
  return '\n' + ctx.baseIndent;
}

// ============================================================================
// Serializers
// ============================================================================

function serializeLiteral(node: JSLiteral, ctx: SerializeContext): string {
  let code: string;

  if (node.value === null) {
    code = 'null';
  } else if (node.value === undefined) {
    code = 'undefined';
  } else if (typeof node.value === 'string') {
    code = formatStringLiteral(node.value, node.quote);
  } else if (typeof node.value === 'boolean') {
    code = String(node.value);
  } else {
    code = String(node.value);
  }

  return emit(code, ctx, node.sourceRange);
}

function serializeIdentifier(node: JSIdentifier, ctx: SerializeContext): string {
  return emit(node.name, ctx, node.sourceRange);
}

function serializeMember(node: JSMemberExpression, ctx: SerializeContext): string {
  const obj = serializeNode(node.object, ctx);

  if (node.computed) {
    const prop = serializeNode(node.property as JSExpression, ctx);
    const code = node.optional ? `${obj}?.[${prop}]` : `${obj}[${prop}]`;
    return emit(code, ctx, node.sourceRange);
  }

  const prop = node.property as string;

  // Use bracket notation for property names that aren't valid JS identifiers
  // (e.g., hyphenated names like "my-component")
  if (!isSafeKey(prop)) {
    const code = node.optional ? `${obj}?.[${JSON.stringify(prop)}]` : `${obj}[${JSON.stringify(prop)}]`;
    return emit(code, ctx, node.sourceRange);
  }

  const accessor = node.optional ? '?.' : '.';
  const code = `${obj}${accessor}${prop}`;
  // Emit with source range to preserve source mapping for safe properties
  return emit(code, ctx, node.sourceRange);
}

function serializeCall(node: JSCallExpression, ctx: SerializeContext): string {
  const callee = serializeNode(node.callee, ctx);

  // Add PURE annotation for known side-effect-free functions (enables tree-shaking)
  // Skip in dev/formatted mode since tree-shaking isn't applied there
  const prefix = ctx.emitPure && PURE_FUNCTIONS.has(callee) ? '/*#__PURE__*/' : '';

  // Use formatted output with newlines between arguments when formatted flag is set
  if (node.formatted && node.arguments.length > 1) {
    ctx.indentLevel++;
    const relIndent = ctx.indent.repeat(ctx.indentLevel);
    const nl = '\n' + ctx.baseIndent;
    const args = node.arguments.map(arg => relIndent + serializeNode(arg, ctx)).join(',' + nl);
    ctx.indentLevel--;
    const closingRelIndent = ctx.indent.repeat(ctx.indentLevel);
    const code = `${prefix}${callee}(${nl}${args}${nl}${closingRelIndent})`;
    return emit(code, ctx, node.sourceRange);
  }

  const args = node.arguments.map(arg => serializeNode(arg, ctx)).join(', ');
  const code = `${prefix}${callee}(${args})`;

  return emit(code, ctx, node.sourceRange);
}

function serializeMethodCall(node: JSMethodCall, ctx: SerializeContext): string {
  const obj = serializeNode(node.object, ctx);
  const args = node.arguments.map(arg => serializeNode(arg, ctx)).join(', ');
  const code = `${obj}.${node.method}(${args})`;
  return emit(code, ctx, node.sourceRange);
}

function serializeArrow(node: JSArrowFunction, ctx: SerializeContext): string {
  const params = node.params.length === 1
    ? paramName(node.params[0])
    : `(${formatParamList(node.params)})`;

  // Disable PURE annotations inside arrow bodies (tree-shakers can't eliminate nested calls)
  const bodyCtx = ctx.emitPure ? { ...ctx, emitPure: false } : ctx;

  let body: string;
  if (node.expression) {
    body = serializeNode(node.body as JSExpression, bodyCtx);
  } else {
    const stmts = (node.body as JSStatement[])
      .map(stmt => serializeNode(stmt, bodyCtx))
      .join(getNewline(bodyCtx));
    body = `{ ${stmts} }`;
  }

  const code = `${params} => ${body}`;
  return emit(code, ctx, node.sourceRange);
}

function serializeFunction(node: JSFunction, ctx: SerializeContext): string {
  const name = node.name || '';
  const params = formatParamList(node.params);

  // Disable PURE annotations inside function bodies (tree-shakers can't eliminate nested calls)
  const bodyCtx = ctx.emitPure ? { ...ctx, emitPure: false } : ctx;

  // Check if we should use formatted output (multi-line with indentation)
  const useFormatted = node.formatted || (ctx.format && node.body.length > 1);

  if (useFormatted) {
    // Formatted: multi-line function with proper indentation
    // Use relative indent (not baseIndent + indent) because nl already includes baseIndent
    bodyCtx.indentLevel++;
    const relIndent = bodyCtx.indent.repeat(bodyCtx.indentLevel);
    const nl = '\n' + bodyCtx.baseIndent;
    const stmts = node.body
      .map(stmt => `${relIndent}${serializeNode(stmt, bodyCtx)}`)
      .join(nl);
    bodyCtx.indentLevel--;
    const closingRelIndent = bodyCtx.indent.repeat(bodyCtx.indentLevel);
    const code = `function${name ? ' ' + name : ''}(${params}){${nl}${stmts}${nl}${closingRelIndent}}`;
    return emit(code, ctx, node.sourceRange);
  }

  // Inline: single line
  const stmts = node.body
    .map(stmt => serializeNode(stmt, bodyCtx))
    .join('');

  const code = `function${name ? ' ' + name : ''}(${params}){${stmts}}`;
  return emit(code, ctx, node.sourceRange);
}

function serializeArray(node: JSArrayExpression, ctx: SerializeContext): string {
  if (node.elements.length === 0) {
    return emit('[]', ctx, node.sourceRange);
  }

  const elements = node.elements.map(el => serializeNode(el, ctx));

  // Format if enabled and has multiple elements
  if (ctx.format && elements.length > 2) {
    ctx.indentLevel++;
    const relIndent = ctx.indent.repeat(ctx.indentLevel);
    const nl = '\n' + ctx.baseIndent;
    const content = elements.map(el => `${relIndent}${el}`).join(',' + nl);
    ctx.indentLevel--;
    const closingRelIndent = ctx.indent.repeat(ctx.indentLevel);
    const code = `[${nl}${content}${nl}${closingRelIndent}]`;
    return emit(code, ctx, node.sourceRange);
  }

  const code = `[${elements.join(', ')}]`;
  return emit(code, ctx, node.sourceRange);
}

function serializeObject(node: JSObjectExpression, ctx: SerializeContext): string {
  if (node.properties.length === 0) {
    return emit('{}', ctx, node.sourceRange);
  }

  const props = node.properties.map(prop => serializeProperty(prop, ctx));

  // Format if enabled and has multiple properties
  if (ctx.format && props.length > 2) {
    ctx.indentLevel++;
    const relIndent = ctx.indent.repeat(ctx.indentLevel);
    const nl = '\n' + ctx.baseIndent;
    const content = props.map(p => `${relIndent}${p}`).join(',' + nl);
    ctx.indentLevel--;
    const closingRelIndent = ctx.indent.repeat(ctx.indentLevel);
    const code = `{${nl}${content}${nl}${closingRelIndent}}`;
    return emit(code, ctx, node.sourceRange);
  }

  const code = `{ ${props.join(', ')} }`;
  return emit(code, ctx, node.sourceRange);
}

function serializeProperty(prop: JSProperty, ctx: SerializeContext): string {
  if (prop.shorthand) {
    return prop.key;
  }

  if (prop.computed) {
    // Computed property: value is stored as [key, val] tuple
    const tuple = prop.value as JSArrayExpression;
    const key = serializeNode(tuple.elements[0], ctx);
    const val = serializeNode(tuple.elements[1], ctx);
    return `[${key}]: ${val}`;
  }

  const key = isSafeKey(prop.key) ? prop.key : JSON.stringify(prop.key);
  const value = serializeNode(prop.value, ctx);
  return `${key}: ${value}`;
}

function serializeSpread(node: JSSpreadElement, ctx: SerializeContext): string {
  const arg = serializeNode(node.argument, ctx);
  const code = `...${arg}`;
  return emit(code, ctx, node.sourceRange);
}

function serializeBinary(node: JSBinaryExpression, ctx: SerializeContext): string {
  const left = serializeNode(node.left, ctx);
  const right = serializeNode(node.right, ctx);
  const code = `${left} ${node.operator} ${right}`;
  return emit(code, ctx, node.sourceRange);
}

function serializeConditional(
  node: JSConditionalExpression,
  ctx: SerializeContext
): string {
  const test = serializeNode(node.test, ctx);
  const consequent = serializeNode(node.consequent, ctx);
  const alternate = serializeNode(node.alternate, ctx);
  const code = `${test} ? ${consequent} : ${alternate}`;
  return emit(code, ctx, node.sourceRange);
}

function serializeRaw(node: JSRaw, ctx: SerializeContext): string {
  return emit(node.code, ctx, node.sourceRange);
}

function serializeRuntimeRef(node: JSRuntimeRef, ctx: SerializeContext): string {
  return emit(node.symbol, ctx, node.sourceRange, 'PathExpression', false);
}

function serializeReactiveGetter(node: JSReactiveGetter, ctx: SerializeContext): string {
  // Reactive getters are wrapped in () => expr for reactivity
  const expr = serializeNode(node.expression, ctx);
  const code = `() => ${expr}`;
  // Don't emit mapping for the getter - let the inner expression handle it
  // return emit(code, ctx, node.sourceRange);
  return code;
}

function serializeMethodBinding(node: JSMethodBinding, ctx: SerializeContext): string {
  // Method binding: fn.bind(thisArg, ...boundArgs)
  const fn = serializeNode(node.fn, ctx);
  const thisArg = serializeNode(node.thisArg, ctx);
  const args = node.boundArgs.map(arg => serializeNode(arg, ctx));
  const allArgs = [thisArg, ...args].join(', ');
  const code = `${fn}.bind(${allArgs})`;
  return emit(code, ctx, node.sourceRange);
}

function serializeIife(node: JSIife, ctx: SerializeContext): string {
  // IIFE: (function(params) { body })(args)
  const params = formatParamList(node.params);
  const stmts = node.body.map(stmt => serializeNode(stmt, ctx)).join('');
  const args = node.args.map(arg => serializeNode(arg, ctx)).join(', ');
  const code = `(function(${params}){${stmts}})(${args})`;
  return emit(code, ctx, node.sourceRange);
}

function serializeFormattedArray(node: JSFormattedArray, ctx: SerializeContext): string {
  if (node.elements.length === 0) {
    return emit('[]', ctx, node.sourceRange);
  }

  // Format with line breaks when multiline is true (regardless of element count)
  // Use relative indent because nl already includes baseIndent
  if (node.multiline) {
    ctx.indentLevel++;
    const relIndent = ctx.indent.repeat(ctx.indentLevel);
    const nl = '\n' + ctx.baseIndent;
    const elements = node.elements.map(el => serializeNode(el, ctx));
    const content = elements.map(el => `${relIndent}${el}`).join(',' + nl);
    ctx.indentLevel--;
    const closingRelIndent = ctx.indent.repeat(ctx.indentLevel);
    const code = `[${nl}${content}${nl}${closingRelIndent}]`;
    return emit(code, ctx, node.sourceRange);
  }

  const elements = node.elements.map(el => serializeNode(el, ctx));
  const code = `[${elements.join(', ')}]`;
  return emit(code, ctx, node.sourceRange);
}

function serializeVarDecl(
  node: JSVariableDeclaration,
  ctx: SerializeContext
): string {
  const init = node.init ? ` = ${serializeNode(node.init, ctx)}` : '';
  const code = `${node.kind} ${node.name}${init};`;
  return emit(code, ctx, node.sourceRange);
}

function serializeReturn(node: JSReturnStatement, ctx: SerializeContext): string {
  const arg = node.argument ? ` ${serializeNode(node.argument, ctx)}` : '';
  const code = `return${arg};`;
  return emit(code, ctx, node.sourceRange);
}

function serializeExprStmt(
  node: JSExpressionStatement,
  ctx: SerializeContext
): string {
  const expr = serializeNode(node.expression, ctx);
  return emit(`${expr};`, ctx, node.sourceRange);
}

// ============================================================================
// Helpers
// ============================================================================
