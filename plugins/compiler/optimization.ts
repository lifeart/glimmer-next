/**
 * Template-level optimizations.
 *
 * Currently implemented:
 * - Memoize repeated reactive path getters (this.* / @args) into a single tag.
 */

import type { CompilerContext } from './context';
import type { HBSChild, SerializedValue, PathValue, HelperValue } from './types';
import { isHBSControlExpression, isHBSNode, isSerializedValue } from './types';
import { INTERNAL_HELPERS, SYMBOLS, getBuiltInHelperSymbol } from './serializers/symbols';

export type MemoizedPathInfo = {
  name: string;
  path: PathValue;
};

type UsageMode = 'reactive' | 'direct' | 'callable';

const REACTIVE_HELPERS: ReadonlySet<string> = new Set([
  SYMBOLS.IF_HELPER,
  SYMBOLS.EQ,
  SYMBOLS.NOT,
  SYMBOLS.OR,
  SYMBOLS.AND,
]);

function isSafeMemoPath(value: PathValue): boolean {
  if (value.isArg) {
    return true;
  }
  const expr = value.expression;
  return expr === 'this' || expr.startsWith('this.') || expr.startsWith('this[');
}

function isKnownHelper(ctx: CompilerContext, name: string): boolean {
  const rootName = name.split(/[.\[]/)[0];
  return (
    name.startsWith('@') ||
    name.startsWith('this.') ||
    name.startsWith('this[') ||
    name.startsWith('$_') ||
    ctx.scopeTracker.hasBinding(rootName)
  );
}

export function collectMemoizedPaths(
  ctx: CompilerContext,
  children: readonly HBSChild[],
): Map<string, MemoizedPathInfo> {
  if (!ctx.flags.IS_GLIMMER_COMPAT_MODE) {
    return new Map();
  }

  const counts = new Map<string, { count: number; path: PathValue }>();
  const blocked = new Set<string>();

  const trackPath = (value: PathValue, mode: UsageMode) => {
    if (mode !== 'reactive') {
      return;
    }
    if (!isSafeMemoPath(value)) {
      return;
    }
    const key = value.expression;
    if (blocked.has(key)) {
      return;
    }
    const entry = counts.get(key);
    if (!entry) {
      counts.set(key, { count: 1, path: value });
    } else {
      entry.count += 1;
    }
  };

  const blockPath = (value: PathValue) => {
    if (!isSafeMemoPath(value)) {
      return;
    }
    blocked.add(value.expression);
  };

  const visitValue = (value: SerializedValue, mode: UsageMode) => {
    switch (value.kind) {
      case 'path':
        if (mode === 'callable') {
          blockPath(value);
        } else {
          trackPath(value, mode);
        }
        return;
      case 'getter':
        visitValue(value.value, 'reactive');
        return;
      case 'concat':
        for (const part of value.parts) {
          visitValue(part, 'direct');
        }
        return;
      case 'helper':
        visitHelper(value);
        return;
      case 'literal':
      case 'raw':
      case 'spread':
        return;
    }
  };

  const visitHelperArgs = (
    positional: readonly SerializedValue[],
    named: ReadonlyMap<string, SerializedValue>,
    mode: UsageMode,
  ) => {
    for (const arg of positional) {
      visitValue(arg, mode);
    }
    for (const val of named.values()) {
      visitValue(val, mode);
    }
  };

  const visitHelper = (helper: HelperValue) => {
    const name = helper.name;

    // Element helper: first arg is a tag name (callable)
    if (name === INTERNAL_HELPERS.ELEMENT_HELPER) {
      const tagValue = helper.positional[0];
      if (tagValue) {
        visitValue(tagValue, 'callable');
      }
      return;
    }

    const known = isKnownHelper(ctx, name);

    // unless() transforms to if() when not shadowed
    if (name === 'unless' && !known) {
      visitHelperArgs(helper.positional, helper.named, 'reactive');
      return;
    }

    const builtIn = !known ? getBuiltInHelperSymbol(name) : null;

    if (builtIn) {
      if (builtIn === SYMBOLS.FN) {
        if (helper.positional.length > 0) {
          visitValue(helper.positional[0], 'direct');
        }
        for (let i = 1; i < helper.positional.length; i++) {
          visitValue(helper.positional[i], 'reactive');
        }
        for (const val of helper.named.values()) {
          visitValue(val, 'reactive');
        }
        return;
      }

      if (builtIn === SYMBOLS.HASH) {
        // Hash wraps values in getters; avoid memoizing path tags here.
        visitHelperArgs(helper.positional, helper.named, 'callable');
        return;
      }

      if (REACTIVE_HELPERS.has(builtIn)) {
        visitHelperArgs(helper.positional, helper.named, 'reactive');
        return;
      }

      visitHelperArgs(helper.positional, helper.named, 'reactive');
      return;
    }

    if (known && !ctx.flags.WITH_HELPER_MANAGER) {
      visitHelperArgs(helper.positional, helper.named, 'direct');
      return;
    }

    visitHelperArgs(helper.positional, helper.named, 'reactive');
  };

  const visitChild = (child: HBSChild) => {
    if (child === null || typeof child === 'string') {
      return;
    }
    if (isSerializedValue(child)) {
      visitValue(child, 'reactive');
      return;
    }
    if (isHBSControlExpression(child)) {
      visitValue(child.condition, 'reactive');
      child.children.forEach(visitChild);
      child.inverse?.forEach(visitChild);
      return;
    }
    if (isHBSNode(child)) {
      for (const [, value] of child.attributes) {
        visitValue(value, 'reactive');
      }
      for (const [, value] of child.properties) {
        visitValue(value, 'reactive');
      }
      child.children.forEach(visitChild);
      return;
    }
  };

  children.forEach(visitChild);

  const memoized = new Map<string, MemoizedPathInfo>();
  let counter = 0;

  for (const [key, entry] of counts) {
    if (blocked.has(key)) {
      continue;
    }
    if (entry.count > 1) {
      memoized.set(key, {
        name: `$_g${counter++}`,
        path: entry.path,
      });
    }
  }

  return memoized;
}
