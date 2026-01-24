/**
 * Code Builder Types
 *
 * AST-like node types for JavaScript code generation.
 * These provide a structured way to build code without string concatenation.
 */

import type { SourceRange, MappingSource } from '../types';

/**
 * Base interface for all JS nodes.
 */
export interface JSNode {
  readonly type: string;
  readonly sourceRange?: SourceRange;
}

/**
 * Literal values.
 */
export interface JSLiteral extends JSNode {
  type: 'literal';
  value: string | number | boolean | null | undefined;
  quote?: '"' | "'";
}

/**
 * Identifier (variable name).
 */
export interface JSIdentifier extends JSNode {
  type: 'identifier';
  name: string;
  sourceNode?: MappingSource;
  /** Optional name to use in sourcemap `names` array */
  mappingName?: string;
}

/**
 * Function parameter (identifier or plain string).
 */
export type JSParam = string | JSIdentifier;

/**
 * Property access (a.b or a[b]).
 */
export interface JSMemberExpression extends JSNode {
  type: 'member';
  object: JSExpression;
  property: string | JSExpression;
  optional: boolean; // ?.
  computed: boolean; // []
  propertySourceRange?: SourceRange;
}

/**
 * Function call.
 */
export interface JSCallExpression extends JSNode {
  type: 'call';
  callee: JSExpression;
  arguments: readonly JSExpression[];
  formatted?: boolean; // Enable multi-line formatting with indentation
  mappingSource?: MappingSource; // Override the default 'SubExpression' mapping type
}

/**
 * Method call (a.b(...)).
 */
export interface JSMethodCall extends JSNode {
  type: 'methodCall';
  object: JSExpression;
  method: string;
  arguments: readonly JSExpression[];
}

/**
 * Arrow function.
 */
export interface JSArrowFunction extends JSNode {
  type: 'arrow';
  params: readonly JSParam[];
  body: JSExpression | JSStatement[];
  expression: boolean; // () => expr vs () => { stmts }
}

/**
 * Regular function expression.
 */
export interface JSFunction extends JSNode {
  type: 'function';
  name?: string;
  params: readonly JSParam[];
  body: JSStatement[];
  formatted?: boolean; // Enable multi-line formatting with indentation
}

/**
 * Array expression.
 */
export interface JSArrayExpression extends JSNode {
  type: 'array';
  elements: readonly JSExpression[];
  mappingSource?: MappingSource; // Override the default 'Synthetic' mapping type
}

/**
 * Object expression.
 */
export interface JSObjectExpression extends JSNode {
  type: 'object';
  properties: readonly JSProperty[];
}

/**
 * Object property.
 */
export interface JSProperty {
  key: string;
  value: JSExpression;
  computed: boolean;
  shorthand: boolean;
  sourceRange?: SourceRange;
  keySourceRange?: SourceRange;
}

/**
 * Spread element (...x).
 */
export interface JSSpreadElement extends JSNode {
  type: 'spread';
  argument: JSExpression;
}

/**
 * Binary expression (a + b, a && b, etc.).
 */
export interface JSBinaryExpression extends JSNode {
  type: 'binary';
  operator: string;
  left: JSExpression;
  right: JSExpression;
}

/**
 * Conditional expression (a ? b : c).
 */
export interface JSConditionalExpression extends JSNode {
  type: 'conditional';
  test: JSExpression;
  consequent: JSExpression;
  alternate: JSExpression;
}

/**
 * Template literal.
 */
export interface JSTemplateLiteral extends JSNode {
  type: 'template';
  quasis: readonly string[];
  expressions: readonly JSExpression[];
}

/**
 * Raw code (already serialized, escape hatch).
 */
export interface JSRaw extends JSNode {
  type: 'raw';
  code: string;
}

/**
 * Method binding expression (fn.bind(thisArg, ...args)).
 * Creates a partial application.
 */
export interface JSMethodBinding extends JSNode {
  type: 'methodBinding';
  fn: JSExpression;
  thisArg: JSExpression;
  boundArgs: readonly JSExpression[];
}

/**
 * IIFE - Immediately Invoked Function Expression.
 * (function(params) { body })(args)
 */
export interface JSIife extends JSNode {
  type: 'iife';
  params: readonly JSParam[];
  body: JSStatement[];
  args: readonly JSExpression[];
}

/**
 * Formatted array with explicit hint to spread across multiple lines.
 */
export interface JSFormattedArray extends JSNode {
  type: 'formattedArray';
  elements: readonly JSExpression[];
  multiline: boolean;
}

/**
 * Runtime symbol reference.
 * Used for runtime symbols like $_slot, $_if, $_each, etc.
 * Replaces the $: prefix pattern for symbol references.
 */
export interface JSRuntimeRef extends JSNode {
  type: 'runtimeRef';
  symbol: string;
}

/**
 * Reactive getter expression.
 * Wraps an expression in () => expr for reactivity.
 * Replaces the $:() => expr pattern.
 */
export interface JSReactiveGetter extends JSNode {
  type: 'reactiveGetter';
  expression: JSExpression;
}

/**
 * Variable declaration.
 */
export interface JSVariableDeclaration extends JSNode {
  type: 'varDecl';
  kind: 'const' | 'let' | 'var';
  name: string;
  init?: JSExpression;
}

/**
 * Return statement.
 */
export interface JSReturnStatement extends JSNode {
  type: 'return';
  argument?: JSExpression;
}

/**
 * Expression statement.
 */
export interface JSExpressionStatement extends JSNode {
  type: 'exprStmt';
  expression: JSExpression;
}

/**
 * All expression types.
 */
export type JSExpression =
  | JSLiteral
  | JSIdentifier
  | JSMemberExpression
  | JSCallExpression
  | JSMethodCall
  | JSArrowFunction
  | JSFunction
  | JSArrayExpression
  | JSObjectExpression
  | JSSpreadElement
  | JSBinaryExpression
  | JSConditionalExpression
  | JSTemplateLiteral
  | JSRaw
  | JSRuntimeRef
  | JSReactiveGetter
  | JSMethodBinding
  | JSIife
  | JSFormattedArray;

/**
 * All statement types.
 */
export type JSStatement =
  | JSVariableDeclaration
  | JSReturnStatement
  | JSExpressionStatement;

/**
 * Any JS node.
 */
export type JSAny = JSExpression | JSStatement;
