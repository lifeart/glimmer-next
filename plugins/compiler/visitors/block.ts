/**
 * Block Statement Visitor
 *
 * Handles block statements like {{#if}}, {{#each}}, {{#let}}.
 */

import type { ASTv1 } from '@glimmer/syntax';
import type { CompilerContext, VisitFn } from '../context';
import type { SerializedValue, HBSControlExpression, HBSChild, SourceRange } from '../types';
import { literal, raw, isSerializedValue, isHBSNode, isHBSControlExpression } from '../types';
import { getNodeRange, serializeValueToString, getBlockParamRanges, getPathExpressionString } from './utils';
import { addWarning } from '../context';

// Forward declaration for full serialization (set from compile.ts to avoid circular dependency)
let serializeChildFn: ((ctx: CompilerContext, child: HBSChild, ctxName: string) => string | null) | null = null;

/**
 * Set the serialize function for let block children (called from compile.ts).
 */
export function setBlockSerializeFunction(
  fn: (ctx: CompilerContext, child: HBSChild, ctxName: string) => string | null
): void {
  serializeChildFn = fn;
}

/**
 * Get the visit function from context.
 * Requires ctx.visitors to be initialized via initializeVisitors().
 */
function getVisit(ctx: CompilerContext): VisitFn {
  if (ctx.visitors?.visit) {
    return ctx.visitors.visit;
  }
  throw new Error('No visit function available. Call initializeVisitors first.');
}

/**
 * Get the visitChildren function from context.
 * Requires ctx.visitors to be initialized via initializeVisitors().
 */
function getVisitChildren(ctx: CompilerContext): (ctx: CompilerContext, children: ASTv1.Statement[]) => HBSChild[] {
  if (ctx.visitors?.visitChildren) {
    return ctx.visitors.visitChildren;
  }
  throw new Error('No visitChildren function available. Call initializeVisitors first.');
}

/**
 * Get the serialize child function - from ctx.visitors or legacy serializeChildFn.
 */
function getSerializeChild(ctx: CompilerContext): ((ctx: CompilerContext, child: HBSChild, ctxName: string) => string | null) | null {
  if (ctx.visitors?.serializeChild) {
    return ctx.visitors.serializeChild;
  }
  return serializeChildFn;
}

/**
 * Visit a BlockStatement node.
 *
 * @param ctx - The compiler context
 * @param node - The BlockStatement to visit
 */
export function visitBlock(
  ctx: CompilerContext,
  node: ASTv1.BlockStatement
): HBSControlExpression | SerializedValue | null {
  const range = getNodeRange(node);

  // Blocks must have at least one param
  if (!node.params.length) {
    return null;
  }

  // Add block params to scope
  const blockParams = node.program.blockParams;
  const blockParamRanges = getBlockParamRanges(node);
  for (const param of blockParams) {
    warnOnReservedBinding(ctx, param);
    ctx.scopeTracker.addBinding(param, { kind: 'block-param', name: param });
  }

  // Get children
  const childElements = getVisitChildren(ctx)(ctx, node.program.body);

  // Get inverse (else) children
  const inverseElements = node.inverse?.body
    ? getVisitChildren(ctx)(ctx, node.inverse.body)
    : null;

  // Remove block params from scope
  for (const param of blockParams) {
    ctx.scopeTracker.removeBinding(param);
  }

  // Empty block - skip
  if (!childElements.length) {
    return null;
  }

  // Must have a path expression
  if (node.path.type !== 'PathExpression') {
    return null;
  }

  const name = getPathExpressionString(node.path);

  // Extract key and sync options
  const { keyValue, syncValue } = extractBlockOptions(ctx, node);

  // Handle specific block types
  switch (name) {
    case 'in-element':
      return createInElementBlock(ctx, node, childElements, range);

    case 'unless':
      return createUnlessBlock(
        ctx,
        node,
        childElements,
        inverseElements,
        blockParams,
        blockParamRanges,
        keyValue,
        syncValue,
        range
      );

    case 'let':
      return createLetBlock(ctx, node, childElements, range);

    case 'if':
    case 'each':
    default:
      return createControlBlock(
        ctx,
        node,
        name,
        childElements,
        inverseElements,
        blockParams,
        blockParamRanges,
        keyValue,
        syncValue,
        range
      );
  }
}

/**
 * Warn on reserved JavaScript/browser binding names.
 */
