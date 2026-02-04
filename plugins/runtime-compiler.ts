/**
 * Runtime Compiler for GXT
 *
 * This module provides a browser-compatible template compiler that can compile
 * Glimmer/Handlebars templates to GXT-compatible JavaScript at runtime.
 *
 * Usage:
 * ```typescript
 * import { template } from '@lifeart/gxt/runtime-compiler';
 * import { Component } from '@lifeart/gxt';
 * import { $template } from '@lifeart/gxt/shared';
 *
 * // As a class template property:
 * class MyComponent extends Component {
 *   name = 'World';
 *   [$template] = template('<div>Hello {{this.name}}</div>');
 * }
 *
 * // As a template-only component (no class needed):
 * const Greeting = template('<div>Hello {{@name}}!</div>');
 *
 * // With child components in scope:
 * const Badge = template('<span class="badge">{{@label}}</span>');
 * const Card = template('<div class="card"><Badge @label={{@title}} /></div>', {
 *   scope: { Badge }
 * });
 *
 * // With dynamic eval for unknown bindings:
 * const name = 'World';
 * const DynamicComponent = template(dynamicTemplateString, {
 *   eval() {
 *     return eval(arguments[0]);
 *   }
 * });
 * ```
 *
 * ## Security Warning
 *
 * The `eval` option should only be used with trusted template strings.
 * Using eval with untrusted input is a security risk.
 */

import { compile as compilerCompile, type CompileOptions, type CompileResult } from './compiler/index';
import { SYMBOLS, CONSTANTS, EVENT_TYPE } from './symbols';
import { type Flags } from './flags';

// Re-export types
export type { CompileOptions, CompileResult, Flags };
export { SYMBOLS, CONSTANTS, EVENT_TYPE };

// Import GXT runtime primitives from dom.ts
import {
  $_tag,
  $_c,
  $_if,
  $_each,
  $_eachSync,
  $_slot,
  $_edp,
  $_args,
  $_api,
  $_dc,
  $_TO_VALUE,
  $_GET_SLOTS,
  $_GET_ARGS,
  $_GET_FW,
  $_componentHelper,
  $_modifierHelper,
  $_helperHelper,
  $_hasBlockParams,
  $_hasBlock,
  $_maybeHelper,
  $_maybeModifier,
  $_inElement,
  $_ucw,
  $_fin,
  $_HTMLProvider,
  $_SVGProvider,
  $_MathMLProvider,
  $SLOTS_SYMBOL,
  $PROPS_SYMBOL,
} from '../src/core/dom';

// Import helper functions
import {
  $__if,
  $__eq,
  $__not,
  $__debugger,
  $__log,
  $__array,
  $__hash,
  $__fn,
  $__or,
  $__and,
} from '../src/core/helpers/index';

/**
 * All GXT runtime symbols that need to be available globally for compiled templates
 */
export const GXT_RUNTIME_SYMBOLS = {
  $_tag,
  $_c,
  $_if,
  $_each,
  $_eachSync,
  $_slot,
  $_edp,
  $_args,
  $_api,
  $_dc,
  $_TO_VALUE,
  $_GET_SLOTS,
  $_GET_ARGS,
  $_GET_FW,
  $_componentHelper,
  $_modifierHelper,
  $_helperHelper,
  $_hasBlockParams,
  $_hasBlock,
  $_maybeHelper,
  $_maybeModifier,
  $_inElement,
  $_ucw,
  $_fin,
  $__if,
  $__eq,
  $__not,
  $__debugger,
  $__log,
  $__array,
  $__hash,
  $__fn,
  $__or,
  $__and,
  $_HTMLProvider,
  $_SVGProvider,
  $_MathMLProvider,
};

/**
 * Setup global scope with all GXT runtime symbols.
 * This must be called once before using compiled templates.
 */
