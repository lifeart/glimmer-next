import { describe, test, expect } from 'vitest';
import {
  compileTemplate,
  compile,
  createTemplateFactory,
  setupGlobalScope,
  isGlobalScopeReady,
  GXT_RUNTIME_SYMBOLS,
} from '../../runtime-compiler';

describe('Runtime Compiler', () => {
  describe('setupGlobalScope', () => {
    test('sets up global scope correctly', () => {
      setupGlobalScope();
      expect(isGlobalScopeReady()).toBe(true);
    });

    test('exposes all GXT runtime symbols', () => {
      setupGlobalScope();
      const g = globalThis as any;

      // Check a few key symbols are exposed
      expect(typeof g.$_tag).toBe('function');
      expect(typeof g.$_c).toBe('function');
      expect(typeof g.$_if).toBe('function');
      expect(typeof g.$_each).toBe('function');
    });
  });

  describe('compileTemplate', () => {
    test('compiles simple template', () => {
      const result = compileTemplate('<div>Hello</div>');

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('$_tag');
      expect(result.code).toContain('div');
      expect(typeof result.templateFn).toBe('function');
    });

    test('compiles template with mustache expression', () => {
      const result = compileTemplate('<div>{{this.name}}</div>');

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('this.name');
    });

    test('compiles template with component invocation', () => {
      const result = compileTemplate('<MyComponent @value={{this.data}} />', {
        bindings: new Set(['MyComponent']),
      });

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('MyComponent');
    });

    test('returns errors for invalid template syntax', () => {
      // Unclosed tag should cause a parse error
      const result = compileTemplate('<div><span></div>');

      // Malformed templates should report errors
      expect(result.errors.length).toBeGreaterThan(0);
      // But should still return a template function (graceful handling)
      expect(typeof result.templateFn).toBe('function');
    });

    test('respects compiler flags', () => {
      const result = compileTemplate('<div {{myModifier}}></div>', {
        bindings: new Set(['myModifier']),
        flags: { WITH_MODIFIER_MANAGER: true },
      });

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('$_maybeModifier');
    });
  });

  describe('compile', () => {
    test('returns template function directly', () => {
      const fn = compile('<div>Test</div>');
      expect(typeof fn).toBe('function');
    });

    test('returns function even for unusual templates', () => {
      // The compiler is lenient with many edge cases
      // Verify it returns a function regardless
      const fn = compile('<div>{{#if this.cond}}content{{/if}}</div>');
      expect(typeof fn).toBe('function');
    });
  });

  describe('createTemplateFactory', () => {
    test('returns factory object with correct shape', () => {
      const factory = createTemplateFactory('<div>Hello</div>');

      expect(factory.__gxtCompiled).toBe(true);
      expect(factory.__gxtRuntimeCompiled).toBe(true);
      expect(typeof factory.render).toBe('function');
      expect(typeof factory.moduleName).toBe('string');
    });

    test('respects custom module name', () => {
      const factory = createTemplateFactory('<div>Hello</div>', {
        moduleName: 'my-custom-template',
      });

      expect(factory.moduleName).toBe('my-custom-template');
    });
  });

  describe('GXT_RUNTIME_SYMBOLS', () => {
    test('contains all required runtime functions', () => {
      const requiredSymbols = [
        '$_tag',
        '$_c',
        '$_if',
        '$_each',
        '$_slot',
        '$_componentHelper',
        '$_helperHelper',
        '$_modifierHelper',
        '$_maybeHelper',
        '$_maybeModifier',
        '$__if',
        '$__eq',
        '$__not',
      ];

      for (const symbol of requiredSymbols) {
        expect(GXT_RUNTIME_SYMBOLS).toHaveProperty(symbol);
        expect(typeof (GXT_RUNTIME_SYMBOLS as any)[symbol]).toBe('function');
      }
    });
  });
});
