/**
 * Code Builder Module
 *
 * Provides a structured, AST-like approach to JavaScript code generation.
 * Replaces string concatenation with composable node builders.
 *
 * @example
 * ```typescript
 * import { B, serializeJS } from './builder';
 *
 * // Build a function call
 * const code = serializeJS(
 *   B.call('$_tag', [
 *     B.string('div'),
 *     B.array([B.array([B.string('class'), B.string('foo')])]),
 *     B.array([B.string('Hello')])
 *   ])
 * );
 * // => '$_tag("div", [["class", "foo"]], ["Hello"])'
 * ```
 */

// Re-export types
export type {
  JSNode,
  JSExpression,
  JSStatement,
  JSAny,
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
  JSParam,
} from './types';

// Re-export builder interfaces
export type {
  ElementHelperSymbols,
} from './builders';

// Re-export builders
export {
  // Literals
  string,
  stringSingle,
  num,
  bool,
  nil,
  undef,
  // Identifiers and paths
  id,
  member,
  optionalMember,
  computedMember,
  path,
  // Calls
  call,
  methodCall,
  // Functions
  arrow,
  arrowBlock,
  getter,
  func,
  // Arrays and objects
  array,
  object,
  prop,
  shorthand,
  computedProp,
  spread,
  emptyArray,
  emptyObject,
  tupleArray,
  // Operators
  binary,
  conditional,
  // Raw
  raw,
  // Runtime references
  runtimeRef,
  reactiveGetter,
  // Advanced builders
  methodBinding,
  iife,
  formattedArray,
  elementHelperWrapper,
  // Statements
  varDecl,
  constDecl,
  ret,
  exprStmt,
  // Utility
  expr,
} from './builders';

// Re-export serializer
export { serializeJS } from './serialize';
export type { SerializeOptions } from './serialize';

// Namespace export for convenient access
import * as builders from './builders';
export { builders as B };
