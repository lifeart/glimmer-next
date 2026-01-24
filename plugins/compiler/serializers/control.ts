/**
 * Control Flow Serializer
 *
 * Serializes HBSControlExpression to JavaScript code for control flow constructs.
 * Uses the CodeBuilder pattern exclusively for clean, maintainable code generation.
 */

import type { CompilerContext } from '../context';
import { addWarning } from '../context';
import type { HBSControlExpression, HBSChild, HBSNode, SerializedValue } from '../types';
import { isHBSControlExpression, isHBSNode, isSerializedValue } from '../types';
import { SYMBOLS } from './symbols';
import { buildValue } from './value';
import { B, serializeJS, type JSExpression, type JSStatement } from '../builder';

// Forward declarations - set from index.ts to avoid circular dependency
let buildChildrenExprs: (ctx: CompilerContext, children: readonly HBSChild[], ctxName: string) => JSExpression[];
let nextCtxName: (ctx: CompilerContext) => string;

/**
 * Set dependencies from index.ts to break circular dependency.
 */
export function setControlDependencies(
  buildChildrenExprsFn: typeof buildChildrenExprs,
  nextCtxNameFn: typeof nextCtxName
): void {
  buildChildrenExprs = buildChildrenExprsFn;
  nextCtxName = nextCtxNameFn;
}

/**
 * Serialize a control flow expression to JavaScript.
 */
export function serializeControl(
  ctx: CompilerContext,
  control: HBSControlExpression,
  ctxName: string
): string {
  const node = buildControl(ctx, control, ctxName);
  const fmt = ctx.formatter.options;
  return serializeJS(node, {
    format: fmt.enabled,
    indent: fmt.indent,
    baseIndent: fmt.baseIndent,
    emitPure: fmt.emitPure,
  });
}

/**
 * Build a control flow expression as JSExpression.
 */
export function buildControl(
  ctx: CompilerContext,
  control: HBSControlExpression,
  ctxName: string
): JSExpression {
  switch (control.type) {
    case 'yield':
      return buildYield(ctx, control, ctxName);

    case 'in-element':
      return buildInElement(ctx, control, ctxName);

    case 'each':
      return buildEach(ctx, control, ctxName);

    case 'if':
      return buildIf(ctx, control, ctxName);

    default:
      return B.nil();
  }
}

// ============================================================================
// Yield
// ============================================================================

/**
 * Build a yield expression (slot invocation).
 *
 * Generates: $_slot("slotName", () => [params], $slots, ctx)
 */
function buildYield(
  _ctx: CompilerContext,
  control: HBSControlExpression,
  ctxName: string
): JSExpression {
  const slotName = control.key || 'default';

  // Build the params getter: () => [param1, param2, ...]
  const paramIdentifiers = control.blockParams.map(p => B.id(p));
  const paramsGetter = B.arrow([], B.array(paramIdentifiers));

  // $_slot("name", paramsGetter, $slots, ctx)
  // Note: Using runtimeRef instead of $: prefix for cleaner code
  return B.call(
    B.runtimeRef(SYMBOLS.SLOT),
    [
      B.string(slotName),
      paramsGetter,
      B.id('$slots'),
      B.id(ctxName),
    ],
    control.sourceRange,
    false,
    'MustacheStatement'
  );
}

// ============================================================================
// In-Element
// ============================================================================

/**
 * Build an in-element block.
 *
 * Generates: $_inElement(target, (ctx) => [children], ctx)
 */
function buildInElement(
  ctx: CompilerContext,
  control: HBSControlExpression,
  ctxName: string
): JSExpression {
  const newCtxName = nextCtxName(ctx);

  // Build target expression
  const targetExpr = buildValue(ctx, control.condition, ctxName);

  // Build children as JSExpressions (proper tree for correct indentation)
  const childExprs = buildChildrenExprs(ctx, control.children, newCtxName);
  const childArrayExpr = ctx.formatter.options.enabled && childExprs.length > 0
    ? B.formattedArray(childExprs, true)
    : B.array(childExprs);
  const childrenCallback = B.arrow(
    [newCtxName],
    childArrayExpr
  );

  // $_inElement(target, callback, ctx)
  // Note: Using runtimeRef instead of $: prefix for cleaner code
  return B.call(
    B.runtimeRef(SYMBOLS.IN_ELEMENT),
    [
      targetExpr,
      childrenCallback,
      B.id(ctxName),
    ],
    control.sourceRange,
    false,
    'BlockStatement'
  );
}

