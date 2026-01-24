import { describe, test, expect, beforeEach } from 'vitest';
import {
  createContext,
  addError,
  addWarning,
  nextContextName,
  resetContextCounter,
  withElementContext,
  isKnownBinding,
  resolveBinding,
  getAllBindingNames,
  initializeVisitors,
  setSerializeChildFunction,
  type CompilerContext,
  type VisitFn,
  type VisitChildrenFn,
} from '../context';
import { DEFAULT_FLAGS } from '../types';

describe('CompilerContext', () => {
  let ctx: CompilerContext;

  beforeEach(() => {
    ctx = createContext('<div>Hello</div>');
  });

  describe('createContext', () => {
    test('creates context with default flags', () => {
      expect(ctx.flags).toEqual(DEFAULT_FLAGS);
    });

    test('creates context with custom flags', () => {
      ctx = createContext('<div />', {
        flags: { IS_GLIMMER_COMPAT_MODE: false },
      });
      expect(ctx.flags.IS_GLIMMER_COMPAT_MODE).toBe(false);
      expect(ctx.flags.WITH_HELPER_MANAGER).toBe(false); // Default preserved
    });

    test('creates context with initial bindings', () => {
      ctx = createContext('<MyComponent />', {
        bindings: new Set(['MyComponent']),
      });
      expect(isKnownBinding(ctx, 'MyComponent')).toBe(true);
    });

    test('creates context with filename', () => {
      ctx = createContext('<div />', { filename: 'test.gts' });
      expect(ctx.filename).toBe('test.gts');
    });

    test('initializes with empty errors and warnings', () => {
      expect(ctx.errors).toEqual([]);
      expect(ctx.warnings).toEqual([]);
    });

    test('initializes with html namespace', () => {
      expect(ctx.elementContext).toEqual({
        namespace: 'html',
        parentNamespace: 'html',
      });
    });

    test('initializes context counter at 0', () => {
      expect(ctx.contextCounter).toBe(0);
    });

    test('stores source code', () => {
      ctx = createContext('<div>test</div>');
      expect(ctx.source).toBe('<div>test</div>');
    });
  });

  describe('error and warning management', () => {
    test('addError adds error to context', () => {
      addError(ctx, 'Test error', 'E001');
      expect(ctx.errors).toHaveLength(1);
      // Check required fields (errors are enriched with hint when available)
      expect(ctx.errors[0].message).toBe('Test error');
      expect(ctx.errors[0].code).toBe('E001');
      expect(ctx.errors[0].sourceRange).toBeUndefined();
    });

    test('addError with source range', () => {
      addError(ctx, 'Test error', 'E001', { start: 5, end: 10 });
      expect(ctx.errors[0].sourceRange).toEqual({ start: 5, end: 10 });
      // Should have enriched fields when sourceRange is provided
      expect(ctx.errors[0].line).toBeDefined();
      expect(ctx.errors[0].column).toBeDefined();
      expect(ctx.errors[0].snippet).toBeDefined();
    });

    test('addWarning adds warning to context', () => {
      addWarning(ctx, 'Test warning', 'W001');
      expect(ctx.warnings).toHaveLength(1);
      // Check required fields (warnings are enriched with hint when available)
      expect(ctx.warnings[0].message).toBe('Test warning');
      expect(ctx.warnings[0].code).toBe('W001');
      expect(ctx.warnings[0].sourceRange).toBeUndefined();
    });

    test('multiple errors accumulate', () => {
      addError(ctx, 'Error 1', 'E001');
      addError(ctx, 'Error 2', 'E002');
      expect(ctx.errors).toHaveLength(2);
    });
  });

  describe('context name generation', () => {
    test('nextContextName generates sequential names', () => {
      expect(nextContextName(ctx)).toBe('ctx0');
      expect(nextContextName(ctx)).toBe('ctx1');
      expect(nextContextName(ctx)).toBe('ctx2');
    });

    test('resetContextCounter resets to 0', () => {
      nextContextName(ctx);
      nextContextName(ctx);
      resetContextCounter(ctx);
      expect(nextContextName(ctx)).toBe('ctx0');
    });
  });

  describe('element context', () => {
    test('withElementContext temporarily changes namespace', () => {
      expect(ctx.elementContext.namespace).toBe('html');

      const result = withElementContext(
        ctx,
        { namespace: 'svg', parentNamespace: 'html' },
        () => {
          expect(ctx.elementContext.namespace).toBe('svg');
          return 'inner';
        }
      );

      expect(result).toBe('inner');
      expect(ctx.elementContext.namespace).toBe('html');
    });

    test('withElementContext restores on error', () => {
      expect(() => {
        withElementContext(
          ctx,
          { namespace: 'svg', parentNamespace: 'html' },
          () => {
            throw new Error('test');
          }
        );
      }).toThrow('test');

      expect(ctx.elementContext.namespace).toBe('html');
    });

    test('nested withElementContext works', () => {
      withElementContext(ctx, { namespace: 'svg', parentNamespace: 'html' }, () => {
        expect(ctx.elementContext.namespace).toBe('svg');

        withElementContext(ctx, { namespace: 'html', parentNamespace: 'svg' }, () => {
          expect(ctx.elementContext.namespace).toBe('html');
          expect(ctx.elementContext.parentNamespace).toBe('svg');
        });

        expect(ctx.elementContext.namespace).toBe('svg');
      });
    });
  });

  describe('binding helpers', () => {
    beforeEach(() => {
      ctx = createContext('<MyComponent />', {
        bindings: new Set(['MyComponent', 'MyHelper']),
      });
    });

    test('isKnownBinding returns true for known bindings', () => {
      expect(isKnownBinding(ctx, 'MyComponent')).toBe(true);
      expect(isKnownBinding(ctx, 'MyHelper')).toBe(true);
    });

    test('isKnownBinding returns false for unknown bindings', () => {
      expect(isKnownBinding(ctx, 'Unknown')).toBe(false);
    });

    test('resolveBinding returns binding info', () => {
      const binding = resolveBinding(ctx, 'MyComponent');
      expect(binding).toBeDefined();
      expect(binding?.kind).toBe('component');
    });

    test('resolveBinding returns undefined for unknown', () => {
      expect(resolveBinding(ctx, 'Unknown')).toBeUndefined();
    });

    test('getAllBindingNames returns all names', () => {
      const names = getAllBindingNames(ctx);
      expect(names).toContain('MyComponent');
      expect(names).toContain('MyHelper');
    });
  });

  describe('emitter integration', () => {
    test('emitter is initialized and functional', () => {
      ctx.emitter.emit('test');
      expect(ctx.emitter.getCode()).toBe('test');
    });

    test('emitter has correct source length', () => {
      ctx = createContext('<div>12345</div>');
      const tree = ctx.emitter.getMappingTree();
      expect(tree.sourceRange.end).toBe(16); // '<div>12345</div>'.length
    });
  });

  describe('scopeTracker integration', () => {
    test('scopeTracker is initialized', () => {
      expect(ctx.scopeTracker.depth).toBe(0);
    });

    test('scopeTracker can add bindings', () => {
      ctx.scopeTracker.addBinding('local', { kind: 'block-param', name: 'local' });
      expect(ctx.scopeTracker.hasBinding('local')).toBe(true);
    });
  });
});

