/**
 * ScopeTracker - Stack-based scope and binding management.
 *
 * Replaces the global `bindings` Set with proper scoped tracking.
 * Each scope can have its own bindings that shadow outer scopes.
 */

import type { BindingInfo, BindingKind, SourceRange } from '../types';

/**
 * Represents a single scope level.
 */
interface Scope {
  readonly bindings: Map<string, BindingInfo>;
  readonly name: string;  // For debugging (e.g., 'block', 'each', 'let')
}

/**
 * Stack-based scope tracker for managing bindings.
 *
 * @example
 * ```typescript
 * const tracker = new ScopeTracker();
 *
 * // Add component bindings at root level
 * tracker.addBinding('MyComponent', { kind: 'component', name: 'MyComponent' });
 *
 * // Enter a block scope
 * tracker.enterScope('each');
 * tracker.addBinding('item', { kind: 'block-param', name: 'item' });
 *
 * // Resolve bindings (walks scope chain)
 * tracker.resolve('item');        // { kind: 'block-param', ... }
 * tracker.resolve('MyComponent'); // { kind: 'component', ... }
 *
 * // Exit scope (removes block-param bindings)
 * tracker.exitScope();
 * tracker.resolve('item');        // undefined
 * ```
 */
export class ScopeTracker {
  private readonly scopes: Scope[] = [];
  private readonly lexicalScope?: (variable: string) => boolean;

  constructor(initialBindings?: ReadonlySet<string>, lexicalScope?: (variable: string) => boolean) {
    this.lexicalScope = lexicalScope;
    // Always start with a root scope
    this.scopes.push({
      bindings: new Map(),
      name: 'root',
    });

    // Add initial bindings (typically component imports)
    if (initialBindings) {
      for (const name of initialBindings) {
        this.addBinding(name, {
          kind: 'component',
          name,
        });
      }
    }
  }

  /**
   * Enter a new scope level.
   */
  enterScope(name: string): void {
    this.scopes.push({
      bindings: new Map(),
      name,
    });
  }

  /**
   * Exit the current scope level.
   * @throws Error if trying to exit the root scope.
   */
  exitScope(): void {
    if (this.scopes.length <= 1) {
      throw new Error('Cannot exit root scope');
    }
    this.scopes.pop();
  }

  /**
   * Add a binding to the current scope.
   */
  addBinding(name: string, info: BindingInfo): void {
    this.currentScope.bindings.set(name, info);
  }

  /**
   * Add multiple bindings to the current scope.
   */
  addBindings(bindings: Iterable<[string, BindingInfo]>): void {
    for (const [name, info] of bindings) {
      this.addBinding(name, info);
    }
  }

  /**
   * Remove a binding from the current scope.
   */
  removeBinding(name: string): boolean {
    return this.currentScope.bindings.delete(name);
  }

  /**
   * Resolve a binding by walking the scope chain from innermost to outermost.
   * @returns The binding info if found, undefined otherwise.
   */
  resolve(name: string): BindingInfo | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const binding = this.scopes[i].bindings.get(name);
      if (binding) {
        return binding;
      }
    }

    // Fallback to lexical scope (variables from the surrounding module)
    if (this.lexicalScope && this.lexicalScope(name)) {
      return {
        kind: 'component', // Treating as component/helper by default for resolution
        name,
      };
    }

    return undefined;
  }

  /**
   * Check if a name is bound in any scope.
   */
  hasBinding(name: string): boolean {
    return this.resolve(name) !== undefined;
  }

  /**
   * Check if a name is bound in the current scope (not parent scopes).
   */
  hasLocalBinding(name: string): boolean {
    return this.currentScope.bindings.has(name);
  }

  /**
   * Get all bindings visible from the current scope.
   * Inner bindings shadow outer bindings with the same name.
   */
  getAllBindings(): Map<string, BindingInfo> {
    const result = new Map<string, BindingInfo>();

    // Walk from outermost to innermost so inner shadows outer
    for (const scope of this.scopes) {
      for (const [name, info] of scope.bindings) {
        result.set(name, info);
      }
    }

    return result;
  }

  /**
   * Get all binding names visible from the current scope.
   */
  getAllBindingNames(): Set<string> {
    return new Set(this.getAllBindings().keys());
  }

  /**
   * Get the current scope depth (0 = root).
   */
  get depth(): number {
    return this.scopes.length - 1;
  }

  /**
   * Get the current scope name.
   */
  get currentScopeName(): string {
    return this.currentScope.name;
  }

  /**
   * Execute a function within a new scope.
   * The scope is automatically exited when the function returns.
   */
  withScope<T>(name: string, fn: () => T): T {
    this.enterScope(name);
    try {
      return fn();
    } finally {
      this.exitScope();
    }
  }

  /**
   * Execute a function with temporary bindings in the current scope.
   * The bindings are removed when the function returns.
   */
  withBindings<T>(
    bindings: Iterable<[string, BindingInfo]>,
    fn: () => T
  ): T {
    const names: string[] = [];

    for (const [name, info] of bindings) {
      this.addBinding(name, info);
      names.push(name);
    }

    try {
      return fn();
    } finally {
      for (const name of names) {
        this.removeBinding(name);
      }
    }
  }

  /**
   * Create block parameter bindings.
   */
  createBlockParams(
    params: readonly string[],
    sourceRange?: SourceRange
  ): Array<[string, BindingInfo]> {
    return params.map((name, _index) => [
      name,
      {
        kind: 'block-param' as BindingKind,
        name,
        sourceRange,
      },
    ]);
  }

  private get currentScope(): Scope {
    return this.scopes[this.scopes.length - 1];
  }
}

/**
 * Create a new scope tracker with optional initial bindings.
 */
export function createScopeTracker(
  initialBindings?: ReadonlySet<string>,
  lexicalScope?: (variable: string) => boolean
): ScopeTracker {
  return new ScopeTracker(initialBindings, lexicalScope);
}