// ============================================================================
// Each
// ============================================================================

/**
 * Build an each block with proper index handling.
 *
 * Generates: $_each(items, (item, index, ctx) => children, key, ctx)
 */
function buildEach(
  ctx: CompilerContext,
  control: HBSControlExpression,
  ctxName: string
): JSExpression {
  const newCtxName = nextCtxName(ctx);

  // Build condition (iterable) expression
  const conditionExpr = buildValue(ctx, control.condition, ctxName);

  // Ensure we have proper block params
  const paramNames = normalizeEachParams(control.blockParams);
  const paramRanges = control.blockParamRanges ?? [];
  const indexParamName = paramNames[1];

  // Validate and normalize key
  const eachKey = normalizeEachKey(ctx, control);

  // Choose sync or async each
  const fnName = control.isSync ? SYMBOLS.EACH_SYNC : SYMBOLS.EACH;

  // Check for stable children
  const hasStable = hasStableChildsForControlNode(control.children);

  // Build the callback body with index replacement
  const bodyExpr = buildEachBody(ctx, control.children, newCtxName, indexParamName, hasStable);

  // Build the full callback: (item, index, ctx) => body
  const callbackParams = [
    ...paramNames.map((name, index) => {
      const range = paramRanges[index];
      return range ? B.id(name, range) : name;
    }),
    newCtxName,
  ];
  const callback = B.arrow(callbackParams, bodyExpr);

  // Build key argument
  const keyArg = eachKey !== null ? B.string(eachKey) : B.nil();

  // $_each(condition, callback, key, ctx)
  // Use formatted call when formatting is enabled for better readability
  return B.call(
    B.id(fnName),
    [
      conditionExpr,
      callback,
      keyArg,
      B.id(ctxName),
    ],
    control.sourceRange,
    ctx.formatter.options.enabled,
    'BlockStatement'
  );
}

/**
 * Normalize each block params to ensure item and index are present.
 */
function normalizeEachParams(blockParams: readonly string[]): string[] {
  const params = [...blockParams];

  if (params.length === 0) {
    params.push('$noop');
  }
  if (params.length === 1) {
    params.push('$index');
  }

  return params;
}

/**
 * Validate and normalize the each key.
 */
function normalizeEachKey(
  ctx: CompilerContext,
  control: HBSControlExpression
): string | null {
  let key = control.key;

  if (key === '@index') {
    addWarning(
      ctx,
      '@index identity is not supported, falling back to @identity',
      'W003',
      control.sourceRange
    );
    key = '@identity';
  }

  return key;
}

/**
 * Build the each callback body with proper index handling.
 */
function buildEachBody(
  ctx: CompilerContext,
  children: readonly HBSChild[],
  ctxName: string,
  indexParam: string,
  hasStable: boolean
): JSExpression {
  const usesIndex = childrenUseIndex(children, indexParam);

  const childCtxName = hasStable ? ctxName : nextCtxName(ctx);
  const childExprs = buildChildrenExprs(ctx, children, childCtxName);
  const rewrittenExprs = usesIndex
    ? childExprs.map((expr) => replaceIndexRefsInExpr(expr, indexParam))
    : childExprs;

  const childArrayExpr = ctx.formatter.options.enabled && rewrittenExprs.length > 0
    ? B.formattedArray(rewrittenExprs, true)
    : B.array(rewrittenExprs);

  if (!hasStable) {
    return B.call(
      B.id(SYMBOLS.UCW),
      [
        B.arrow([childCtxName], childArrayExpr),
        B.id(ctxName),
      ]
    );
  }

  if (rewrittenExprs.length === 1) {
    return rewrittenExprs[0] ?? B.array([]);
  }

  return childArrayExpr;
}

function childrenUseIndex(children: readonly HBSChild[], indexParam: string): boolean {
  return children.some((child) => childUsesIndex(child, indexParam));
}