export function setupGlobalScope(): void {
  const g = globalThis as any;

  // Expose all symbols globally
  Object.entries(GXT_RUNTIME_SYMBOLS).forEach(([name, value]) => {
    g[name] = value;
  });

  // Also set the symbol constants for scope access
  // Import from dom.ts to ensure consistency with the runtime
  g.$SLOTS_SYMBOL = $SLOTS_SYMBOL;
  g.$PROPS_SYMBOL = $PROPS_SYMBOL;
  // $args is a string constant 'args', not a Symbol - must match shared.ts
  g.$args = 'args';

  // Mark that global scope is set up
  g.__GXT_RUNTIME_INITIALIZED__ = true;
}

/**
 * Check if global scope is already set up
 */
export function isGlobalScopeReady(): boolean {
  return (globalThis as any).__GXT_RUNTIME_INITIALIZED__ === true;
}

/**
 * Compile options for runtime compilation
 */
export interface RuntimeCompileOptions {
  /** Module name for debugging */
  moduleName?: string;
  /** Whether to use strict mode */
  strictMode?: boolean;
  /** Known bindings (component/helper names in scope) */
  bindings?: Set<string>;
  /** Compiler flags */
  flags?: Partial<Flags>;
  /** Scope values to make available in the template */
  scopeValues?: Record<string, unknown>;
}

/**
 * Result of runtime template compilation
 */
export interface RuntimeCompileResult {
  /** The compiled template function */
  templateFn: (this: any, ...args: any[]) => any;
  /** The generated JavaScript code (for debugging) */
  code: string;
  /** Any compilation errors */
  errors: CompileResult['errors'];
  /** Any compilation warnings */
  warnings: CompileResult['warnings'];
}

/**
 * Compile a template string to an executable function at runtime.
 *
 * @param template - The template string to compile
 * @param options - Compilation options
 * @returns The compiled result with template function and metadata
 */
export function compileTemplate(
  template: string,
  options: RuntimeCompileOptions = {}
): RuntimeCompileResult {
  // Ensure global scope is ready
  if (!isGlobalScopeReady()) {
    setupGlobalScope();
  }

  // Merge flags with defaults for runtime
  const flags: Partial<Flags> = {
    IS_GLIMMER_COMPAT_MODE: true,
    WITH_EMBER_INTEGRATION: true,
    WITH_HELPER_MANAGER: true,
    WITH_MODIFIER_MANAGER: true,
    WITH_CONTEXT_API: true,
    TRY_CATCH_ERROR_HANDLING: false,
    ...options.flags,
  };

  // Compile the template
  const compileOptions: CompileOptions = {
    filename: options.moduleName || 'runtime-template',
    bindings: options.bindings || new Set(),
    flags,
  };

  const result = compilerCompile(template, compileOptions);

  // Check for errors
  if (result.errors.length > 0) {
    console.error('[gxt-runtime-compiler] Compilation errors:', result.errors);
    return {
      templateFn: () => [],
      code: result.code,
      errors: result.errors,
      warnings: result.warnings,
    };
  }

  // Create the template function by evaluating the generated code
  // The code is an array expression like [$_tag('div', ...), ...]
  let templateFn: RuntimeCompileResult['templateFn'];

  try {
    // Build scope for the function
    const scopeVars = options.scopeValues || {};
    const scopeNames = Object.keys(scopeVars);
    const scopeValuesList = Object.values(scopeVars);

    // Validate scope names to prevent code injection via new Function()
    const validIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
    for (const name of scopeNames) {
      if (!validIdentifier.test(name)) {
        throw new Error(`[gxt-runtime-compiler] Invalid scope name: "${name}". Scope names must be valid JavaScript identifiers.`);
      }
    }

    // Create function that returns the compiled template array
    // We wrap it in a function that has access to both GXT symbols and scope values
    const fnBody = `
      "use strict";
      return function() {
        return ${result.code};
      };
    `;

    // Create the function with scope
    const createFn = new Function(...scopeNames, fnBody);
    templateFn = createFn(...scopeValuesList);

  } catch (evalError: any) {
    console.error('[gxt-runtime-compiler] Failed to create template function:', evalError);
    console.error('[gxt-runtime-compiler] Generated code:', result.code);

    return {
      templateFn: () => [],
      code: result.code,
      errors: [{
        message: `Failed to create template function: ${evalError.message}`,
        code: 'RUNTIME_EVAL_ERROR',
      } as any],
      warnings: result.warnings,
    };
  }

  return {
    templateFn,
    code: result.code,
    errors: result.errors,
    warnings: result.warnings,
  };
}

