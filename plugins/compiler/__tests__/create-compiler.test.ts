/**
 * Tests for the createCompiler factory function.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  createCompiler,
  setupGlobalScope,
} from '../../runtime-compiler';

describe('createCompiler', () => {
  beforeEach(() => {
    setupGlobalScope();
  });

  describe('basic usage', () => {
    test('creates a compiler bound to scope', () => {
      const MyComponent = { name: 'MyComponent' };

      const compile = createCompiler({ MyComponent });

      expect(typeof compile).toBe('function');
      expect(compile.scope).toEqual({ MyComponent });
    });

    test('compiled templates can access scope values', () => {
      const greeting = 'Hello';
      const compile = createCompiler({ greeting });

      // The template references 'greeting' which is in scope
      const result = compile.withMeta('greeting');

      expect(result.errors).toHaveLength(0);
      // The code should reference greeting as an identifier, not a string
      expect(result.code).toContain('greeting');
    });

    test('scope values are used as bindings', () => {
      const Button = { type: 'button' };
      const Card = { type: 'card' };

      const compile = createCompiler({ Button, Card });

      // Button should be recognized as a known binding
      const result = compile.withMeta('<Button />');

      expect(result.errors).toHaveLength(0);
      // Should use Button as component, not as string
      expect(result.code).toContain('Button');
    });

    test('throws on compilation errors by default', () => {
      const compile = createCompiler({});

      expect(() => {
        compile('<div><span></div>'); // Mismatched tags
      }).toThrow('Template compilation failed');
    });

    test('can disable throwing on errors', () => {
      const compile = createCompiler({}, { throwOnError: false });

      const templateFn = compile('<div><span></div>');

      // Should return a function even with errors
      expect(typeof templateFn).toBe('function');
    });
  });

  describe('withMeta method', () => {
    test('returns full compilation result', () => {
      const compile = createCompiler({ MyHelper: () => 'test' });

      const result = compile.withMeta('<div>{{MyHelper}}</div>');

      expect(result).toHaveProperty('code');
      expect(result).toHaveProperty('templateFn');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
    });

    test('includes generated code for debugging', () => {
      const compile = createCompiler({});

      const result = compile.withMeta('<div class="test">Hello</div>');

      expect(result.code).toContain('$_tag');
      expect(result.code).toContain('div');
      expect(result.code).toContain('test');
    });
  });

  describe('scope property', () => {
    test('exposes the bound scope', () => {
      const Button = { render: () => 'btn' };
      const helper = (x: number) => x * 2;

      const compile = createCompiler({ Button, helper });

      expect(compile.scope).toEqual({ Button, helper });
    });

    test('scope is frozen (immutable)', () => {
      const compile = createCompiler({ foo: 'bar' });

      expect(Object.isFrozen(compile.scope)).toBe(true);

      // Attempting to modify should fail silently or throw in strict mode
      expect(() => {
        (compile.scope as any).foo = 'baz';
      }).toThrow();
    });
  });

  describe('extend method', () => {
    test('creates new compiler with extended scope', () => {
      const Button = { type: 'button' };
      const compile = createCompiler({ Button });

      const Card = { type: 'card' };
      const extendedCompile = compile.extend({ Card });

      // Original compiler doesn't have Card
      expect(compile.scope).toEqual({ Button });

      // Extended compiler has both
      expect(extendedCompile.scope).toEqual({ Button, Card });
    });

    test('extended compiler is independent', () => {
      const compile = createCompiler({ a: 1 });
      const extended1 = compile.extend({ b: 2 });
      const extended2 = compile.extend({ c: 3 });

      expect(compile.scope).toEqual({ a: 1 });
      expect(extended1.scope).toEqual({ a: 1, b: 2 });
      expect(extended2.scope).toEqual({ a: 1, c: 3 });
    });

    test('can chain extend calls', () => {
      const compile = createCompiler({ a: 1 })
        .extend({ b: 2 })
        .extend({ c: 3 });

      expect(compile.scope).toEqual({ a: 1, b: 2, c: 3 });
    });

    test('extended scope can override values', () => {
      const compile = createCompiler({ value: 'original' });
      const extended = compile.extend({ value: 'overridden' });

      expect(compile.scope.value).toBe('original');
      expect(extended.scope.value).toBe('overridden');
    });
  });

  describe('options merging', () => {
    test('base options are used for all compilations', () => {
      const compile = createCompiler({}, {
        moduleName: 'test-module',
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      const result = compile.withMeta('<div>{{@name}}</div>');

      expect(result.errors).toHaveLength(0);
      // @name should work in compat mode
      expect(result.code).toContain('$args');
    });

    test('per-template options override base options', () => {
      const compile = createCompiler({}, { throwOnError: true });

      // Override throwOnError for this specific compilation
      const templateFn = compile('<div><span></div>', { throwOnError: false });

      expect(typeof templateFn).toBe('function');
    });

    test('additional bindings can be added per-template', () => {
      const compile = createCompiler({ Button: {} });

      // Add Card as a binding for just this template
      const result = compile.withMeta('<Card />', {
        bindings: new Set(['Card']),
      });

      expect(result.errors).toHaveLength(0);
    });
  });

  describe('real-world usage patterns', () => {
    test('component library pattern', () => {
      // Simulate a component library
      const components = {
        Button: { __component: true },
        Input: { __component: true },
        Card: { __component: true },
        Modal: { __component: true },
      };

      const helpers = {
        formatDate: (d: Date) => d.toISOString(),
        capitalize: (s: string) => s.charAt(0).toUpperCase() + s.slice(1),
      };

      // Create compiler with all library exports
      const compile = createCompiler({ ...components, ...helpers });

      // Templates can use any of them
      const t1 = compile.withMeta('<Button />');
      const t2 = compile.withMeta('<Card><Input /></Card>');

      expect(t1.errors).toHaveLength(0);
      expect(t2.errors).toHaveLength(0);
    });

    test('app-specific extensions', () => {
      // Base library compiler
      const libCompile = createCompiler({
        Button: {},
        Input: {},
      });

      // App extends with custom components
      const appCompile = libCompile.extend({
        CustomHeader: {},
        CustomFooter: {},
      });

      // Feature module extends further
      const featureCompile = appCompile.extend({
        FeatureWidget: {},
      });

      expect(Object.keys(featureCompile.scope)).toEqual([
        'Button',
        'Input',
        'CustomHeader',
        'CustomFooter',
        'FeatureWidget',
      ]);
    });

    test('multiple independent compilers', () => {
      // Different modules can have different scopes
      const adminCompile = createCompiler({
        AdminPanel: {},
        UserList: {},
      });

      const publicCompile = createCompiler({
        PublicPage: {},
        LoginForm: {},
      });

      // Each compiler only knows its own scope
      expect(Object.keys(adminCompile.scope)).toEqual(['AdminPanel', 'UserList']);
      expect(Object.keys(publicCompile.scope)).toEqual(['PublicPage', 'LoginForm']);
    });
  });
});