describe('types', () => {
  describe('createFlags', () => {
    test('default flags are frozen', () => {
      expect(Object.isFrozen(DEFAULT_FLAGS)).toBe(true);
    });
  });
});

describe('letBlockCounter', () => {
  let ctx: CompilerContext;

  beforeEach(() => {
    ctx = createContext('<div>test</div>');
  });

  test('initializes to 0', () => {
    expect(ctx.letBlockCounter).toBe(0);
  });

  test('can be incremented', () => {
    ctx.letBlockCounter++;
    expect(ctx.letBlockCounter).toBe(1);
    ctx.letBlockCounter++;
    expect(ctx.letBlockCounter).toBe(2);
  });

  test('each context has independent counter', () => {
    ctx.letBlockCounter = 5;
    const ctx2 = createContext('<span />');
    expect(ctx2.letBlockCounter).toBe(0);
    expect(ctx.letBlockCounter).toBe(5);
  });
});

describe('VisitorRegistry', () => {
  let ctx: CompilerContext;

  beforeEach(() => {
    ctx = createContext('<div>test</div>');
  });

  test('visitors field is initialized', () => {
    expect(ctx.visitors).toBeDefined();
    expect(ctx.visitors.serializeChild).toBeNull();
  });

  test('uninitialized visit throws error', () => {
    expect(() => ctx.visitors.visit(ctx, {} as any)).toThrow(
      'Visitor registry not initialized'
    );
  });

  test('uninitialized visitChildren throws error', () => {
    expect(() => ctx.visitors.visitChildren(ctx, [])).toThrow(
      'Visitor registry not initialized'
    );
  });

  describe('initializeVisitors', () => {
    test('sets visit function', () => {
      const mockVisit: VisitFn = () => null;
      const mockVisitChildren: VisitChildrenFn = () => [];

      initializeVisitors(ctx, mockVisit, mockVisitChildren);

      expect(ctx.visitors.visit).toBe(mockVisit);
      expect(ctx.visitors.visitChildren).toBe(mockVisitChildren);
    });

    test('initialized visit function is callable', () => {
      const mockVisit: VisitFn = () => 'test-result';
      const mockVisitChildren: VisitChildrenFn = () => ['child'];

      initializeVisitors(ctx, mockVisit, mockVisitChildren);

      expect(ctx.visitors.visit(ctx, {} as any)).toBe('test-result');
      expect(ctx.visitors.visitChildren(ctx, [])).toEqual(['child']);
    });
  });

  describe('setSerializeChildFunction', () => {
    test('sets serializeChild function', () => {
      const mockSerialize = () => 'serialized';
      setSerializeChildFunction(ctx, mockSerialize);

      expect(ctx.visitors.serializeChild).toBe(mockSerialize);
    });

    test('serializeChild is callable after setting', () => {
      const mockSerialize = (_ctx: any, child: any) => `serialized:${child}`;
      setSerializeChildFunction(ctx, mockSerialize);

      expect(ctx.visitors.serializeChild!(ctx, 'test', 'this')).toBe('serialized:test');
    });
  });
});