function warnOnReservedBinding(ctx: CompilerContext, name: string): void {
  const reserved = [
    'window',
    'document',
    'console',
    'this',
    'arguments',
    'eval',
    'undefined',
    'null',
    'true',
    'false',
  ];

  if (reserved.includes(name)) {
    addWarning(
      ctx,
      `"${name}" is a reserved name and may cause unexpected behavior`,
      'W002'
    );
  }
}

/**
 * Extract key and sync options from block hash.
 */
function extractBlockOptions(
  ctx: CompilerContext,
  node: ASTv1.BlockStatement
): { keyValue: string | null; syncValue: boolean } {
  let keyValue: string | null = null;
  let syncValue = false;

  const keyPair = node.hash.pairs.find((p) => p.key === 'key');
  const syncPair = node.hash.pairs.find((p) => p.key === 'sync');

  if (keyPair) {
    if (keyPair.value.type === 'StringLiteral') {
      keyValue = keyPair.value.original;
    } else {
      const result = getVisit(ctx)(ctx, keyPair.value, false);
      if (result !== null && isSerializedValue(result)) {
        keyValue = serializeValueToString(result);
      }
    }
  }

  if (syncPair) {
    if (syncPair.value.type === 'BooleanLiteral') {
      syncValue = syncPair.value.value;
    } else {
      const result = getVisit(ctx)(ctx, syncPair.value, false);
      if (result !== null && typeof result === 'boolean') {
        syncValue = result;
      }
    }
  }

  return { keyValue, syncValue };
}

/**
 * Create an in-element control block.
 */
function createInElementBlock(
  ctx: CompilerContext,
  node: ASTv1.BlockStatement,
  children: HBSChild[],
  range?: SourceRange
): HBSControlExpression {
  // Use wrap=true for conditions to enable reactivity
  const condition = getVisit(ctx)(ctx, node.params[0], true);

  return {
    _nodeType: 'control',
    type: 'in-element',
    condition: condition !== null && isSerializedValue(condition)
      ? condition
      : literal(null),
    blockParams: [],
    children,
    inverse: null,
    key: null,
    isSync: true,
    sourceRange: range,
  };
}

/**
 * Create an unless block (inverted if).
 */
function createUnlessBlock(
  ctx: CompilerContext,
  node: ASTv1.BlockStatement,
  children: HBSChild[],
  inverse: HBSChild[] | null,
  blockParams: string[],
  blockParamRanges: SourceRange[] | null,
  keyValue: string | null,
  syncValue: boolean,
  range?: SourceRange
): HBSControlExpression {
  // Use wrap=true for conditions to enable reactivity
  const condition = getVisit(ctx)(ctx, node.params[0], true);

  // unless flips children and inverse
  return {
    _nodeType: 'control',
    type: 'if',
    condition: condition !== null && isSerializedValue(condition)
      ? condition
      : literal(null),
    blockParams,
    blockParamRanges: blockParamRanges ?? undefined,
    children: inverse ?? [],  // Flipped (default to empty array if null)
    inverse: children,  // Flipped
    key: keyValue,
    isSync: syncValue,
    sourceRange: range,
  };
}

/**
 * Create a let block (variable binding).
 */
function createLetBlock(
  ctx: CompilerContext,
  node: ASTv1.BlockStatement,
  _children: HBSChild[],
  range?: SourceRange
): SerializedValue {
  const varScopeName = `scope${ctx.letBlockCounter++}`;
  const namesToReplace: Record<string, string> = {};
  const primitives = new Set<string>();

  // Generate variable declarations
  const vars = node.params.map((p, index) => {
    const originalName = node.program.blockParams[index];
    const newName = `Let_${originalName}_${varScopeName}`;
    namesToReplace[originalName] = newName;

    const isPrimitive =
      p.type === 'StringLiteral' ||
      p.type === 'BooleanLiteral' ||
      p.type === 'NumberLiteral' ||
      p.type === 'NullLiteral' ||
      p.type === 'UndefinedLiteral';

    const paramValue = getVisit(ctx)(ctx, p, false);
    const serialized =
      paramValue !== null && isSerializedValue(paramValue)
        ? serializeValueToString(paramValue)
        : 'null';

    if (isPrimitive) {
      primitives.add(originalName);
      return `let ${newName} = ${serialized};`;
    } else {
      return `let ${newName} = () => ${serialized};`;
    }
  });

  // Re-add block params for child serialization
  for (const param of node.program.blockParams) {
    ctx.scopeTracker.addBinding(param, { kind: 'let-binding', name: param });
  }

  // Serialize children
  const children = getVisitChildren(ctx)(ctx, node.program.body);
  const serializedChildren = serializeChildrenToString(ctx, children, primitives, namesToReplace);

  // Remove block params
  for (const param of node.program.blockParams) {
    ctx.scopeTracker.removeBinding(param);
  }

  // Generate the let block code
  // Replace 'this.' with 'self.' in variable declarations
  // Uses regex that avoids matching inside string literals
  const varsCode = replaceThisWithSelf(vars.join(''));
  const code = `...(() => {let self = this;${varsCode}return [${serializedChildren}]})()`;

  return raw(code, range);
}

