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

    case 'let':
      return buildLet(ctx, control, ctxName);

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

  // Validate and normalize key
  const eachKey = normalizeEachKey(ctx, control);

  // Choose sync or async each.
  // PR https://github.com/lifeart/glimmer-next/pull/212: previously this
  // also force-routed every {{#each}} in IS_GLIMMER_COMPAT_MODE through
  // `$_eachSync`. That broke async element destructors for the row's own
  // subtree because `SyncListComponent.destroyItem` invokes
  // `destroyElementSync(row, false, this.api)` synchronously — the modifier
  // destructor's Promise is dropped on the floor and the DOM is removed
  // before the animation/teardown finishes. Regression triple:
  //   - Integration | InternalComponent | each >>
  //       it runs async element destructors for Components with context
  //   - Integration | InternalComponent | each >>
  //       it runs async element destructors for unstable nodes
  //   - Integration | InternalComponent | each >>
  //       it wait for async element destructors before destroying
  // Async iteration is the correct default; opt-in `sync=true` on the
  // block (e.g. `{{#each items sync=true as |item|}}`) keeps the
  // synchronous-teardown variant available for hosts that need it.
  const fnName = control.isSync ? SYMBOLS.EACH_SYNC : SYMBOLS.EACH;

  // Check for stable children
  const hasStable = hasStableChildsForControlNode(control.children);

  // Build the callback body with index replacement
  // Pass all param names so they can be tracked as known bindings during serialization
  const bodyExpr = buildEachBody(ctx, control.children, newCtxName, paramNames, hasStable);

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

  // Build inverse (else) branch if present
  // In compat mode, always use `this` as the component context (4th arg)
  // for the same reason as $_if — nested blocks have UcW contexts that
  // are NOT the component instance.
  const eachComponentCtx = ctx.flags.IS_GLIMMER_COMPAT_MODE ? 'this' : ctxName;
  const eachArgs: JSExpression[] = [conditionExpr, callback, keyArg, B.id(eachComponentCtx)];

  if (control.inverse && control.inverse.length > 0) {
    const inverseCtxName = nextCtxName(ctx);
    const inverseBranch = buildIfBranch(ctx, control.inverse, inverseCtxName, ctxName);
    eachArgs.push(inverseBranch);
  }

  // $_each(condition, callback, key, ctx[, inverseFn])
  return B.call(
    B.id(fnName),
    eachArgs,
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
  paramNames: string[],
  hasStable: boolean
): JSExpression {
  const indexParam = paramNames[1] ?? '$index';
  const usesIndex = childrenUseIndex(children, indexParam);

  // Add block params in a dedicated scope frame so nested each/if blocks with
  // matching block-param names shadow rather than clobber outer bindings.
  ctx.scopeTracker.enterScope('control-block');
  for (const param of paramNames) {
    ctx.scopeTracker.addBinding(param, { kind: 'block-param', name: param });
  }

  const childCtxName = hasStable ? ctxName : nextCtxName(ctx);
  const childExprs = buildChildrenExprs(ctx, children, childCtxName);

  // Exit scope, restoring outer bindings.
  ctx.scopeTracker.exitScope();

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
  let conditionExpr = buildValue(ctx, control.condition, ctxName);

  // In compat mode, when the condition is a simple this.PROP path,
  // wrap with __gxtGetCellOrFormula for cross-module-instance notification.
  // This tags the condition getter so the patched $_if can register manual watchers.
  // Uses optional call ?.() to gracefully degrade when the function is not defined.
  // IMPORTANT: Always use `this` (not ctxName) for this.X paths because `this`
  // refers to the component instance, while ctxName may refer to a nested
  // block context (e.g., inside {{#each}}) that doesn't have the property.
  if (ctx.flags.IS_GLIMMER_COMPAT_MODE && ctx.flags.WITH_EMBER_INTEGRATION && control.condition.kind === 'path') {
    const expr = control.condition.expression;
    const thisMatch = expr.match(/^this\.([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
    if (thisMatch) {
      const propName = thisMatch[1];
      // Emit a `typeof === 'function'` guard rather than `??` so a buggy
      // host hook that returns a falsy-but-defined value (`0`, `""`, etc.)
      // still falls through to the plain getter instead of being passed
      // straight to `$_if` as the condition.
      conditionExpr = B.raw(
        `((__r) => typeof __r === 'function' ? __r : (() => this.${propName}))(globalThis.__gxtGetCellOrFormula?.(this, "${propName}"))`,
        control.condition.sourceRange
      );
    }
  }

  // Build branches
  const trueBranch = buildIfBranch(ctx, control.children, newCtxName, ctxName);
  const falseBranch = buildIfBranch(ctx, control.inverse, newCtxName, ctxName);

  // $_if(condition, trueBranch, falseBranch, ctx)
  // In compat mode, always use `this` as the component context (4th arg)
  // because templates are rendered as functions where `this` is the component.
  // Inside nested blocks (e.g., {{#each}}), ctxName is the UcW context which
  // is NOT the component — using it would break initDOM() in GXT.
  const componentCtx = ctx.flags.IS_GLIMMER_COMPAT_MODE ? 'this' : ctxName;
  // Use formatted call when formatting is enabled for better readability
  return B.call(
    B.id(SYMBOLS.IF),
    [
      conditionExpr,
      trueBranch,
      falseBranch,
      B.id(componentCtx),
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
// Let
// ============================================================================

/**
 * Build a let block as a spread IIFE.
 *
 * Generates:
 *   ...(() => {
 *     let foo = () => expr;    // non-primitive: getter for reactivity
 *     let bar = "literal";     // primitive: direct value
 *     return [children];
 *   })()
 *
 * Arrow functions inherit `this` from the enclosing scope, so
 * `this.xxx` references in both declarations and children work correctly.
 * JavaScript `let` scoping inside the IIFE handles shadowing of nested
 * let blocks with the same variable names.
 *
 * For non-primitive getters, the child expression tree is walked to replace
 * identifier references with call expressions (e.g., `foo` -> `foo()`),
 * similar to how `replaceIndexRefsInExpr` works for each-block indices.
 */
function buildLet(
  ctx: CompilerContext,
  control: HBSControlExpression,
  ctxName: string
): JSExpression {
  const bindings = control.letBindings ?? [];

  // Collect non-primitive binding names (these are getters that need calling)
  const getterNames = new Set<string>();
  for (const binding of bindings) {
    if (!binding.isPrimitive) {
      getterNames.add(binding.name);
    }
  }

  // Build variable declarations
  const varDecls: JSStatement[] = bindings.map((binding) => {
    const valueExpr = buildValue(ctx, binding.value, ctxName);
    if (binding.isPrimitive) {
      return B.varDecl('let', binding.name, valueExpr);
    } else {
      // If buildValue already produced a reactive getter (arrow function),
      // use it directly — don't double-wrap with another arrow.
      const isAlreadyGetter = valueExpr.type === 'reactiveGetter' || valueExpr.type === 'arrow';
      const getterExpr = isAlreadyGetter ? valueExpr : B.arrow([], valueExpr);
      return B.varDecl('let', binding.name, getterExpr);
    }
  });

  // Add let bindings in a fresh scope frame so nested `{{#let}}` blocks
  // shadow rather than clobber the outer binding.
  ctx.scopeTracker.enterScope('let');
  for (const binding of bindings) {
    ctx.scopeTracker.addBinding(binding.name, { kind: 'let-binding', name: binding.name });
  }

  // Build children as JSExpressions
  const childExprs = buildChildrenExprs(ctx, control.children, ctxName);

  // Exit let scope, restoring outer bindings.
  ctx.scopeTracker.exitScope();

  // For non-primitive getters, replace identifier references with calls
  const rewrittenExprs = getterNames.size > 0
    ? childExprs.map((expr) => replaceLetGetterRefsInExpr(expr, getterNames))
    : childExprs;

  // Build return array
  const childArrayExpr = ctx.formatter.options.enabled && rewrittenExprs.length > 0
    ? B.formattedArray(rewrittenExprs, true)
    : B.array(rewrittenExprs);

  // Build arrow-function IIFE: ...(() => { declarations; return [children]; })()
  // Arrow function preserves this from the enclosing scope.
  const body: JSStatement[] = [
    ...varDecls,
    B.ret(childArrayExpr),
  ];

  const arrowFn = B.arrowBlock([], body, control.sourceRange);
  return B.spread(B.call(arrowFn, [], control.sourceRange));
}

/**
 * Replace identifier references to let-binding getters with call expressions.
 * For a getter foo, transforms foo -> foo() and () => foo -> () => foo().
 */
function replaceLetGetterRefsInExpr(expr: JSExpression, getterNames: Set<string>): JSExpression {
  switch (expr.type) {
    case 'identifier': {
      if (getterNames.has(expr.name)) {
        return B.call(expr, [], expr.sourceRange);
      }
      return expr;
    }
    case 'runtimeRef': {
      const rootName = expr.symbol.split(/[?.\[]/)[0];
      if (rootName && getterNames.has(rootName)) {
        const rest = expr.symbol.slice(rootName.length);
        if (rest) {
          return B.raw(`${rootName}()${rest}`, expr.sourceRange);
        }
        return B.call(B.id(rootName, expr.sourceRange), [], expr.sourceRange);
      }
      return expr;
    }
    case 'member': {
      const nextObject = replaceLetGetterRefsInExpr(expr.object, getterNames);
      const nextProp = expr.computed
        ? replaceLetGetterRefsInExpr(expr.property as JSExpression, getterNames)
        : expr.property;
      if (nextObject === expr.object && nextProp === expr.property) return expr;
      return { ...expr, object: nextObject, property: nextProp };
    }
    case 'call': {
      const nextCallee = replaceLetGetterRefsInExpr(expr.callee, getterNames);
      const nextArgs = expr.arguments.map(arg => replaceLetGetterRefsInExpr(arg, getterNames));
      return nextCallee === expr.callee && nextArgs.every((arg, i) => arg === expr.arguments[i])
        ? expr
        : { ...expr, callee: nextCallee, arguments: nextArgs };
    }
    case 'methodCall': {
      const nextObject = replaceLetGetterRefsInExpr(expr.object, getterNames);
      const nextArgs = expr.arguments.map(arg => replaceLetGetterRefsInExpr(arg, getterNames));
      return nextObject === expr.object && nextArgs.every((arg, i) => arg === expr.arguments[i])
        ? expr
        : { ...expr, object: nextObject, arguments: nextArgs };
    }
    case 'arrow': {
      if (expr.expression) {
        const nextBody = replaceLetGetterRefsInExpr(expr.body as JSExpression, getterNames);
        return nextBody === expr.body ? expr : { ...expr, body: nextBody };
      }
      // For block-body arrows, check if any varDecl shadows getter names
      const arrowScopedNames = reduceShadowedNames(getterNames, expr.body as JSStatement[]);
      if (arrowScopedNames.size === 0) return expr;
      const nextBody = (expr.body as JSStatement[]).map(stmt => replaceLetGetterRefsInStmt(stmt, arrowScopedNames));
      return nextBody.every((stmt, i) => stmt === (expr.body as JSStatement[])[i])
        ? expr
        : { ...expr, body: nextBody };
    }
    case 'function': {
      const funcScopedNames = reduceShadowedNames(getterNames, expr.body);
      if (funcScopedNames.size === 0) return expr;
      const nextBody = expr.body.map(stmt => replaceLetGetterRefsInStmt(stmt, funcScopedNames));
      return nextBody.every((stmt, i) => stmt === expr.body[i]) ? expr : { ...expr, body: nextBody };
    }
    case 'array': {
      const nextElements = expr.elements.map(el => replaceLetGetterRefsInExpr(el, getterNames));
      return nextElements.every((el, i) => el === expr.elements[i]) ? expr : { ...expr, elements: nextElements };
    }
    case 'formattedArray': {
      const nextElements = expr.elements.map(el => replaceLetGetterRefsInExpr(el, getterNames));
      return nextElements.every((el, i) => el === expr.elements[i]) ? expr : { ...expr, elements: nextElements };
    }
    case 'object': {
      const nextProps = expr.properties.map(prop => {
        const nextVal = replaceLetGetterRefsInExpr(prop.value, getterNames);
        return nextVal === prop.value ? prop : { ...prop, value: nextVal };
      });
      return nextProps.every((prop, i) => prop === expr.properties[i]) ? expr : { ...expr, properties: nextProps };
    }
    case 'spread': {
      const nextArg = replaceLetGetterRefsInExpr(expr.argument, getterNames);
      return nextArg === expr.argument ? expr : { ...expr, argument: nextArg };
    }
    case 'binary': {
      const nextLeft = replaceLetGetterRefsInExpr(expr.left, getterNames);
      const nextRight = replaceLetGetterRefsInExpr(expr.right, getterNames);
      return nextLeft === expr.left && nextRight === expr.right ? expr : { ...expr, left: nextLeft, right: nextRight };
    }
    case 'conditional': {
      const nextTest = replaceLetGetterRefsInExpr(expr.test, getterNames);
      const nextCons = replaceLetGetterRefsInExpr(expr.consequent, getterNames);
      const nextAlt = replaceLetGetterRefsInExpr(expr.alternate, getterNames);
      return nextTest === expr.test && nextCons === expr.consequent && nextAlt === expr.alternate
        ? expr
        : { ...expr, test: nextTest, consequent: nextCons, alternate: nextAlt };
    }
    case 'template': {
      const nextExprs = expr.expressions.map(e => replaceLetGetterRefsInExpr(e, getterNames));
      return nextExprs.every((e, i) => e === expr.expressions[i]) ? expr : { ...expr, expressions: nextExprs };
    }
    case 'reactiveGetter': {
      const nextExpr = replaceLetGetterRefsInExpr(expr.expression, getterNames);
      return nextExpr === expr.expression ? expr : { ...expr, expression: nextExpr };
    }
    case 'methodBinding': {
      const nextFn = replaceLetGetterRefsInExpr(expr.fn, getterNames);
      const nextThis = replaceLetGetterRefsInExpr(expr.thisArg, getterNames);
      const nextArgs = expr.boundArgs.map(arg => replaceLetGetterRefsInExpr(arg, getterNames));
      return nextFn === expr.fn && nextThis === expr.thisArg && nextArgs.every((arg, i) => arg === expr.boundArgs[i])
        ? expr
        : { ...expr, fn: nextFn, thisArg: nextThis, boundArgs: nextArgs };
    }
    case 'iife': {
      // Check if any varDecl in the IIFE body shadows getter names
      const iifeScopedNames = reduceShadowedNames(getterNames, expr.body);
      const nextBody = iifeScopedNames.size > 0
        ? expr.body.map(stmt => replaceLetGetterRefsInStmt(stmt, iifeScopedNames))
        : expr.body;
      const nextArgs = expr.args.map(arg => replaceLetGetterRefsInExpr(arg, getterNames));
      return nextBody.every((stmt, i) => stmt === expr.body[i]) && nextArgs.every((arg, i) => arg === expr.args[i])
        ? expr
        : { ...expr, body: nextBody, args: nextArgs };
    }
    case 'raw':
      return expr;
    default:
      return expr;
  }
}

/**
 * Given a set of getter names and a list of statements, return a new set
 * with any names that are re-declared (shadowed) by varDecl statements removed.
 * This prevents the getter-call rewrite from modifying references to
 * inner-scoped variables that shadow outer let bindings.
 */
function reduceShadowedNames(getterNames: Set<string>, stmts: readonly JSStatement[]): Set<string> {
  const shadowed = new Set<string>();
  for (const stmt of stmts) {
    if (stmt.type === 'varDecl' && getterNames.has(stmt.name)) {
      shadowed.add(stmt.name);
    }
  }
  if (shadowed.size === 0) return getterNames;
  const reduced = new Set(getterNames);
  for (const name of shadowed) {
    reduced.delete(name);
  }
  return reduced;
}

function replaceLetGetterRefsInStmt(stmt: JSStatement, getterNames: Set<string>): JSStatement {
  switch (stmt.type) {
    case 'varDecl': {
      if (!stmt.init) return stmt;
      const nextInit = replaceLetGetterRefsInExpr(stmt.init, getterNames);
      return nextInit === stmt.init ? stmt : { ...stmt, init: nextInit };
    }
    case 'return': {
      if (!stmt.argument) return stmt;
      const nextArg = replaceLetGetterRefsInExpr(stmt.argument, getterNames);
      return nextArg === stmt.argument ? stmt : { ...stmt, argument: nextArg };
    }
    case 'exprStmt': {
      const nextExpr = replaceLetGetterRefsInExpr(stmt.expression, getterNames);
      return nextExpr === stmt.expression ? stmt : { ...stmt, expression: nextExpr };
    }
    default:
      return stmt;
  }
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
