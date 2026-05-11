/**
 * Code Builder Functions
 *
 * Factory functions for creating JS AST-like nodes.
 * These provide a clean, type-safe API for code generation.
 */

import type { SourceRange, MappingSource } from '../types';
import type {
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
  JSExpression,
  JSStatement,
} from './types';

// ============================================================================
// Literal Builders
// ============================================================================

/**
 * Create a string literal.
 */
export function string(value: string, sourceRange?: SourceRange): JSLiteral {
  return { type: 'literal', value, sourceRange };
}

/**
 * Create a string literal using single quotes.
 */
export function stringSingle(value: string, sourceRange?: SourceRange): JSLiteral {
  return { type: 'literal', value, sourceRange, quote: '\'' };
}

/**
 * Create a number literal.
 */
export function num(value: number, sourceRange?: SourceRange): JSLiteral {
  return { type: 'literal', value, sourceRange };
}

/**
 * Create a boolean literal.
 */
export function bool(value: boolean, sourceRange?: SourceRange): JSLiteral {
  return { type: 'literal', value, sourceRange };
}

/**
 * Create null.
 */
export function nil(sourceRange?: SourceRange): JSLiteral {
  return { type: 'literal', value: null, sourceRange };
}

/**
 * Create undefined.
 */
export function undef(sourceRange?: SourceRange): JSLiteral {
  return { type: 'literal', value: undefined, sourceRange };
}

// ============================================================================
// Identifier and Member Access
// ============================================================================

/**
 * Create an identifier.
 */
export function id(
  name: string,
  sourceRange?: SourceRange,
  sourceNode?: MappingSource,
  mappingName?: string
): JSIdentifier {
  return { type: 'identifier', name, sourceRange, sourceNode, mappingName };
}

/**
 * Create a member expression (a.b).
 */
export function member(
  object: JSExpression,
  property: string,
  sourceRange?: SourceRange,
  propertySourceRange?: SourceRange
): JSMemberExpression {
  return {
    type: 'member',
    object,
    property,
    optional: false,
    computed: false,
    sourceRange,
    propertySourceRange,
  };
}

/**
 * Create an optional member expression (a?.b).
 */
export function optionalMember(
  object: JSExpression,
  property: string,
  sourceRange?: SourceRange,
  propertySourceRange?: SourceRange
): JSMemberExpression {
  return {
    type: 'member',
    object,
    property,
    optional: true,
    computed: false,
    sourceRange,
    propertySourceRange,
  };
}

/**
 * Create a computed member expression (a[b]).
 */
export function computedMember(
  object: JSExpression,
  property: JSExpression,
  sourceRange?: SourceRange,
  optional = false
): JSMemberExpression {
  return {
    type: 'member',
    object,
    property,
    optional,
    computed: true,
    sourceRange,
  };
}

/**
 * Create a path expression from a dotted string (e.g., "this.foo.bar").
 */
export function path(
  pathStr: string,
  optionalChaining = false,
  sourceRange?: SourceRange
): JSExpression {
  const parts = pathStr.split('.');
  if (parts.length === 1) {
    return id(parts[0], sourceRange);
  }

  let result: JSExpression = id(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    // Apply optional chaining only for segments beyond the first two
    const useOptional = optionalChaining && i >= 2;
    // Pass sourceRange to the final member expression
    const isLast = i === parts.length - 1;
    result = useOptional
      ? optionalMember(result, parts[i], isLast ? sourceRange : undefined)
      : member(result, parts[i], isLast ? sourceRange : undefined);
  }

  return result;
}

// ============================================================================
// Function Calls
// ============================================================================

/**
 * Create a function call.
 * @param formatted - When true, arguments are formatted with newlines for readability
 * @param mappingSource - Override the default 'SubExpression' mapping type (e.g., 'ElementNode' for elements)
 */
export function call(
  callee: JSExpression | string,
  args: readonly JSExpression[],
  sourceRange?: SourceRange,
  formatted?: boolean,
  mappingSource?: MappingSource
): JSCallExpression {
  return {
    type: 'call',
    callee: typeof callee === 'string' ? id(callee) : callee,
    arguments: args,
    sourceRange,
    formatted,
    mappingSource,
  };
}

/**
 * Create a method call (object.method(...)).
 */