function childUsesIndex(child: HBSChild, indexParam: string): boolean {
  if (child === null || typeof child === 'string') {
    return false;
  }

  if (isSerializedValue(child)) {
    return valueUsesIndex(child, indexParam);
  }

  if (isHBSControlExpression(child)) {
    if (valueUsesIndex(child.condition, indexParam)) return true;
    if (child.inverse && childrenUseIndex(child.inverse, indexParam)) return true;
    return childrenUseIndex(child.children, indexParam);
  }

  if (isHBSNode(child)) {
    if (nodeUsesIndex(child, indexParam)) return true;
  }

  return false;
}

function nodeUsesIndex(node: HBSNode, indexParam: string): boolean {
  for (const [, value] of node.attributes) {
    if (valueUsesIndex(value, indexParam)) return true;
  }
  for (const [, value] of node.properties) {
    if (valueUsesIndex(value, indexParam)) return true;
  }
  for (const [, handler] of node.events) {
    if (valueUsesIndex(handler, indexParam)) return true;
  }
  for (const child of node.children) {
    if (childUsesIndex(child, indexParam)) return true;
  }
  return false;
}

function valueUsesIndex(value: SerializedValue, indexParam: string): boolean {
  switch (value.kind) {
    case 'path':
      return value.expression === indexParam;

    case 'helper':
      for (const arg of value.positional) {
        if (valueUsesIndex(arg, indexParam)) return true;
      }
      for (const arg of value.named.values()) {
        if (valueUsesIndex(arg, indexParam)) return true;
      }
      return false;

    case 'getter':
      return valueUsesIndex(value.value, indexParam);

    case 'concat':
      return value.parts.some((part) => valueUsesIndex(part, indexParam));

    case 'literal':
    case 'raw':
    case 'spread':
      return false;
  }
}

