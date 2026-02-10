# Implementation Plan: Type-Directed Optimization for GXT Compiler

Based on the research document (`RESEARCH_TYPE_DIRECTED_OPTIMIZATION.md`) and analysis of the actual codebase.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Phase 1: Zero-Risk Structural Optimizations](#2-phase-1-zero-risk-structural-optimizations)
3. [Phase 2: Explicit Opt-In Infrastructure](#3-phase-2-explicit-opt-in-infrastructure)
4. [Phase 3: Automatic Optimization](#4-phase-3-automatic-optimization)
5. [Phase 4: Advanced Optimizations](#5-phase-4-advanced-optimizations)
6. [Dependency Graph](#6-dependency-graph)
7. [Risk Matrix](#7-risk-matrix)

---

## 1. Architecture Overview

### Current Data Flow

```
Template String
    |
    v  @glimmer/syntax preprocess()
ASTv1
    |
    v  visitors/mustache.ts: visitMustache() -> visitSimpleMustache() / visitHelperMustache()
SerializedValue (kind: 'path' | 'literal' | 'getter' | 'helper' | ...)
    |
    v  serializers/value.ts: buildValue() -> buildPathExpression()
JSExpression (builder AST)
    |
    v  builder.ts: serializeJS()
JavaScript string
```

### Key Decision Point

The getter-wrapping decision is made in `buildPathExpression()` at `/Users/lifeart/Repos/glimmer-next/plugins/compiler/serializers/value.ts`, lines 137-139:

```typescript
if (wrapInGetter && ctx.flags.IS_GLIMMER_COMPAT_MODE) {
  return B.reactiveGetter(pathExpr, value.sourceRange);
}
```

This is the single point where `() => this.x` wrappers are added. All type-directed optimizations for path expressions converge here.

### Runtime Consumption Point

At runtime, `resolveBindingValue()` in `/Users/lifeart/Repos/glimmer-next/src/core/dom.ts` (line 238) handles the generated code:

```typescript
function resolveBindingValue(value: unknown, debugName: string) {
  if (isFn(value)) {              // <-- getter wrapper hits this path
    const f = formula(() => deepFnValue(value), debugName);
    if (f.isConst) {              // <-- static values destroyed here
      const constValue = f.value;
      f.destroy();
      return { result: constValue, isReactive: false };
    }
    return { result: f, isReactive: true };
  }
  // Static path: direct value
  const result = $_TO_VALUE(value);
  if (isTagLike(result)) {
    return { result, isReactive: true };
  }
  return { result, isReactive: false };
}
```

When the compiler emits a direct value instead of a getter, `resolveBindingValue` skips the `formula()` allocation and goes straight to the static path (line 252-256). This is the primary runtime saving.

---

## 2. Phase 1: Zero-Risk Structural Optimizations

These require no type information -- only structural/AST analysis.

### Step 1.1: Literal Value Inlining Verification

**Status**: Already implemented. Template literals like `{{42}}`, `{{"hello"}}`, `{{true}}` are handled in `visitMustacheLiteral()` at `/Users/lifeart/Repos/glimmer-next/plugins/compiler/visitors/mustache.ts` lines 65-103.

**Verification needed**: Confirm these are not wrapped in getters when used as children of `$_tag`.

#### Test Cases

**File**: `/Users/lifeart/Repos/glimmer-next/plugins/compiler/__tests__/compile.test.ts` (add to existing)

```typescript
describe('literal value inlining', () => {
  test('string literal is not wrapped in getter', () => {
    const result = compile('{{"hello"}}');
    expect(result.code).toContain('"hello"');
    // Must NOT have a getter wrapper: () => "hello"
    expect(result.code).not.toMatch(/\(\)\s*=>\s*"hello"/);
  });

  test('number literal is not wrapped in getter', () => {
    const result = compile('{{42}}');
    expect(result.code).toContain('42');
    expect(result.code).not.toMatch(/\(\)\s*=>\s*42/);
  });

  test('boolean literal is not wrapped in getter', () => {
    const result = compile('{{true}}');
    expect(result.code).toContain('true');
    expect(result.code).not.toMatch(/\(\)\s*=>\s*true/);
  });

  test('null literal is not wrapped in getter', () => {
    const result = compile('{{null}}');
    expect(result.code).toContain('null');
    expect(result.code).not.toMatch(/\(\)\s*=>\s*null/);
  });

  test('undefined literal is not wrapped in getter', () => {
    const result = compile('{{undefined}}');
    expect(result.code).toContain('undefined');
    expect(result.code).not.toMatch(/\(\)\s*=>\s*undefined/);
  });
});
```

**Acceptance Criteria**: All 5 tests pass. Confirms the baseline behavior that literal values are already optimized.

---

### Step 1.2: Template Static Structure Hoisting (Future -- Deferred)

**Description**: Clone static HTML subtrees via `template()` + `innerHTML` + `cloneNode(true)` instead of individual `createElement` calls.

**Rationale for deferral**: This is the highest-impact structural optimization but requires significant runtime changes (new `$_template()` runtime function, patching dynamic slots after clone). It is orthogonal to type-directed optimization and should be tracked as a separate initiative.

**No code changes in this plan.** Documented here for completeness.

---

## 3. Phase 2: Explicit Opt-In Infrastructure

### Step 2.1: Add `WITH_TYPE_OPTIMIZATION` Compiler Flag

**File**: `/Users/lifeart/Repos/glimmer-next/plugins/compiler/types.ts`

**Change**: Add the flag to `CompilerFlags` interface (line 70) and `DEFAULT_FLAGS` (line 93).

```typescript
// In CompilerFlags interface (after line 75):
export interface CompilerFlags {
  readonly IS_GLIMMER_COMPAT_MODE: boolean;
  readonly WITH_HELPER_MANAGER: boolean;
  readonly WITH_MODIFIER_MANAGER: boolean;
  readonly WITH_EVAL_SUPPORT: boolean;
  /** Enable type-directed optimization. Requires typeHints in CompileOptions. Default: false */
  readonly WITH_TYPE_OPTIMIZATION: boolean;  // NEW
}

// In DEFAULT_FLAGS (after line 97):
export const DEFAULT_FLAGS: CompilerFlags = Object.freeze({
  IS_GLIMMER_COMPAT_MODE: true,
  WITH_HELPER_MANAGER: false,
  WITH_MODIFIER_MANAGER: false,
  WITH_EVAL_SUPPORT: false,
  WITH_TYPE_OPTIMIZATION: false,  // NEW
});
```

**Dependencies**: None. This is the first change.

#### Test Cases

**File**: `/Users/lifeart/Repos/glimmer-next/plugins/compiler/__tests__/types.test.ts` (add to existing)

```typescript
describe('WITH_TYPE_OPTIMIZATION flag', () => {
  test('defaults to false', () => {
    const flags = createFlags();
    expect(flags.WITH_TYPE_OPTIMIZATION).toBe(false);
  });

  test('can be enabled via override', () => {
    const flags = createFlags({ WITH_TYPE_OPTIMIZATION: true });
    expect(flags.WITH_TYPE_OPTIMIZATION).toBe(true);
  });

  test('is frozen (immutable)', () => {
    const flags = createFlags({ WITH_TYPE_OPTIMIZATION: true });
    expect(() => {
      (flags as any).WITH_TYPE_OPTIMIZATION = false;
    }).toThrow();
  });

  test('does not affect compilation when no typeHints provided', () => {
    // Enabling flag without hints should produce identical output
    const withoutFlag = compile('{{this.name}}');
    const withFlag = compile('{{this.name}}', {
      flags: { WITH_TYPE_OPTIMIZATION: true },
    });
    expect(withFlag.code).toBe(withoutFlag.code);
  });
});
```

**Acceptance Criteria**: Flag exists, defaults to `false`, is frozen, and enabling it alone does not change output.

---

### Step 2.2: Add `PropertyTypeHint` and `typeHints` to `CompileOptions`

**File**: `/Users/lifeart/Repos/glimmer-next/plugins/compiler/types.ts`

**Change**: Add new types before `CompileOptions` (around line 445) and extend `CompileOptions`.

```typescript
// ============================================================================
// Type Hint Types (for type-directed optimization)
// ============================================================================

/**
 * Reactivity classification for a template expression.
 * Used by type-directed optimization to select the code generation strategy.
 */
export type ReactivityHint = 'static' | 'reactive' | 'unknown';

/**
 * Type hint for a single property, argument, or helper return value.
 * Provided by external analysis tools (e.g., TypeScript type extraction).
 */
export interface PropertyTypeHint {
  /** General classification of the value type */
  readonly kind: 'primitive' | 'object' | 'function' | 'cell' | 'unknown';
  /** Whether the property is declared readonly */
  readonly isReadonly?: boolean;
  /** Whether the property has the @tracked decorator */
  readonly isTracked?: boolean;
  /** For literal types, the compile-time known value */
  readonly literalValue?: string | number | boolean;
}

/**
 * Type hints for template expressions.
 * Passed through CompileOptions to guide optimization decisions.
 */
export interface TypeHints {
  /** Maps "this.propertyName" -> type hint */
  readonly properties?: Readonly<Record<string, PropertyTypeHint>>;
  /** Maps "argName" (without @) -> type hint */
  readonly args?: Readonly<Record<string, PropertyTypeHint>>;
  /** Maps helper name -> return type hint */
  readonly helperReturns?: Readonly<Record<string, PropertyTypeHint>>;
}
```

Then extend `CompileOptions` (at line 448):

```typescript
export interface CompileOptions {
  readonly flags?: Partial<CompilerFlags>;
  readonly bindings?: ReadonlySet<string>;
  readonly filename?: string;
  readonly format?: Partial<FormatOptions> | boolean;
  readonly sourceMap?: SourceMapOptions | boolean;
  readonly diagnostics?: DiagnosticsOptions;
  readonly customizeComponentName?: (input: string) => string;
  readonly lexicalScope?: (variable: string) => boolean;
  /** Type hints for type-directed optimization. Only used when WITH_TYPE_OPTIMIZATION is true. */
  readonly typeHints?: TypeHints;  // NEW
}
```

**Add to `SerializedValueBase`** (line 143):

```typescript
interface SerializedValueBase {
  readonly sourceRange?: SourceRange;
  /** Reactivity classification from type analysis. Only present when type optimization is enabled. */
  readonly reactivity?: ReactivityHint;  // NEW
}
```

**Dependencies**: Step 2.1 (flag must exist first).

#### Test Cases

**File**: `/Users/lifeart/Repos/glimmer-next/plugins/compiler/__tests__/types.test.ts`

```typescript
describe('TypeHints', () => {
  test('CompileOptions accepts typeHints', () => {
    const options: CompileOptions = {
      flags: { WITH_TYPE_OPTIMIZATION: true },
      typeHints: {
        properties: {
          'this.title': { kind: 'primitive', isReadonly: true },
          'this.count': { kind: 'primitive', isTracked: true },
        },
        args: {
          'name': { kind: 'primitive' },
        },
        helperReturns: {
          'formatDate': { kind: 'primitive' },
        },
      },
    };
    // Should compile without errors
    const result = compile('<div>{{this.title}}</div>', options);
    expect(result.errors).toHaveLength(0);
  });

  test('typeHints are ignored when WITH_TYPE_OPTIMIZATION is false', () => {
    const withHints = compile('{{this.title}}', {
      typeHints: {
        properties: {
          'this.title': { kind: 'primitive', isReadonly: true },
        },
      },
    });
    const without = compile('{{this.title}}');
    expect(withHints.code).toBe(without.code);
  });

  test('SerializedValue factory functions accept reactivity hint', () => {
    const val = literal('hello');
    expect(val.reactivity).toBeUndefined();
    // reactivity is optional and does not break existing factory functions
  });
});
```

**Acceptance Criteria**: Types compile. `typeHints` can be passed to `compile()`. No change in output without `WITH_TYPE_OPTIMIZATION: true`.

---

### Step 2.3: Store `typeHints` in `CompilerContext`

**File**: `/Users/lifeart/Repos/glimmer-next/plugins/compiler/context.ts`

**Change 1**: Add `typeHints` field to `CompilerContext` interface (after line 234):

```typescript
export interface CompilerContext {
  // ... existing fields ...

  /** CALLBACK to determine lexical scope */
  readonly lexicalScope?: (variable: string) => boolean;

  /** Type hints for type-directed optimization (from CompileOptions) */
  readonly typeHints?: TypeHints;  // NEW
}
```

**Change 2**: Add the import at top:

```typescript
import type {
  // ... existing imports ...
  TypeHints,  // NEW
} from './types';
```

**Change 3**: Pass through in `createContext()` (line 261). Add after line 296:

```typescript
export function createContext(
  source: string,
  options: CompileOptions = {}
): CompilerContext {
  // ... existing code ...

  return {
    // ... existing fields ...
    customizeComponentName: options.customizeComponentName,
    lexicalScope: options.lexicalScope,
    typeHints: options.typeHints,  // NEW
  };
}
```

**Dependencies**: Step 2.2 (types must exist).

#### Test Cases

**File**: `/Users/lifeart/Repos/glimmer-next/plugins/compiler/__tests__/context.test.ts` (add to existing)

```typescript
describe('typeHints in context', () => {
  test('typeHints are accessible on context when provided', () => {
    const ctx = createContext('<div></div>', {
      typeHints: {
        properties: {
          'this.title': { kind: 'primitive', isReadonly: true },
        },
      },
    });
    expect(ctx.typeHints).toBeDefined();
    expect(ctx.typeHints?.properties?.['this.title']?.kind).toBe('primitive');
  });

  test('typeHints are undefined when not provided', () => {
    const ctx = createContext('<div></div>');
    expect(ctx.typeHints).toBeUndefined();
  });
});
```

**Acceptance Criteria**: `ctx.typeHints` is populated when provided; undefined when not.

---

### Step 2.4: Add Reactivity Classification Helper

**File**: NEW -- `/Users/lifeart/Repos/glimmer-next/plugins/compiler/type-hints.ts`

This module contains the logic for looking up type hints and computing reactivity classification. Keeping it separate from the serializers ensures clean separation of concerns and easy testing.

```typescript
/**
 * Type Hint Resolution
 *
 * Resolves type hints from CompilerContext and computes
 * reactivity classification for template expressions.
 */

import type { CompilerContext } from './context';
import type { ReactivityHint, PropertyTypeHint, TypeHints } from './types';

/**
 * Look up the type hint for a path expression.
 *
 * @param ctx - Compiler context (must have typeHints and WITH_TYPE_OPTIMIZATION flag)
 * @param expression - The path expression (e.g., "this.title", "this.count")
 * @param isArg - Whether this is an @arg reference
 * @returns PropertyTypeHint or undefined if no hint is available
 */
export function lookupTypeHint(
  ctx: CompilerContext,
  expression: string,
  isArg: boolean
): PropertyTypeHint | undefined {
  if (!ctx.flags.WITH_TYPE_OPTIMIZATION || !ctx.typeHints) {
    return undefined;
  }

  if (isArg) {
    // @argName -> look up in args hints
    // Expression comes in as "this[$args].argName" but the hint key is just "argName"
    const argName = extractArgName(expression);
    return argName ? ctx.typeHints.args?.[argName] : undefined;
  }

  // this.propertyName -> look up in properties hints
  return ctx.typeHints.properties?.[expression];
}

/**
 * Look up the return type hint for a helper.
 *
 * @param ctx - Compiler context
 * @param helperName - The helper name
 * @returns PropertyTypeHint or undefined
 */
export function lookupHelperReturnHint(
  ctx: CompilerContext,
  helperName: string
): PropertyTypeHint | undefined {
  if (!ctx.flags.WITH_TYPE_OPTIMIZATION || !ctx.typeHints) {
    return undefined;
  }
  return ctx.typeHints.helperReturns?.[helperName];
}

/**
 * Classify the reactivity of a path expression based on type hints.
 *
 * Conservative rules:
 * - 'unknown' kind -> 'unknown' (fallback to runtime detection)
 * - 'primitive' + isReadonly -> 'static' (no reactivity needed)
 * - 'primitive' + NOT isTracked -> 'static' (plain property, no Cell backing)
 * - 'primitive' + isTracked -> 'reactive' (has Cell backing, needs getter)
 * - 'object' -> 'unknown' (could contain reactive references)
 * - 'function' -> 'unknown' (could return reactive values)
 * - 'cell' -> 'reactive' (always reactive)
 *
 * @returns ReactivityHint
 */
export function classifyReactivity(hint: PropertyTypeHint | undefined): ReactivityHint {
  if (!hint || hint.kind === 'unknown') {
    return 'unknown';
  }

  // Cell type is always reactive
  if (hint.kind === 'cell') {
    return 'reactive';
  }

  // Functions could return anything -- treat as unknown
  if (hint.kind === 'function') {
    return 'unknown';
  }

  // Objects could contain reactive references -- treat as unknown
  if (hint.kind === 'object') {
    return 'unknown';
  }

  // Primitive type
  if (hint.kind === 'primitive') {
    // Readonly primitives are definitely static
    if (hint.isReadonly) {
      return 'static';
    }
    // Tracked primitives are reactive (backed by Cell)
    if (hint.isTracked) {
      return 'reactive';
    }
    // Non-tracked, non-readonly primitive: static (plain class property)
    return 'static';
  }

  return 'unknown';
}

/**
 * Determine if the compiler should skip getter wrapping for a given expression.
 *
 * @returns true if the value is known to be static and can be emitted directly
 */
export function shouldSkipGetterWrapper(
  ctx: CompilerContext,
  expression: string,
  isArg: boolean
): boolean {
  const hint = lookupTypeHint(ctx, expression, isArg);
  const reactivity = classifyReactivity(hint);
  return reactivity === 'static';
}

/**
 * Extract the arg name from a resolved arg expression.
 * "this[$args].userName" -> "userName"
 * "this[$args][\"user-name\"]" -> "user-name"
 */
function extractArgName(expression: string): string | undefined {
  // Handle "this[$args].argName" pattern
  const dotMatch = expression.match(/\$args\]\.(\w+)/);
  if (dotMatch) return dotMatch[1];

  // Handle bracket notation: this[$args]["argName"]
  const bracketMatch = expression.match(/\$args\]\["([^"]+)"\]/);
  if (bracketMatch) return bracketMatch[1];

  // Handle simple unresolved arg names (e.g., just "userName")
  // Used when the caller passes the raw arg name
  if (!expression.includes('.') && !expression.includes('[')) {
    return expression;
  }

  return undefined;
}
```

**Dependencies**: Steps 2.1, 2.2, 2.3.

#### Test Cases

**File**: NEW -- `/Users/lifeart/Repos/glimmer-next/plugins/compiler/__tests__/type-hints.test.ts`

```typescript
import { describe, test, expect } from 'vitest';
import { createContext } from '../context';
import { initializeVisitors } from '../context';
import {
  lookupTypeHint,
  lookupHelperReturnHint,
  classifyReactivity,
  shouldSkipGetterWrapper,
} from '../type-hints';
import type { PropertyTypeHint } from '../types';

describe('type-hints module', () => {
  function makeCtx(typeHints: any, withFlag = true) {
    return createContext('', {
      flags: { WITH_TYPE_OPTIMIZATION: withFlag },
      typeHints,
    });
  }

  describe('lookupTypeHint', () => {
    test('returns hint for known this.property', () => {
      const ctx = makeCtx({
        properties: { 'this.title': { kind: 'primitive', isReadonly: true } },
      });
      const hint = lookupTypeHint(ctx, 'this.title', false);
      expect(hint).toEqual({ kind: 'primitive', isReadonly: true });
    });

    test('returns undefined for unknown property', () => {
      const ctx = makeCtx({ properties: {} });
      const hint = lookupTypeHint(ctx, 'this.unknown', false);
      expect(hint).toBeUndefined();
    });

    test('returns hint for @arg by name', () => {
      const ctx = makeCtx({
        args: { 'userName': { kind: 'primitive' } },
      });
      const hint = lookupTypeHint(ctx, 'userName', true);
      expect(hint).toEqual({ kind: 'primitive' });
    });

    test('returns undefined when WITH_TYPE_OPTIMIZATION is false', () => {
      const ctx = makeCtx(
        { properties: { 'this.title': { kind: 'primitive' } } },
        false, // flag disabled
      );
      const hint = lookupTypeHint(ctx, 'this.title', false);
      expect(hint).toBeUndefined();
    });

    test('returns undefined when typeHints is undefined', () => {
      const ctx = createContext('', {
        flags: { WITH_TYPE_OPTIMIZATION: true },
        // no typeHints
      });
      const hint = lookupTypeHint(ctx, 'this.title', false);
      expect(hint).toBeUndefined();
    });
  });

  describe('lookupHelperReturnHint', () => {
    test('returns hint for known helper', () => {
      const ctx = makeCtx({
        helperReturns: { 'formatDate': { kind: 'primitive' } },
      });
      const hint = lookupHelperReturnHint(ctx, 'formatDate');
      expect(hint).toEqual({ kind: 'primitive' });
    });

    test('returns undefined for unknown helper', () => {
      const ctx = makeCtx({ helperReturns: {} });
      expect(lookupHelperReturnHint(ctx, 'unknown')).toBeUndefined();
    });
  });

  describe('classifyReactivity', () => {
    const cases: Array<[string, PropertyTypeHint | undefined, string]> = [
      ['undefined hint', undefined, 'unknown'],
      ['unknown kind', { kind: 'unknown' }, 'unknown'],
      ['cell type', { kind: 'cell' }, 'reactive'],
      ['function type', { kind: 'function' }, 'unknown'],
      ['object type', { kind: 'object' }, 'unknown'],
      ['readonly primitive', { kind: 'primitive', isReadonly: true }, 'static'],
      ['tracked primitive', { kind: 'primitive', isTracked: true }, 'reactive'],
      ['plain primitive', { kind: 'primitive' }, 'static'],
      ['readonly + tracked', { kind: 'primitive', isReadonly: true, isTracked: true }, 'static'],
    ];

    for (const [label, hint, expected] of cases) {
      test(`classifies "${label}" as ${expected}`, () => {
        expect(classifyReactivity(hint)).toBe(expected);
      });
    }
  });

  describe('shouldSkipGetterWrapper', () => {
    test('returns true for readonly primitive property', () => {
      const ctx = makeCtx({
        properties: { 'this.title': { kind: 'primitive', isReadonly: true } },
      });
      expect(shouldSkipGetterWrapper(ctx, 'this.title', false)).toBe(true);
    });

    test('returns false for tracked property', () => {
      const ctx = makeCtx({
        properties: { 'this.count': { kind: 'primitive', isTracked: true } },
      });
      expect(shouldSkipGetterWrapper(ctx, 'this.count', false)).toBe(false);
    });

    test('returns false for object type (conservative)', () => {
      const ctx = makeCtx({
        properties: { 'this.user': { kind: 'object' } },
      });
      expect(shouldSkipGetterWrapper(ctx, 'this.user', false)).toBe(false);
    });

    test('returns false when flag is disabled', () => {
      const ctx = makeCtx(
        { properties: { 'this.title': { kind: 'primitive', isReadonly: true } } },
        false,
      );
      expect(shouldSkipGetterWrapper(ctx, 'this.title', false)).toBe(false);
    });

    test('returns true for plain (non-tracked) primitive arg', () => {
      const ctx = makeCtx({
        args: { 'label': { kind: 'primitive' } },
      });
      expect(shouldSkipGetterWrapper(ctx, 'label', true)).toBe(true);
    });

    test('returns false for unknown property (no hint)', () => {
      const ctx = makeCtx({ properties: {} });
      expect(shouldSkipGetterWrapper(ctx, 'this.anything', false)).toBe(false);
    });
  });
});
```

**Acceptance Criteria**: All classification tests pass. Conservative behavior confirmed: `object`, `function`, `unknown`, and missing hints all fall back to `'unknown'` (no optimization).

---

### Step 2.5: Wire Type Hints into `buildPathExpression()`

**File**: `/Users/lifeart/Repos/glimmer-next/plugins/compiler/serializers/value.ts`

**Change**: Modify `buildPathExpression()` (lines 100-141) to check type hints before wrapping in a getter.

Current code (lines 136-141):

```typescript
const pathExpr = buildPathBase(ctx, value);
if (wrapInGetter && ctx.flags.IS_GLIMMER_COMPAT_MODE) {
  return B.reactiveGetter(pathExpr, value.sourceRange);
}
return pathExpr;
```

New code:

```typescript
import { shouldSkipGetterWrapper } from '../type-hints';

// ... inside buildPathExpression(), replace lines 136-141:

const pathExpr = buildPathBase(ctx, value);

// Type-directed optimization: skip getter wrapper for known-static values
if (wrapInGetter && ctx.flags.IS_GLIMMER_COMPAT_MODE) {
  if (shouldSkipGetterWrapper(ctx, value.expression, value.isArg)) {
    // Type hint says this value is static -- emit direct reference
    return pathExpr;
  }
  return B.reactiveGetter(pathExpr, value.sourceRange);
}
return pathExpr;
```

**Dependencies**: Steps 2.1-2.4 (all infrastructure must be in place).

#### Test Cases

**File**: NEW -- `/Users/lifeart/Repos/glimmer-next/plugins/compiler/__tests__/type-optimization.test.ts`

This is the main test file for the feature. It tests end-to-end compilation with type hints.

```typescript
import { describe, test, expect } from 'vitest';
import { compile, compileToCode } from '../compile';
import { SYMBOLS } from '../serializers';
import type { CompileOptions } from '../types';

function compileWithHints(template: string, typeHints: CompileOptions['typeHints']): string {
  return compileToCode(template, {
    flags: { WITH_TYPE_OPTIMIZATION: true },
    typeHints,
  });
}

function compileDefault(template: string): string {
  return compileToCode(template);
}

describe('Type-directed optimization: getter elision', () => {
  describe('Happy path: static properties skip getter', () => {
    test('readonly primitive this.property emits direct reference', () => {
      const code = compileWithHints('{{this.title}}', {
        properties: {
          'this.title': { kind: 'primitive', isReadonly: true },
        },
      });
      // Should contain a direct reference, NOT wrapped in () =>
      expect(code).toContain('this.title');
      expect(code).not.toMatch(/\(\)\s*=>\s*this\.title/);
    });

    test('plain (non-tracked) primitive this.property emits direct reference', () => {
      const code = compileWithHints('{{this.label}}', {
        properties: {
          'this.label': { kind: 'primitive' },
        },
      });
      expect(code).toContain('this.label');
      expect(code).not.toMatch(/\(\)\s*=>\s*this\.label/);
    });

    test('readonly literal value is inlined', () => {
      const code = compileWithHints('{{this.version}}', {
        properties: {
          'this.version': {
            kind: 'primitive',
            isReadonly: true,
            literalValue: '1.0.0',
          },
        },
      });
      // Even with literal value hint, current implementation emits direct reference
      // (literal inlining is a future enhancement)
      expect(code).toContain('this.version');
      expect(code).not.toMatch(/\(\)\s*=>\s*this\.version/);
    });

    test('static property in element child', () => {
      const code = compileWithHints('<div>{{this.title}}</div>', {
        properties: {
          'this.title': { kind: 'primitive', isReadonly: true },
        },
      });
      expect(code).toContain(SYMBOLS.TAG);
      expect(code).toContain('this.title');
      expect(code).not.toMatch(/\(\)\s*=>\s*this\.title/);
    });

    test('static property in element attribute', () => {
      const code = compileWithHints('<div title={{this.label}}></div>', {
        properties: {
          'this.label': { kind: 'primitive' },
        },
      });
      expect(code).toContain('this.label');
      // Attribute values may have different wrapping; verify no getter
      expect(code).not.toMatch(/\(\)\s*=>\s*this\.label/);
    });
  });

  describe('Reactive properties still get getter wrapper', () => {
    test('@tracked primitive still gets getter wrapper', () => {
      const code = compileWithHints('{{this.count}}', {
        properties: {
          'this.count': { kind: 'primitive', isTracked: true },
        },
      });
      // Must have getter wrapper because @tracked means it can change
      expect(code).toMatch(/\(\)\s*=>\s*this\.count/);
    });

    test('cell type still gets getter wrapper', () => {
      const code = compileWithHints('{{this.signal}}', {
        properties: {
          'this.signal': { kind: 'cell' },
        },
      });
      expect(code).toMatch(/\(\)\s*=>\s*this\.signal/);
    });
  });

  describe('Conservative fallback for ambiguous types', () => {
    test('object type falls back to getter (conservative)', () => {
      const code = compileWithHints('{{this.user}}', {
        properties: {
          'this.user': { kind: 'object' },
        },
      });
      // Object could contain reactive references, so getter is kept
      expect(code).toMatch(/\(\)\s*=>\s*this\.user/);
    });

    test('function type falls back to getter (conservative)', () => {
      const code = compileWithHints('{{this.compute}}', {
        properties: {
          'this.compute': { kind: 'function' },
        },
      });
      expect(code).toMatch(/\(\)\s*=>\s*this\.compute/);
    });

    test('unknown type falls back to getter (conservative)', () => {
      const code = compileWithHints('{{this.data}}', {
        properties: {
          'this.data': { kind: 'unknown' },
        },
      });
      expect(code).toMatch(/\(\)\s*=>\s*this\.data/);
    });

    test('property without hint falls back to getter', () => {
      const code = compileWithHints('{{this.noHint}}', {
        properties: {
          // 'this.noHint' is NOT in the hints map
          'this.title': { kind: 'primitive' },
        },
      });
      expect(code).toMatch(/\(\)\s*=>\s*this\.noHint/);
    });
  });

  describe('Edge cases', () => {
    test('nested path: this.user.name with hint on this.user', () => {
      // Only the exact path should match -- partial paths do not
      const code = compileWithHints('{{this.user.name}}', {
        properties: {
          'this.user': { kind: 'object' },
          // No hint for 'this.user.name'
        },
      });
      // Should still have getter since 'this.user.name' has no hint
      expect(code).toMatch(/\(\)\s*=>\s*this\.user/);
    });

    test('multiple expressions: mix of hinted and unhinted', () => {
      const code = compileWithHints(
        '<div>{{this.title}} {{this.count}}</div>',
        {
          properties: {
            'this.title': { kind: 'primitive', isReadonly: true },
            // 'this.count' has no hint
          },
        },
      );
      // title should NOT have getter
      expect(code).not.toMatch(/\(\)\s*=>\s*this\.title/);
      // count should STILL have getter
      expect(code).toMatch(/\(\)\s*=>\s*this\.count/);
    });

    test('flag disabled: hints are ignored', () => {
      const withHints = compileToCode('{{this.title}}', {
        flags: { WITH_TYPE_OPTIMIZATION: false },
        typeHints: {
          properties: {
            'this.title': { kind: 'primitive', isReadonly: true },
          },
        },
      });
      const without = compileDefault('{{this.title}}');
      expect(withHints).toBe(without);
    });
  });

  describe('Regression: unoptimized path still works', () => {
    test('without type optimization, all paths get getter wrapper', () => {
      const code = compileDefault('{{this.title}}');
      expect(code).toMatch(/\(\)\s*=>\s*this\.title/);
    });

    test('without type optimization, @args get getter wrapper', () => {
      const code = compileDefault('{{@name}}');
      expect(code).toMatch(/\(\)\s*=>/);
    });

    test('literal values are never wrapped regardless of optimization', () => {
      const code = compileDefault('{{"hello"}}');
      expect(code).not.toMatch(/\(\)\s*=>\s*"hello"/);
    });
  });
});
```

**Acceptance Criteria**:
1. When `WITH_TYPE_OPTIMIZATION: true` and a property has `kind: 'primitive'` + `isReadonly: true`, the compiled output does NOT contain a getter wrapper for that property.
2. Tracked, cell, object, function, and unknown types still produce getter wrappers.
3. Missing hints fall back to getter wrappers.
4. Disabling the flag makes hints have no effect.
5. All existing tests still pass (no regression).

---

### Step 2.6: Add `@static` Decorator to Reactive System

**File**: `/Users/lifeart/Repos/glimmer-next/src/core/reactive.ts`

**Change**: Add a `@static` decorator that is a no-op at runtime but serves as a marker for the compiler. This is the counterpart to `@tracked`.

Add after the `tracked` decorator function (line 118):

```typescript
/**
 * Marks a property as static (non-reactive).
 *
 * This is a no-op at runtime -- the property behaves as a plain class field.
 * The compiler uses this decorator as a signal to skip reactive wrapping
 * when generating template code.
 *
 * Usage:
 *   class MyComponent extends Component {
 *     @static title = "Hello";  // Compiler emits direct value, no getter
 *     @tracked count = 0;       // Compiler emits reactive getter
 *   }
 *
 * Note: Changing a @static property will NOT trigger UI updates.
 */
export function staticProp(
  _klass: any,
  _key: string,
  descriptor?: PropertyDescriptor & { initializer?: () => any },
): void {
  // No-op at runtime. The decorator is detected by the compiler
  // via AST analysis of the class body.
  if (descriptor && typeof descriptor.initializer === 'function') {
    return {
      get() {
        const value = descriptor!.initializer!.call(this);
        Object.defineProperty(this, _key, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
        return value;
      },
      enumerable: descriptor.enumerable ?? true,
      configurable: descriptor.configurable ?? true,
    } as unknown as void;
  }
  return descriptor as unknown as void;
}
```

**Note**: The decorator is named `staticProp` to avoid conflict with the JavaScript `static` keyword. It can be imported as `import { staticProp as static } from '@lifeart/gxt'` or used directly as `@staticProp`.

**Dependencies**: None (can be done in parallel with Steps 2.1-2.5).

#### Test Cases

**File**: Add to existing reactive tests or create `/Users/lifeart/Repos/glimmer-next/src/core/__tests__/static-decorator.test.ts`

```typescript
import { describe, test, expect } from 'vitest';
import { staticProp, tracked, cell } from '../reactive';

describe('@staticProp decorator', () => {
  test('property is accessible as a plain value', () => {
    class TestClass {
      @staticProp title = "Hello";
    }
    const obj = new TestClass();
    expect(obj.title).toBe("Hello");
  });

  test('property can be written without triggering reactivity', () => {
    class TestClass {
      @staticProp label = "initial";
    }
    const obj = new TestClass();
    obj.label = "changed";
    expect(obj.label).toBe("changed");
  });

  test('staticProp and tracked can coexist on same class', () => {
    class TestClass {
      @staticProp title = "Static";
      @tracked count = 0;
    }
    const obj = new TestClass();
    expect(obj.title).toBe("Static");
    expect(obj.count).toBe(0);
    obj.count = 5;
    expect(obj.count).toBe(5);
  });

  test('staticProp does not create Cell entries', () => {
    class TestClass {
      @staticProp value = 42;
    }
    const obj = new TestClass();
    void obj.value; // Access to trigger any lazy init
    // The cellsMap should not have entries for this object's @staticProp
    // (internal check -- may require importing cellsMap for verification)
  });
});
```

**Acceptance Criteria**: `@staticProp` decorator works as a plain property access. No `Cell` is created. It coexists with `@tracked`.

---

### Step 2.7: Detect `@static` / `@tracked` in Vite Plugin

**File**: `/Users/lifeart/Repos/glimmer-next/plugins/compiler.ts` and `/Users/lifeart/Repos/glimmer-next/plugins/test.ts`

**Description**: Add a lightweight class-body AST analysis pass that detects `@tracked` and `@staticProp` decorators on class properties. This generates `typeHints.properties` entries automatically without requiring external tools.

This step involves parsing the class body surrounding the template to build property hints. The implementation approach:

1. After `content-tag` preprocessor extracts the template, the surrounding class body is available as JS/TS code.
2. Use a regex or lightweight AST pass to find `@tracked propName` and `@staticProp propName` patterns.
3. Build a `TypeHints` object from these findings.
4. Pass `typeHints` into the `compile()` call.

**Proposed helper function** (add to `/Users/lifeart/Repos/glimmer-next/plugins/test.ts` or new file `/Users/lifeart/Repos/glimmer-next/plugins/decorator-analyzer.ts`):

```typescript
/**
 * Analyze a class body to extract decorator-based type hints.
 *
 * Scans for:
 * - @tracked propertyName -> { kind: 'primitive', isTracked: true }
 * - @staticProp propertyName -> { kind: 'primitive', isReadonly: true }
 *
 * This is a lightweight regex-based analysis. It does not require
 * the TypeScript compiler API.
 */
export function extractDecoratorHints(classSource: string): Record<string, import('./compiler/types').PropertyTypeHint> {
  const hints: Record<string, import('./compiler/types').PropertyTypeHint> = {};

  // Match @tracked followed by property name
  const trackedRegex = /@tracked\s+(?:(?:readonly|declare|private|public|protected)\s+)*(\w+)/g;
  let match;
  while ((match = trackedRegex.exec(classSource)) !== null) {
    hints[`this.${match[1]}`] = { kind: 'primitive', isTracked: true };
  }

  // Match @staticProp followed by property name
  const staticRegex = /@staticProp\s+(?:(?:readonly|declare|private|public|protected)\s+)*(\w+)/g;
  while ((match = staticRegex.exec(classSource)) !== null) {
    hints[`this.${match[1]}`] = { kind: 'primitive', isReadonly: true };
  }

  return hints;
}
```

**Dependencies**: Steps 2.1-2.5 (compilation infrastructure), Step 2.6 (`@staticProp` decorator).

#### Test Cases

**File**: `/Users/lifeart/Repos/glimmer-next/plugins/__tests__/decorator-analyzer.test.ts`

```typescript
import { describe, test, expect } from 'vitest';
import { extractDecoratorHints } from '../decorator-analyzer';

describe('extractDecoratorHints', () => {
  test('extracts @tracked properties', () => {
    const source = `
      class MyComponent extends Component {
        @tracked count = 0;
        @tracked name = "hello";
      }
    `;
    const hints = extractDecoratorHints(source);
    expect(hints['this.count']).toEqual({ kind: 'primitive', isTracked: true });
    expect(hints['this.name']).toEqual({ kind: 'primitive', isTracked: true });
  });

  test('extracts @staticProp properties', () => {
    const source = `
      class MyComponent extends Component {
        @staticProp title = "Hello";
      }
    `;
    const hints = extractDecoratorHints(source);
    expect(hints['this.title']).toEqual({ kind: 'primitive', isReadonly: true });
  });

  test('handles mixed decorators', () => {
    const source = `
      class MyComponent extends Component {
        @staticProp title = "Hello";
        @tracked count = 0;
        normalProp = "no decorator";
      }
    `;
    const hints = extractDecoratorHints(source);
    expect(hints['this.title']).toEqual({ kind: 'primitive', isReadonly: true });
    expect(hints['this.count']).toEqual({ kind: 'primitive', isTracked: true });
    expect(hints['this.normalProp']).toBeUndefined();
  });

  test('handles modifiers before property name', () => {
    const source = `
      @tracked readonly count = 0;
      @staticProp private title = "Hi";
    `;
    const hints = extractDecoratorHints(source);
    expect(hints['this.count']).toEqual({ kind: 'primitive', isTracked: true });
    expect(hints['this.title']).toEqual({ kind: 'primitive', isReadonly: true });
  });

  test('returns empty object for class with no decorators', () => {
    const source = `
      class MyComponent extends Component {
        name = "hello";
        count = 0;
      }
    `;
    const hints = extractDecoratorHints(source);
    expect(Object.keys(hints)).toHaveLength(0);
  });
});
```

**Acceptance Criteria**: The analyzer correctly identifies `@tracked` and `@staticProp` properties from class source. Undecorated properties are ignored.

---

## 4. Phase 3: Automatic Optimization

### Step 3.1: External Type Hints via `.type-hints.json` (Approach A)

**Description**: Build a standalone CLI tool that analyzes `.gts` files using the TypeScript Compiler API (`ts.createProgram`) and outputs `.type-hints.json` files per component.

**New file**: `/Users/lifeart/Repos/glimmer-next/tools/type-extractor.ts`

This is a separate development effort. The tool would:

1. Parse `.gts` files to find component classes.
2. Use `ts.TypeChecker` to inspect property types.
3. Classify each property as `primitive`, `object`, `function`, `cell`, or `unknown`.
4. Detect `readonly` modifier and `@tracked` decorator.
5. Output a JSON file:

```json
{
  "MyComponent": {
    "properties": {
      "this.title": { "kind": "primitive", "isReadonly": true },
      "this.count": { "kind": "primitive", "isTracked": true },
      "this.user":  { "kind": "object" }
    },
    "args": {
      "name": { "kind": "primitive" }
    }
  }
}
```

**Vite plugin integration** (`/Users/lifeart/Repos/glimmer-next/plugins/compiler.ts`):

```typescript
// In the transform() function, before calling compile():
import { readFileSync, existsSync } from 'fs';

// Inside the template processing branch:
let typeHints: TypeHints | undefined;
const hintsPath = file.replace(/\.(gts|gjs)$/, '.type-hints.json');
if (existsSync(hintsPath)) {
  try {
    const hintsData = JSON.parse(readFileSync(hintsPath, 'utf-8'));
    // Extract hints for the component in this file
    // (simplified -- real implementation would match class names)
    typeHints = hintsData;
  } catch {
    // Ignore malformed hint files
  }
}
```

**Dependencies**: Steps 2.1-2.5 (all compiler infrastructure).

**Note**: This step is deferred due to TypeScript 7 risk. The decorator-based approach (Step 2.7) provides immediate value without TypeScript API dependency.

#### Test Cases

Tests for the type extractor tool are out of scope for this plan (they would live in `tools/__tests__/`). The important tests are for the Vite plugin integration:

```typescript
describe('Vite plugin type hints integration', () => {
  test('reads .type-hints.json when present', () => {
    // Integration test: create a temp .gts file and matching .type-hints.json
    // Verify that the transform result uses optimized code paths
  });

  test('gracefully handles missing .type-hints.json', () => {
    // Verify no error when hint file does not exist
  });

  test('gracefully handles malformed .type-hints.json', () => {
    // Verify no error for invalid JSON
  });
});
```

---

### Step 3.2: Template Expression Classification in Visitors

**File**: `/Users/lifeart/Repos/glimmer-next/plugins/compiler/visitors/mustache.ts`

**Description**: Attach `reactivity` hints to `SerializedValue` objects during the visitor phase, so that serializers can use them.

**Change in `visitSimpleMustache()`** (line 175): After resolving the path, look up the type hint and attach it.

```typescript
import { lookupTypeHint, classifyReactivity } from '../type-hints';

// Inside visitSimpleMustache(), in the "no hash args, known path" branch (line 203-207):
if (isKnownPath) {
  const resolved = resolvePath(ctx, pathName);
  const partsInfo = getPathPartRanges(pathExpr);
  const pathValue = path(resolved, isArg, pathRange, partsInfo?.parts, partsInfo?.rootRange);

  // Attach reactivity hint if type optimization is enabled
  if (ctx.flags.WITH_TYPE_OPTIMIZATION) {
    const hint = lookupTypeHint(ctx, resolved, isArg);
    const reactivity = classifyReactivity(hint);
    if (reactivity !== 'unknown') {
      return { ...pathValue, reactivity } as typeof pathValue;
    }
  }

  return pathValue;
}
```

**Note**: Since `SerializedValueBase` now has an optional `reactivity` field, the spread creates a new object with the hint attached. The `path()` factory function does not need modification since the field is optional.

**Dependencies**: Steps 2.1-2.5, specifically Step 2.4 (`type-hints.ts` module).

#### Test Cases

**File**: `/Users/lifeart/Repos/glimmer-next/plugins/compiler/__tests__/visitors.test.ts` (add to existing)

```typescript
describe('visitor reactivity classification', () => {
  test('visitMustache attaches reactivity hint from type hints', () => {
    const result = compile('{{this.title}}', {
      flags: { WITH_TYPE_OPTIMIZATION: true },
      typeHints: {
        properties: {
          'this.title': { kind: 'primitive', isReadonly: true },
        },
      },
    });
    // The compiled output should reflect the static classification
    expect(result.code).not.toMatch(/\(\)\s*=>\s*this\.title/);
    expect(result.errors).toHaveLength(0);
  });

  test('visitMustache leaves reactivity as unknown when no hint', () => {
    const result = compile('{{this.unknown}}', {
      flags: { WITH_TYPE_OPTIMIZATION: true },
      typeHints: { properties: {} },
    });
    // Should fall back to getter wrapping
    expect(result.code).toMatch(/\(\)\s*=>\s*this\.unknown/);
  });
});
```

**Acceptance Criteria**: The reactivity classification flows from visitor -> serializer and produces the correct output.

---

### Step 3.3: Helper Return Type Optimization

**File**: `/Users/lifeart/Repos/glimmer-next/plugins/compiler/serializers/value.ts`

**Description**: When a helper's return type is known to be primitive, the getter wrapping around the helper call can be skipped, allowing the runtime to avoid `formula()` allocation.

**Change in `buildValue()`** (around the `case 'getter':` handler at line 67-69):

```typescript
case 'getter': {
  const innerValue = value.value;

  // Type-directed optimization: if the inner value is a helper call with
  // a known-primitive return type, skip the getter wrapper
  if (ctx.flags.WITH_TYPE_OPTIMIZATION && innerValue.kind === 'helper') {
    const returnHint = lookupHelperReturnHint(ctx, innerValue.name);
    if (returnHint && returnHint.kind === 'primitive') {
      // Helper returns a primitive -- no reactive wrapping needed
      return buildValue(ctx, innerValue, ctxName);
    }
  }

  // Default: wrap the inner value in an arrow function
  return B.getter(buildValue(ctx, innerValue, ctxName), value.sourceRange);
}
```

**Dependencies**: Steps 2.1-2.5, Step 2.4 (`lookupHelperReturnHint`).

#### Test Cases

**File**: `/Users/lifeart/Repos/glimmer-next/plugins/compiler/__tests__/type-optimization.test.ts` (add to existing file)

```typescript
describe('Helper return type optimization', () => {
  test('helper with known primitive return is not wrapped in getter', () => {
    const code = compileWithHints('{{formatDate this.date}}', {
      helperReturns: {
        'formatDate': { kind: 'primitive' },
      },
    });
    // Helper call should appear without getter wrapper
    // The helper itself is still called, just not wrapped in () =>
    expect(code).not.toMatch(/\(\)\s*=>\s*formatDate/);
  });

  test('helper with unknown return is still wrapped in getter', () => {
    const code = compileWithHints('{{unknownHelper this.data}}', {
      helperReturns: {
        // 'unknownHelper' is NOT in hints
      },
    });
    // Should still have getter wrapper
    expect(code).toMatch(/\(\)\s*=>/);
  });

  test('helper with object return is still wrapped in getter (conservative)', () => {
    const code = compileWithHints('{{getUser this.id}}', {
      helperReturns: {
        'getUser': { kind: 'object' },
      },
    });
    expect(code).toMatch(/\(\)\s*=>/);
  });

  test('built-in helpers are not affected by return type hints', () => {
    // Built-in helpers like $__if have their own handling
    const codeWithHints = compileWithHints('{{if this.show "yes" "no"}}', {
      helperReturns: {
        'if': { kind: 'primitive' },
      },
    });
    const codeWithout = compileDefault('{{if this.show "yes" "no"}}');
    // Built-in helpers should produce identical output regardless of hints
    // (they are handled by buildBuiltInHelper, not the generic getter path)
    expect(codeWithHints).toBe(codeWithout);
  });
});
```

**Acceptance Criteria**: Helpers with known-primitive return types skip getter wrapping. Unknown and object returns still get wrapped. Built-in helpers are unaffected.

---

## 5. Phase 4: Advanced Optimizations

These are higher-risk optimizations that should be deferred until Phase 2-3 are stable.

### Step 4.1: Event Handler Static Detection (Deferred)

**File**: `/Users/lifeart/Repos/glimmer-next/plugins/compiler/serializers/element.ts`

**Description**: In `buildEvents()` (line 307), event handlers are wrapped in arrow functions like `($e, $n) => handler($e, $n, ...tailArgs)`. If the handler is a known non-reactive bound method, the reference can be passed directly.

**Proposed change** in `buildEvents()`:

```typescript
// Before creating the arrow wrapper, check if handler is a known static method:
if (ctx.flags.WITH_TYPE_OPTIMIZATION && handlerArg.kind === 'path') {
  const hint = lookupTypeHint(ctx, handlerArg.expression, handlerArg.isArg);
  if (hint?.kind === 'function' && !hint.isTracked) {
    // Static method reference -- skip arrow wrapper
    const fnExpr = buildPathExpression(ctx, handlerArg, false);
    // Bind tail args if present
    if (tailArgs.length > 0) {
      const tailExprs = tailArgs.map(a => buildValue(ctx, a, ctxName));
      handlerExpr = B.methodCall(fnExpr, 'bind', [B.id('null'), ...tailExprs]);
    } else {
      handlerExpr = fnExpr;
    }
  }
}
```

**Status**: Deferred. Requires careful analysis of `this` binding semantics. Event handlers in class components must have the correct `this` context, and direct references may not preserve it.

---

### Step 4.2: Component Arg Optimization (Deferred)

**File**: `/Users/lifeart/Repos/glimmer-next/src/core/dom.ts`

**Description**: In `$_args()` (line 1301), when `IS_GLIMMER_COMPAT_MODE` is true, args are wrapped in a `Proxy` with `ArgProxyHandler`. If all arg types are known to be non-function primitives, the Proxy can be skipped.

**Proposed approach**: Add a new runtime function `$_args_static()` that bypasses the Proxy:

```typescript
export function $_args_static(
  args: Record<string, unknown>,
  slots: Record<string, () => Array<ComponentReturnType | Node>> | false,
  props: FwType,
) {
  // No Proxy wrapping -- all arg values are already unwrapped primitives
  Object.defineProperty(args, $SLOTS_SYMBOL, { value: slots ?? {}, enumerable: false });
  Object.defineProperty(args, $PROPS_SYMBOL, { value: props ?? {}, enumerable: false });
  return args;
}
```

The compiler would emit `$_args_static()` instead of `$_args()` when all args have primitive type hints.

**Status**: Deferred. Requires new runtime symbol, serializer changes, and careful testing of component lifecycle.

---

### Step 4.3: List Rendering Optimization (Deferred)

**Description**: When `$_each` items are primitives (e.g., `string[]`), a simpler update path could be used. When the array is `readonly`, the diff algorithm could be simplified.

**Status**: Deferred. Requires changes to `SyncListComponent` and `AsyncListComponent` in `/Users/lifeart/Repos/glimmer-next/src/core/control-flow/list.ts`.

---

### Step 4.4: Dead Branch Elimination (Deferred)

**Description**: When `{{if this.flag}}` has `this.flag` with `literalValue: false`, the entire if block could be eliminated at compile time.

**Proposed change** in visitors/block.ts (if block handling): Check `typeHints.properties[condition].literalValue` and skip emitting the `$_if()` call entirely.

**Status**: Deferred. Very narrow use case (compile-time constants). Risk of stale literal values.

---

## 6. Dependency Graph

```
Step 2.1: CompilerFlags (WITH_TYPE_OPTIMIZATION)
    |
    v
Step 2.2: TypeHints types + CompileOptions extension + SerializedValueBase.reactivity
    |
    v
Step 2.3: Store typeHints in CompilerContext
    |
    v
Step 2.4: type-hints.ts module (lookup + classification helpers)
    |
    +---> Step 2.5: Wire into buildPathExpression() -- CORE OPTIMIZATION
    |         |
    |         v
    |     Step 3.2: Visitor attaches reactivity hints
    |         |
    |         v
    |     Step 3.3: Helper return type optimization
    |
    +---> Step 2.7: Decorator analyzer (parallel path)
              |
              v
          Step 3.1: External .type-hints.json (Approach A) -- DEFERRED

Step 2.6: @staticProp decorator (INDEPENDENT, parallel)
    |
    v
Step 2.7: Decorator analyzer (feeds into Step 2.5)

Step 4.x: Advanced optimizations (ALL DEFERRED)
    - 4.1: Event handler optimization
    - 4.2: Component arg optimization
    - 4.3: List rendering optimization
    - 4.4: Dead branch elimination
```

### Implementation Order

1. **Step 2.1** -- Add flag (~15 min)
2. **Step 2.2** -- Add types (~30 min)
3. **Step 2.3** -- Wire context (~15 min)
4. **Step 2.4** -- Classification module (~1 hour)
5. **Step 2.5** -- Core optimization (~30 min)
6. **Step 2.6** -- @staticProp decorator (~30 min, can be parallel with 2.1-2.5)
7. **Step 2.7** -- Decorator analyzer (~1 hour, after 2.6)
8. **Step 3.2** -- Visitor classification (~30 min, after 2.5)
9. **Step 3.3** -- Helper return optimization (~30 min, after 2.5)
10. **Step 3.1** -- External hints tool (deferred)

Total estimated effort for Phase 2: ~4-5 hours.
Total estimated effort for Phase 3 (Steps 3.2, 3.3): ~1 hour.

---

## 7. Risk Matrix

| Step | Risk Level | Correctness Risk | Mitigation |
|---|---|---|---|
| 2.1 | None | None | Pure additive flag, defaults to false |
| 2.2 | None | None | Pure additive types, all optional |
| 2.3 | None | None | Only stores data, does not affect behavior |
| 2.4 | Low | Wrong classification -> stale UI | Conservative defaults: `unknown` for anything ambiguous |
| 2.5 | Medium | Skipping getter for reactive property -> UI does not update | Gate behind flag + hints. No hint = no change. Wrong hint = user error. |
| 2.6 | Low | None | Runtime no-op, purely compiler signal |
| 2.7 | Low | Regex miss -> property not optimized (safe) | False negatives are safe; false positives are unlikely with decorator regex |
| 3.2 | Low | Classification propagation | Same conservative defaults as 2.4 |
| 3.3 | Medium | Helper actually returns reactive value -> missed update | Only optimize when hint explicitly says `kind: 'primitive'` |
| 4.x | High | Various binding/lifecycle issues | All deferred |

### Critical Safety Rule

The system must follow this invariant:

> **If there is any doubt about reactivity, emit the getter wrapper.** Only skip it when the type hint explicitly provides enough information to classify the value as `'static'`.

This is enforced by `classifyReactivity()` returning `'unknown'` for:
- Missing hints (`undefined`)
- `kind: 'unknown'`
- `kind: 'object'` (could contain reactive references)
- `kind: 'function'` (could return reactive values)

Only `kind: 'primitive'` without `isTracked: true` produces `'static'`.

---

## Performance Validation

### Benchmark Test Approach

Create a benchmark that measures the actual performance impact of the optimization.

**File**: `/Users/lifeart/Repos/glimmer-next/plugins/compiler/__tests__/type-optimization-perf.test.ts`

```typescript
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

describe('Type optimization performance validation', () => {
  test('optimized code has fewer getter wrappers', () => {
    const template = `
      <div>
        {{this.a}} {{this.b}} {{this.c}} {{this.d}} {{this.e}}
        {{this.f}} {{this.g}} {{this.h}} {{this.i}} {{this.j}}
      </div>
    `;

    const defaultCode = compile(template).code;
    const optimizedCode = compile(template, {
      flags: { WITH_TYPE_OPTIMIZATION: true },
      typeHints: {
        properties: {
          'this.a': { kind: 'primitive', isReadonly: true },
          'this.b': { kind: 'primitive', isReadonly: true },
          'this.c': { kind: 'primitive', isReadonly: true },
          'this.d': { kind: 'primitive', isReadonly: true },
          'this.e': { kind: 'primitive', isReadonly: true },
          'this.f': { kind: 'primitive', isReadonly: true },
          'this.g': { kind: 'primitive', isReadonly: true },
          'this.h': { kind: 'primitive', isReadonly: true },
          'this.i': { kind: 'primitive', isReadonly: true },
          'this.j': { kind: 'primitive', isReadonly: true },
        },
      },
    }).code;

    // Count getter wrappers: () =>
    const defaultGetters = (defaultCode.match(/\(\)\s*=>/g) || []).length;
    const optimizedGetters = (optimizedCode.match(/\(\)\s*=>/g) || []).length;

    // Optimized should have fewer getters
    expect(optimizedGetters).toBeLessThan(defaultGetters);
    // All 10 properties should have their getters removed
    expect(defaultGetters - optimizedGetters).toBe(10);
  });

  test('optimized code is shorter', () => {
    const template = '<div>{{this.title}} {{this.subtitle}} {{this.description}}</div>';

    const defaultCode = compile(template).code;
    const optimizedCode = compile(template, {
      flags: { WITH_TYPE_OPTIMIZATION: true },
      typeHints: {
        properties: {
          'this.title': { kind: 'primitive', isReadonly: true },
          'this.subtitle': { kind: 'primitive', isReadonly: true },
          'this.description': { kind: 'primitive', isReadonly: true },
        },
      },
    }).code;

    // Optimized code should be shorter (no () => wrappers)
    expect(optimizedCode.length).toBeLessThan(defaultCode.length);
  });

  test('compile time does not significantly increase with type hints', () => {
    const template = '<div>{{this.a}} {{this.b}} {{this.c}}</div>';
    const options = {
      flags: { WITH_TYPE_OPTIMIZATION: true },
      typeHints: {
        properties: {
          'this.a': { kind: 'primitive' as const },
          'this.b': { kind: 'primitive' as const },
          'this.c': { kind: 'primitive' as const },
        },
      },
    };

    // Warm up
    compile(template);
    compile(template, options);

    // Measure default compilation
    const defaultStart = performance.now();
    for (let i = 0; i < 1000; i++) {
      compile(template);
    }
    const defaultTime = performance.now() - defaultStart;

    // Measure optimized compilation
    const optimizedStart = performance.now();
    for (let i = 0; i < 1000; i++) {
      compile(template, options);
    }
    const optimizedTime = performance.now() - optimizedStart;

    // Optimized compilation should not be more than 20% slower
    expect(optimizedTime).toBeLessThan(defaultTime * 1.2);
  });
});
```

### Runtime Performance Validation

Runtime performance can be measured by comparing the number of `MergedCell` allocations and `formula()` calls between optimized and unoptimized code. This requires integration tests that run the compiled output.

**Approach**: Create a component with many static bindings, render it, and count `DEBUG_MERGED_CELLS.size` before/after. The optimized version should have fewer `MergedCell` entries.

---

## Summary of All Files to Create or Modify

### New Files

| File | Purpose |
|---|---|
| `plugins/compiler/type-hints.ts` | Type hint lookup and reactivity classification |
| `plugins/compiler/__tests__/type-hints.test.ts` | Tests for classification module |
| `plugins/compiler/__tests__/type-optimization.test.ts` | End-to-end optimization tests |
| `plugins/compiler/__tests__/type-optimization-perf.test.ts` | Performance validation tests |
| `plugins/decorator-analyzer.ts` | Decorator detection from class source |
| `plugins/__tests__/decorator-analyzer.test.ts` | Tests for decorator analyzer |

### Modified Files

| File | Change |
|---|---|
| `plugins/compiler/types.ts` | Add `WITH_TYPE_OPTIMIZATION` flag, `ReactivityHint`, `PropertyTypeHint`, `TypeHints`, `CompileOptions.typeHints`, `SerializedValueBase.reactivity` |
| `plugins/compiler/context.ts` | Add `typeHints` to `CompilerContext` interface and `createContext()` |
| `plugins/compiler/serializers/value.ts` | Check `shouldSkipGetterWrapper()` in `buildPathExpression()`, helper return optimization in `buildValue()` |
| `plugins/compiler/visitors/mustache.ts` | Attach reactivity hints in `visitSimpleMustache()` |
| `src/core/reactive.ts` | Add `staticProp` decorator |
| `plugins/compiler/__tests__/types.test.ts` | Add tests for new flag and types |
| `plugins/compiler/__tests__/context.test.ts` | Add tests for typeHints in context |
| `plugins/compiler/__tests__/compile.test.ts` | Add literal inlining verification tests |

### Untouched Files (confirmed no changes needed)

| File | Reason |
|---|---|
| `plugins/compiler/compile.ts` | No changes -- `createContext()` already passes through all `CompileOptions` |
| `plugins/compiler/serializers/element.ts` | No changes in Phase 2-3 -- `buildTupleArray()` and `buildEvents()` use `buildValue()` which picks up the optimization |
| `plugins/compiler/serializers/symbols.ts` | No changes -- no new runtime symbols needed for Phase 2-3 |
| `plugins/compiler.ts` | No changes until Step 3.1 (external hints integration, deferred) |
| `src/core/dom.ts` | No changes -- runtime `resolveBindingValue()` already handles both getter-wrapped and direct values correctly |