export function methodCall(
  object: JSExpression,
  method: string,
  args: readonly JSExpression[],
  sourceRange?: SourceRange
): JSMethodCall {
  return {
    type: 'methodCall',
    object,
    method,
    arguments: args,
    sourceRange,
  };
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Create an arrow function with expression body.
 */
export function arrow(
  params: readonly (string | JSIdentifier)[],
  body: JSExpression,
  sourceRange?: SourceRange
): JSArrowFunction {
  return {
    type: 'arrow',
    params,
    body,
    expression: true,
    sourceRange,
  };
}

/**
 * Create an arrow function with block body.
 */
export function arrowBlock(
  params: readonly (string | JSIdentifier)[],
  body: JSStatement[],
  sourceRange?: SourceRange
): JSArrowFunction {
  return {
    type: 'arrow',
    params,
    body,
    expression: false,
    sourceRange,
  };
}

/**
 * Create a getter function (() => expr).
 */
export function getter(
  expr: JSExpression,
  sourceRange?: SourceRange
): JSArrowFunction {
  return arrow([], expr, sourceRange);
}

/**
 * Create a regular function expression.
 */
export function func(
  params: readonly (string | JSIdentifier)[],
  body: JSStatement[],
  name?: string,
  sourceRange?: SourceRange,
  formatted?: boolean
): JSFunction {
  return {
    type: 'function',
    name,
    params,
    body,
    sourceRange,
    formatted,
  };
}

// ============================================================================
// Arrays and Objects
// ============================================================================

/**
 * Create an array expression.
 */
export function array(
  elements: readonly JSExpression[],
  sourceRange?: SourceRange,
  mappingSource?: MappingSource
): JSArrayExpression {
  return { type: 'array', elements, sourceRange, mappingSource };
}

/**
 * Create an object expression.
 */
export function object(
  properties: readonly JSProperty[],
  sourceRange?: SourceRange
): JSObjectExpression {
  return { type: 'object', properties, sourceRange };
}

/**
 * Create an object property.
 */
export function prop(
  key: string,
  value: JSExpression,
  computed = false,
  sourceRange?: SourceRange,
  keySourceRange?: SourceRange
): JSProperty {
  return { key, value, computed, shorthand: false, sourceRange, keySourceRange };
}

/**
 * Create a shorthand property ({ x } === { x: x }).
 */
export function shorthand(key: string): JSProperty {
  return { key, value: id(key), computed: false, shorthand: true };
}

/**
 * Create a computed property ({ [key]: value }).
 */
export function computedProp(
  key: JSExpression,
  value: JSExpression
): JSProperty {
  // For computed props, key is stored as the serialized key expression
  return {
    key: '', // Will be handled specially in serializer
    value: array([key, value]), // Store as tuple for serializer
    computed: true,
    shorthand: false,
  };
}

/**
 * Create a spread element (...x).
 */
export function spread(
  argument: JSExpression,
  sourceRange?: SourceRange
): JSSpreadElement {
  return { type: 'spread', argument, sourceRange };
}

// ============================================================================
// Operators
// ============================================================================

/**
 * Create a binary expression.
 */
export function binary(
  operator: string,
  left: JSExpression,
  right: JSExpression,
  sourceRange?: SourceRange
): JSBinaryExpression {
  return { type: 'binary', operator, left, right, sourceRange };
}

/**
 * Create a conditional expression (a ? b : c).
 */
export function conditional(
  test: JSExpression,
  consequent: JSExpression,
  alternate: JSExpression,
  sourceRange?: SourceRange
): JSConditionalExpression {
  return { type: 'conditional', test, consequent, alternate, sourceRange };
}

// ============================================================================
// Raw Code
// ============================================================================

/**
 * Create raw code (escape hatch for already-serialized code).
 */
export function raw(code: string, sourceRange?: SourceRange): JSRaw {
  return { type: 'raw', code, sourceRange };
}

// ============================================================================
// Runtime References
// ============================================================================

/**
 * Create a runtime symbol reference.
 * Used for runtime symbols like $_slot, $_if, $_each, etc.
 * This replaces the $: prefix pattern for symbol references.
 */
export function runtimeRef(symbol: string, sourceRange?: SourceRange): JSRuntimeRef {
  return { type: 'runtimeRef', symbol, sourceRange };
}

/**
 * Create a reactive getter expression.
 * Wraps an expression in () => expr for reactivity.
 * This replaces the $:() => expr pattern.
 */
export function reactiveGetter(
  expression: JSExpression,
  sourceRange?: SourceRange
): JSReactiveGetter {
  return { type: 'reactiveGetter', expression, sourceRange };
}

// ============================================================================
// Statements
// ============================================================================

/**
 * Create a variable declaration.
 */
export function varDecl(
  kind: 'const' | 'let' | 'var',
  name: string,
  init?: JSExpression,
  sourceRange?: SourceRange
): JSVariableDeclaration {
  return { type: 'varDecl', kind, name, init, sourceRange };
}

/**
 * Create a const declaration.
 */
export function constDecl(
  name: string,
  init: JSExpression,
  sourceRange?: SourceRange
): JSVariableDeclaration {
  return varDecl('const', name, init, sourceRange);
}

/**
 * Create a return statement.
 */
export function ret(
  argument?: JSExpression,
  sourceRange?: SourceRange
): JSReturnStatement {
  return { type: 'return', argument, sourceRange };
}

/**
 * Create an expression statement.
 */
export function exprStmt(
  expression: JSExpression,
  sourceRange?: SourceRange
): JSExpressionStatement {
  return { type: 'exprStmt', expression, sourceRange };
}

// ============================================================================
// Utility Builders
// ============================================================================

/**
 * Create a tuple array [[key, value], ...].
 */
export function tupleArray(
  tuples: readonly [string, JSExpression][]
): JSArrayExpression {
  return array(
    tuples.map(([key, value]) => array([string(key), value]))
  );
}

/**
 * Create an empty array.
 */
export function emptyArray(): JSArrayExpression {
  return array([]);
}

/**
 * Create an empty object.
 */
export function emptyObject(): JSObjectExpression {
  return object([]);
}

/**
 * Helper to convert a value to JSExpression.
 */
export function expr(
  value: string | number | boolean | null | undefined | JSExpression
): JSExpression {
  if (value === null) return nil();
  if (value === undefined) return undef();
  if (typeof value === 'string') return string(value);
  if (typeof value === 'number') return num(value);
  if (typeof value === 'boolean') return bool(value);
  return value;
}

// ============================================================================
// Advanced Builders
// ============================================================================

/**
 * Create a method binding expression (fn.bind(thisArg, ...boundArgs)).
 * Used for partial application patterns.
 */
export function methodBinding(
  fn: JSExpression,
  thisArg: JSExpression,
  boundArgs: readonly JSExpression[] = [],
  sourceRange?: SourceRange
): JSMethodBinding {
  return { type: 'methodBinding', fn, thisArg, boundArgs, sourceRange };
}

/**
 * Create an IIFE (Immediately Invoked Function Expression).
 * (function(params) { body })(args)
 */
export function iife(
  params: readonly (string | JSIdentifier)[],
  body: JSStatement[],
  args: readonly JSExpression[] = [],
  sourceRange?: SourceRange
): JSIife {
  return { type: 'iife', params, body, args, sourceRange };
}

/**
 * Create a formatted array with explicit multiline hint.
 * When multiline is true, serializer will format with one element per line.
 */
export function formattedArray(
  elements: readonly JSExpression[],
  multiline = true,
  sourceRange?: SourceRange
): JSFormattedArray {
  return { type: 'formattedArray', elements, multiline, sourceRange };
}

/**
 * Symbol configuration for element helper wrapper.
 */
export interface ElementHelperSymbols {
  GET_ARGS: string;
  GET_FW: string;
  GET_SLOTS: string;
  FINALIZE_COMPONENT: string;
  TAG: string;
  SLOT: string;
  LOCAL_FW: string;
  LOCAL_SLOTS: string;
}

/**
 * Create an element helper wrapper function.
 * Generates the dynamic component wrapper for (element "tag").
 */
export function elementHelperWrapper(
  tagExpr: JSExpression,
  symbols: ElementHelperSymbols,
  sourceRange?: SourceRange
): JSFunction {
  // function(args) {
  //   $_GET_ARGS(this, arguments);
  //   const $fw = $_GET_FW(this, arguments);
  //   const $slots = $_GET_SLOTS(this, arguments);
  //   return $_fin([
  //     $_tag(tagExpr, $fw, this, [
  //       () => $_slot('default', () => [], $slots, this)
  //     ])
  //   ], this);
  // }
  const body: JSStatement[] = [
    // $_GET_ARGS(this, arguments);
    exprStmt(call(symbols.GET_ARGS, [id('this'), id('arguments')])),
    // const $fw = $_GET_FW(this, arguments);
    constDecl(symbols.LOCAL_FW, call(symbols.GET_FW, [id('this'), id('arguments')])),
    // const $slots = $_GET_SLOTS(this, arguments);
    constDecl(symbols.LOCAL_SLOTS, call(symbols.GET_SLOTS, [id('this'), id('arguments')])),
    // return $_fin([...], this);
    ret(
      call(symbols.FINALIZE_COMPONENT, [
        formattedArray([
          call(symbols.TAG, [
            tagExpr,
            id(symbols.LOCAL_FW),
            id('this'),
            formattedArray([
              arrow([], call(symbols.SLOT, [
                string('default'),
                arrow([], array([])),
                id(symbols.LOCAL_SLOTS),
                id('this'),
              ])),
            ], true),
          ]),
        ], true),
        id('this'),
      ])
    ),
  ];

  return func(['args'], body, undefined, sourceRange, true);
}