/**
 * Replace index parameter references with .value accessor.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceIndexSymbol(symbol: string, indexParam: string): string {
  const pattern = new RegExp(`^${escapeRegExp(indexParam)}(?=(\\.|\\?|\\[|$))`);
  if (!pattern.test(symbol)) return symbol;
  return symbol.replace(pattern, `${indexParam}.value`);
}

function replaceIndexRefsInExpr(expr: JSExpression, indexParam: string): JSExpression {
  switch (expr.type) {
    case 'runtimeRef': {
      const updated = replaceIndexSymbol(expr.symbol, indexParam);
      return updated === expr.symbol ? expr : { ...expr, symbol: updated };
    }
    case 'identifier': {
      if (expr.name !== indexParam) return expr;
      return B.runtimeRef(`${indexParam}.value`, expr.sourceRange);
    }
    case 'member': {
      const nextObject = replaceIndexRefsInExpr(expr.object, indexParam);
      const nextProp = expr.computed
        ? replaceIndexRefsInExpr(expr.property as JSExpression, indexParam)
        : expr.property;
      if (nextObject === expr.object && nextProp === expr.property) return expr;
      return { ...expr, object: nextObject, property: nextProp };
    }
    case 'call': {
      const nextCallee = replaceIndexRefsInExpr(expr.callee, indexParam);
      const nextArgs = expr.arguments.map(arg => replaceIndexRefsInExpr(arg, indexParam));
      return nextCallee === expr.callee && nextArgs.every((arg, i) => arg === expr.arguments[i])
        ? expr
        : { ...expr, callee: nextCallee, arguments: nextArgs };
    }
    case 'methodCall': {
      const nextObject = replaceIndexRefsInExpr(expr.object, indexParam);
      const nextArgs = expr.arguments.map(arg => replaceIndexRefsInExpr(arg, indexParam));
      return nextObject === expr.object && nextArgs.every((arg, i) => arg === expr.arguments[i])
        ? expr
        : { ...expr, object: nextObject, arguments: nextArgs };
    }
    case 'arrow': {
      if (expr.expression) {
        const nextBody = replaceIndexRefsInExpr(expr.body as JSExpression, indexParam);
        return nextBody === expr.body ? expr : { ...expr, body: nextBody };
      }
      const nextBody = (expr.body as JSStatement[]).map(stmt => replaceIndexRefsInStmt(stmt, indexParam));
      return nextBody.every((stmt, i) => stmt === (expr.body as JSStatement[])[i])
        ? expr
        : { ...expr, body: nextBody };
    }
    case 'function': {
      const nextBody = expr.body.map(stmt => replaceIndexRefsInStmt(stmt, indexParam));
      return nextBody.every((stmt, i) => stmt === expr.body[i]) ? expr : { ...expr, body: nextBody };
    }
    case 'array': {
      const nextElements = expr.elements.map(el => replaceIndexRefsInExpr(el, indexParam));
      return nextElements.every((el, i) => el === expr.elements[i]) ? expr : { ...expr, elements: nextElements };
    }
    case 'object': {
      const nextProps = expr.properties.map(prop => {
        const nextVal = replaceIndexRefsInExpr(prop.value, indexParam);
        return nextVal === prop.value ? prop : { ...prop, value: nextVal };
      });
      return nextProps.every((prop, i) => prop === expr.properties[i]) ? expr : { ...expr, properties: nextProps };
    }
    case 'spread': {
      const nextArg = replaceIndexRefsInExpr(expr.argument, indexParam);
      return nextArg === expr.argument ? expr : { ...expr, argument: nextArg };
    }
    case 'binary': {
      const nextLeft = replaceIndexRefsInExpr(expr.left, indexParam);
      const nextRight = replaceIndexRefsInExpr(expr.right, indexParam);
      return nextLeft === expr.left && nextRight === expr.right ? expr : { ...expr, left: nextLeft, right: nextRight };
    }
    case 'conditional': {
      const nextTest = replaceIndexRefsInExpr(expr.test, indexParam);
      const nextCons = replaceIndexRefsInExpr(expr.consequent, indexParam);
      const nextAlt = replaceIndexRefsInExpr(expr.alternate, indexParam);
      return nextTest === expr.test && nextCons === expr.consequent && nextAlt === expr.alternate
        ? expr
        : { ...expr, test: nextTest, consequent: nextCons, alternate: nextAlt };
    }
    case 'template': {
      const nextExprs = expr.expressions.map(e => replaceIndexRefsInExpr(e, indexParam));
      return nextExprs.every((e, i) => e === expr.expressions[i]) ? expr : { ...expr, expressions: nextExprs };
    }
    case 'reactiveGetter': {
      const nextExpr = replaceIndexRefsInExpr(expr.expression, indexParam);
      return nextExpr === expr.expression ? expr : { ...expr, expression: nextExpr };
    }
    case 'methodBinding': {
      const nextFn = replaceIndexRefsInExpr(expr.fn, indexParam);
      const nextThis = replaceIndexRefsInExpr(expr.thisArg, indexParam);
      const nextArgs = expr.boundArgs.map(arg => replaceIndexRefsInExpr(arg, indexParam));
      return nextFn === expr.fn && nextThis === expr.thisArg && nextArgs.every((arg, i) => arg === expr.boundArgs[i])
        ? expr
        : { ...expr, fn: nextFn, thisArg: nextThis, boundArgs: nextArgs };
    }
    case 'iife': {
      const nextBody = expr.body.map(stmt => replaceIndexRefsInStmt(stmt, indexParam));
      const nextArgs = expr.args.map(arg => replaceIndexRefsInExpr(arg, indexParam));
      return nextBody.every((stmt, i) => stmt === expr.body[i]) && nextArgs.every((arg, i) => arg === expr.args[i])
        ? expr
        : { ...expr, body: nextBody, args: nextArgs };
    }
    case 'formattedArray': {
      const nextElements = expr.elements.map(el => replaceIndexRefsInExpr(el, indexParam));
      return nextElements.every((el, i) => el === expr.elements[i]) ? expr : { ...expr, elements: nextElements };
    }
    case 'raw':
      return expr;
    default:
      return expr;
  }
}

function replaceIndexRefsInStmt(stmt: JSStatement, indexParam: string): JSStatement {
  switch (stmt.type) {
    case 'varDecl': {
      if (!stmt.init) return stmt;
      const nextInit = replaceIndexRefsInExpr(stmt.init, indexParam);
      return nextInit === stmt.init ? stmt : { ...stmt, init: nextInit };
    }
    case 'return': {
      if (!stmt.argument) return stmt;
      const nextArg = replaceIndexRefsInExpr(stmt.argument, indexParam);
      return nextArg === stmt.argument ? stmt : { ...stmt, argument: nextArg };
    }
    case 'exprStmt': {
      const nextExpr = replaceIndexRefsInExpr(stmt.expression, indexParam);
      return nextExpr === stmt.expression ? stmt : { ...stmt, expression: nextExpr };
    }
    default:
      return stmt;
  }
}

// ============================================================================
// If
// ============================================================================

/**
 * Build an if block.
 *
 * Generates: $_if(condition, trueBranch, falseBranch, ctx)
 */