/**
 * Replace 'this.' with 'self.' outside of string literals.
 * This is more robust than simple string.split().join() which would
 * incorrectly replace 'this.' inside quoted strings.
 */
function replaceThisWithSelf(code: string): string {
  // Match 'this.' that is:
  // - Not preceded by a word character (to avoid matching 'othis.')
  // - Not inside single or double quotes
  // This regex splits on quotes to process segments separately
  const segments: string[] = [];
  let current = '';
  let inString: string | null = null;

  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    const prevChar = i > 0 ? code[i - 1] : '';

    // Handle string delimiters (accounting for escapes)
    if ((char === '"' || char === "'") && prevChar !== '\\') {
      if (inString === null) {
        // Starting a string - process accumulated code first
        if (current) {
          segments.push(replaceThisInCode(current));
          current = '';
        }
        inString = char;
        current = char;
      } else if (inString === char) {
        // Ending a string - keep it as-is
        current += char;
        segments.push(current);
        current = '';
        inString = null;
      } else {
        // Different quote inside string - just accumulate
        current += char;
      }
    } else {
      current += char;
    }
  }

  // Process any remaining code
  if (current) {
    segments.push(inString ? current : replaceThisInCode(current));
  }

  return segments.join('');
}

/**
 * Replace 'this.' with 'self.' in non-string code.
 */
function replaceThisInCode(code: string): string {
  // Match 'this.' not preceded by a word character
  return code.replace(/(?<![a-zA-Z0-9_$])this\./g, 'self.');
}

/**
 * Serialize children for let block, applying variable replacements.
 */
function serializeChildrenToString(
  ctx: CompilerContext,
  children: HBSChild[],
  primitives: Set<string>,
  namesToReplace: Record<string, string>
): string {
  const parts: string[] = [];

  for (const child of children) {
    if (typeof child === 'string') {
      parts.push(JSON.stringify(child));
    } else if (isSerializedValue(child)) {
      let str = serializeValueToString(child);
      str = applyVariableReplacements(str, primitives, namesToReplace);
      parts.push(str);
    } else if ((isHBSNode(child) || isHBSControlExpression(child)) && getSerializeChild(ctx)) {
      // Use the full serialization for HBSNode/HBSControlExpression
      let str = getSerializeChild(ctx)!(ctx, child, 'this');
      if (str) {
        str = applyVariableReplacements(str, primitives, namesToReplace);
        parts.push(str);
      }
    } else {
      // Fallback - shouldn't normally happen
      parts.push('null');
    }
  }

  return parts.join(', ');
}

/**
 * Apply variable name replacements for let blocks.
 */
function applyVariableReplacements(
  str: string,
  primitives: Set<string>,
  namesToReplace: Record<string, string>
): string {
  for (const [key, newName] of Object.entries(namesToReplace)) {
    // Match variable names but not:
    // - preceded by . (property access like foo.name)
    // - followed by = or : (object keys/assignments)
    const re = new RegExp(`(?<!\\.)\\b${key}\\b(?!(=|'|"|:)[^ ]*)`, 'g');

    if (primitives.has(key)) {
      str = str.replace(re, newName);
    } else {
      str = str.replace(re, `${newName}()`);
    }
  }
  return str;
}

/**
 * Create a general control block (if, each, etc.).
 */
function createControlBlock(
  ctx: CompilerContext,
  node: ASTv1.BlockStatement,
  name: string,
  children: HBSChild[],
  inverse: HBSChild[] | null,
  blockParams: string[],
  blockParamRanges: SourceRange[] | null,
  keyValue: string | null,
  syncValue: boolean,
  range?: SourceRange
): HBSControlExpression {
  // Use wrap=true for conditions to enable reactivity
  const condition = getVisit(ctx)(ctx, node.params[0], true);

  return {
    _nodeType: 'control',
    type: name as 'if' | 'each',
    condition: condition !== null && isSerializedValue(condition)
      ? condition
      : literal(null),
    blockParams,
    blockParamRanges: blockParamRanges ?? undefined,
    children,
    inverse,
    key: keyValue,
    isSync: syncValue,
    sourceRange: range,
  };
}