/**
 * Compile a template and return just the function.
 * Throws on compilation errors.
 *
 * @param template - The template string to compile
 * @param options - Compilation options
 * @returns The compiled template function
 */
export function compile(
  template: string,
  options: RuntimeCompileOptions = {}
): (this: any, ...args: any[]) => any {
  const result = compileTemplate(template, options);

  if (result.errors.length > 0) {
    const errorMsg = result.errors.map(e => e.message).join('\n');
    throw new Error(`Template compilation failed:\n${errorMsg}`);
  }

  return result.templateFn;
}

/**
 * Options for creating a scoped compiler
 */
export interface CreateCompilerOptions extends Omit<RuntimeCompileOptions, 'scopeValues'> {
  /** Whether to throw on compilation errors (default: true) */
  throwOnError?: boolean;
}

/**
 * A compiler function bound to a specific scope.
 * All templates compiled with this function can reference the bound scope values.
 */
export interface ScopedCompiler {
  /**
   * Compile a template with access to the bound scope.
   * @param template - The template string to compile
   * @param options - Additional compilation options (merged with factory options)
   * @returns The compiled template function
   */
  (template: string, options?: Partial<CreateCompilerOptions>): (this: any, ...args: any[]) => any;

  /**
   * Compile a template and return full result with metadata.
   * @param template - The template string to compile
   * @param options - Additional compilation options
   * @returns The full compilation result
   */
  withMeta(template: string, options?: Partial<CreateCompilerOptions>): RuntimeCompileResult;

  /**
   * The scope values bound to this compiler
   */
  readonly scope: Readonly<Record<string, unknown>>;

  /**
   * Add additional values to the scope.
   * Returns a new compiler with the extended scope (immutable).
   */
  extend(additionalScope: Record<string, unknown>): ScopedCompiler;
}

/**
 * Create a compiler factory bound to a specific scope.
 *
 * This is the recommended way to compile multiple templates that share
 * the same component/helper bindings. The scope is captured once at
 * creation time, and all templates compiled with this compiler can
 * reference those bindings.
 *
 * @example
 * ```typescript
 * import { createCompiler } from '@lifeart/gxt/runtime-compiler';
 * import { Button, Card, formatDate } from './components';
 *
 * // Create compiler with scope - bindings are captured here
 * const compile = createCompiler({
 *   Button,
 *   Card,
 *   formatDate,
 * });
 *
 * // All templates can use Button, Card, formatDate
 * const buttonTemplate = compile('<Button @onClick={{this.handleClick}} />');
 * const cardTemplate = compile('<Card @title={{formatDate(this.date)}} />');
 *
 * // Extend scope for additional bindings
 * const extendedCompile = compile.extend({ Modal, Dialog });
 * const modalTemplate = extendedCompile('<Modal><Button /></Modal>');
 * ```
 *
 * @param scopeValues - Object containing components, helpers, and other values
 *                      that should be available in compiled templates
 * @param baseOptions - Default compilation options for all templates
 * @returns A scoped compiler function
 */