function buildIf(
  ctx: CompilerContext,
  control: HBSControlExpression,
  ctxName: string
): JSExpression {
  const newCtxName = nextCtxName(ctx);

  // Build condition expression
  const conditionExpr = buildValue(ctx, control.condition, ctxName);

  // Build branches
  const trueBranch = buildIfBranch(ctx, control.children, newCtxName, ctxName);
  const falseBranch = buildIfBranch(ctx, control.inverse, newCtxName, ctxName);

  // $_if(condition, trueBranch, falseBranch, ctx)
  // Use formatted call when formatting is enabled for better readability
  return B.call(
    B.id(SYMBOLS.IF),
    [
      conditionExpr,
      trueBranch,
      falseBranch,
      B.id(ctxName),
    ],
    control.sourceRange,
    ctx.formatter.options.enabled,
    'BlockStatement'
  );
}

/**
 * Build an if branch callback.
 *
 * Generates: (branchCtx) => $_ucw((extraCtx) => [children], branchCtx)
 *        or: (branchCtx) => []
 */
function buildIfBranch(
  ctx: CompilerContext,
  children: readonly HBSChild[] | null,
  branchCtxName: string,
  _parentCtxName: string
): JSExpression {
  // Empty branch - use branchCtxName for the arrow parameter (never 'this')
  if (!children || children.length === 0) {
    return B.arrow([branchCtxName], B.array([]));
  }

  const extraCtx = nextCtxName(ctx);

  // Build children as JSExpressions (proper tree for correct indentation)
  const childExprs = buildChildrenExprs(ctx, children, extraCtx);
  const childArrayExpr = ctx.formatter.options.enabled && childExprs.length > 0
    ? B.formattedArray(childExprs, true)
    : B.array(childExprs);

  // Wrap in UCW for reactivity safety
  // TODO: Detect truly stable children and avoid wrapping
  const ucwCall = B.call(
    B.id(SYMBOLS.UCW),
    [
      B.arrow([extraCtx], childArrayExpr),
      B.id(branchCtxName),
    ]
  );

  return B.arrow([branchCtxName], ucwCall);
}

// ============================================================================
// Stability Detection
// ============================================================================

/**
 * Check if children are stable for control nodes.
 *
 * Returns true only if there's exactly ONE child that is either:
 * - A component (resolved binding with hasStableChild marker), OR
 * - An element with no events and no children
 *
 * This determines when the UCW (Unstable Child Wrapper) can be omitted.
 */
function hasStableChildsForControlNode(
  children: readonly HBSChild[] | null
): boolean {
  if (!children) return true;

  // Filter out null values
  const realChildren = children.filter((el): el is NonNullable<HBSChild> => el !== null);

  // Only consider stable if exactly one child
  if (realChildren.length !== 1) {
    return false;
  }

  const child = realChildren[0];

  // Text nodes are not stable (need UCW)
  if (typeof child === 'string') {
    return false;
  }

  // SerializedValue nodes are not stable
  if ('kind' in child) {
    return false;
  }

  // Control expressions are not stable
  if ('_nodeType' in child && child._nodeType === 'control') {
    return false;
  }

  // Check if it's an HBSNode (element/component)
  if ('_nodeType' in child && child._nodeType === 'element' && child.tag) {
    // If it has hasStableChild marker from element visitor, trust it
    if (child.hasStableChild) {
      return true;
    }
    // Elements with no events and no children are stable
    if (child.events.length === 0 && child.children.length === 0) {
      return true;
    }
  }

  return false;
}