export function createCompiler(
  scopeValues: Record<string, unknown>,
  baseOptions: CreateCompilerOptions = {}
): ScopedCompiler {
  const { throwOnError = true, ...compileOptions } = baseOptions;

  // Pre-compute binding names from scope (done once at factory creation)
  const scopeKeys = Object.keys(scopeValues);
  const baseBindings = compileOptions.bindings
    ? [...compileOptions.bindings, ...scopeKeys]
    : scopeKeys;

  // Freeze scope once at creation time
  const frozenScope = Object.freeze({ ...scopeValues });

  // Shared helper to merge options (eliminates duplication)
  function mergeOptions(options: Partial<CreateCompilerOptions>): RuntimeCompileOptions {
    const additionalBindings = options.bindings;
    const additionalScopeValues = (options as RuntimeCompileOptions).scopeValues;

    return {
      ...compileOptions,
      ...options,
      // Only create new Set if additional bindings provided
      bindings: additionalBindings
        ? new Set([...baseBindings, ...additionalBindings])
        : new Set(baseBindings),
      // Only spread if additional scope values provided
      scopeValues: additionalScopeValues
        ? { ...scopeValues, ...additionalScopeValues }
        : scopeValues,
    };
  }

  function scopedCompile(
    template: string,
    options: Partial<CreateCompilerOptions> = {}
  ): (this: any, ...args: any[]) => any {
    const result = compileTemplate(template, mergeOptions(options));

    const shouldThrow = options.throwOnError ?? throwOnError;
    if (shouldThrow && result.errors.length > 0) {
      const errorMsg = result.errors.map(e => e.message).join('\n');
      throw new Error(`Template compilation failed:\n${errorMsg}`);
    }

    return result.templateFn;
  }

  // Add withMeta method for full result access
  scopedCompile.withMeta = function(
    template: string,
    options: Partial<CreateCompilerOptions> = {}
  ): RuntimeCompileResult {
    return compileTemplate(template, mergeOptions(options));
  };

  // Add scope property for introspection (already frozen)
  Object.defineProperty(scopedCompile, 'scope', {
    value: frozenScope,
    writable: false,
    enumerable: true,
  });

  // Add extend method for creating extended compilers
  scopedCompile.extend = function(
    additionalScope: Record<string, unknown>
  ): ScopedCompiler {
    return createCompiler(
      { ...scopeValues, ...additionalScope },
      baseOptions
    );
  };

  return scopedCompile as ScopedCompiler;
}

/**
 * Create a template factory that can be used like Ember's template factories.
 * Returns an object with a render method.
 *
 * @param template - The template string to compile
 * @param options - Compilation options
 * @returns A template factory object
 */
export function createTemplateFactory(
  template: string,
  options: RuntimeCompileOptions = {}
): {
  __gxtCompiled: true;
  __gxtRuntimeCompiled: true;
  moduleName: string;
  render: (context: any, target: Element) => { nodes: Node[]; ctx: any };
} {
  const result = compileTemplate(template, options);
  const moduleName = options.moduleName || 'runtime-template';

  return {
    __gxtCompiled: true,
    __gxtRuntimeCompiled: true,
    moduleName,
    render(context: any, target: Element) {
      if (result.errors.length > 0) {
        console.error(`[gxt-runtime] Compilation errors for ${moduleName}:`, result.errors);
        return { nodes: [], ctx: context };
      }

      try {
        // Call the template function with context as 'this'
        const nodes = result.templateFn.call(context);

        // Append nodes to target if provided
        if (target && Array.isArray(nodes)) {
          for (const node of nodes) {
            if (node instanceof Node) {
              target.appendChild(node);
            } else if (node && typeof node === 'object' && '$nodes' in node) {
              // GXT template result
              for (const n of (node as any).$nodes || []) {
                if (n instanceof Node) {
                  target.appendChild(n);
                }
              }
            }
          }
        }

        return { nodes: Array.isArray(nodes) ? nodes : [], ctx: context };
      } catch (renderError: any) {
        console.error(`[gxt-runtime] Render error for ${moduleName}:`, renderError);
        return { nodes: [], ctx: context };
      }
    },
  };
}

// NOTE: Auto-setup has been removed to avoid side effects on module import.
// Consumers should call setupGlobalScope() explicitly, or rely on
// compileTemplate()'s lazy initialization (see lines 189-191).

// Constants matching shared.ts - used for template components
const $template = 'template' as const;
const $args = 'args' as const;

/**
 * Options for template function
 */
export interface TemplateOptions extends RuntimeCompileOptions {
  /** Components, helpers, and other values to make available in the template scope */
  scope?: Record<string, unknown>;
  /**
   * Dynamic scope access for unknown bindings. Allows templates to access
   * variables from the outer JavaScript scope without explicitly listing them.
   *
   * WARNING: Only use with trusted template strings. Using eval with untrusted
   * input is a security risk.
   *
   * @example
   * ```typescript
   * const name = 'World';
   * const MyComponent = template(dynamicTemplateString, {
   *   eval() {
   *     return eval(arguments[0]);
   *   }
   * });
   * ```
   *
   * Note: Use `arguments[0]` instead of a named parameter to avoid shadowing
   * variables that the template might be trying to access.
   */
  eval?: (...args: string[]) => unknown;
}

/**
 * Creates a universal template that works both as a class template property
 * and as a standalone template-only component.
 *
 * @example
 * ```typescript
 * import { template } from '@lifeart/gxt/runtime-compiler';
 * import { Component } from '@lifeart/gxt';
 * import { $template } from '@lifeart/gxt/shared';
 *
 * // As a class template:
 * class MyComponent extends Component {
 *   name = 'World';
 *   [$template] = template('<div>Hello {{this.name}}</div>');
 * }
 *
 * // As a template-only component:
 * const Greeting = template('<div>Hello {{@name}}!</div>');
 *
 * // With nested components:
 * const Badge = template('<span class="badge">{{@label}}</span>');
 * const Card = template('<div class="card"><Badge @label={{@title}} /></div>', {
 *   scope: { Badge }
 * });
 *
 * // Class using template-only child:
 * class Parent extends Component {
 *   [$template] = template('<Card @title={{this.title}} />', { scope: { Card } });
 * }
 * ```
 *
 * @param templateSource - The template string to compile
 * @param options - Optional compilation options including scope
 * @returns A universal template function
 */
export function template(
  templateSource: string,
  options?: TemplateOptions
): any {
  const { scope, eval: evalOption, ...restOptions } = options || {};

  // Merge scope into scopeValues and bindings
  const scopeKeys = scope ? Object.keys(scope) : [];
  const mergedOptions: RuntimeCompileOptions = {
    ...restOptions,
    scopeValues: scope ? { ...restOptions.scopeValues, ...scope } : restOptions.scopeValues,
    bindings: scopeKeys.length > 0
      ? new Set([...(restOptions.bindings || []), ...scopeKeys])
      : restOptions.bindings,
    flags: {
      IS_GLIMMER_COMPAT_MODE: true,
      ...restOptions.flags,
      // Enable eval support only when eval option is provided (reduces bundle size otherwise)
      // Applied after spread to ensure eval option always takes precedence
      ...(evalOption ? { WITH_EVAL_SUPPORT: true } : {}),
    },
  };

  const result = compileTemplate(templateSource, mergedOptions);
  if (result.errors.length > 0) {
    const errorMsg = result.errors.map(e => e.message).join('\n');
    throw new Error(`Template compilation failed:\n${errorMsg}`);
  }
  const fn = result.templateFn;

  // Extract eval function from options
  const evalFn = evalOption;

  /**
   * Universal template function:
   * - When called with `this` context (as [$template] on a class): renders the template
   * - When called without `this` (as a factory): creates a template-only instance
   */
  function universalTemplate(this: any, args?: Record<string, unknown>, _fw?: unknown) {
    // If called with 'this' context, render the template
    if (this) {
      // Store eval function on the component instance for deferred rendering
      // (e.g., when {{#if}} becomes true later). This is accessed via this.$_eval
      // Note: Can't set on this[$args] because it's a Proxy that may reject new properties
      if (evalFn) {
        this.$_eval = evalFn;
      }
      // Set eval function for this render (save previous for nested templates)
      const prevEval = (globalThis as any).$_eval;
      // Always set (or clear) eval for this template - don't inherit from parent
      (globalThis as any).$_eval = evalFn;
      try {
        return $_fin(fn.call(this), this);
      } finally {
        // Restore previous eval function
        (globalThis as any).$_eval = prevEval;
      }
    }

    // Otherwise, create a template-only component instance
    // Store eval function on instance for deferred rendering
    const instance = {
      [$template]: universalTemplate,
      [$args]: args || {},
      $_eval: evalFn, // Store eval function for deferred rendering
    };
    return instance;
  }

  // Remove prototype so $_c treats this as a factory function, not a class
  (universalTemplate as any).prototype = undefined;
  // Mark as template for debugging
  (universalTemplate as any).__templateOnly = true;

  return universalTemplate;
}

