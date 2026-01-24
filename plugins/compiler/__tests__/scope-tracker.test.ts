import { describe, test, expect, beforeEach } from 'vitest';
import { ScopeTracker, createScopeTracker } from '../tracking/scope-tracker';

describe('ScopeTracker', () => {
  let tracker: ScopeTracker;

  beforeEach(() => {
    tracker = new ScopeTracker();
  });

  describe('initialization', () => {
    test('creates with empty root scope', () => {
      expect(tracker.depth).toBe(0);
      expect(tracker.currentScopeName).toBe('root');
    });

    test('accepts initial bindings', () => {
      const initialBindings = new Set(['MyComponent', 'Helper']);
      tracker = new ScopeTracker(initialBindings);

      expect(tracker.hasBinding('MyComponent')).toBe(true);
      expect(tracker.hasBinding('Helper')).toBe(true);
      expect(tracker.hasBinding('Unknown')).toBe(false);
    });

    test('createScopeTracker factory works', () => {
      const tracker = createScopeTracker(new Set(['Foo']));
      expect(tracker.hasBinding('Foo')).toBe(true);
    });
  });

  describe('scope management', () => {
    test('enterScope increases depth', () => {
      expect(tracker.depth).toBe(0);
      tracker.enterScope('block');
      expect(tracker.depth).toBe(1);
      expect(tracker.currentScopeName).toBe('block');
    });

    test('exitScope decreases depth', () => {
      tracker.enterScope('block');
      expect(tracker.depth).toBe(1);
      tracker.exitScope();
      expect(tracker.depth).toBe(0);
    });

    test('exitScope throws when trying to exit root', () => {
      expect(() => tracker.exitScope()).toThrow('Cannot exit root scope');
    });

    test('nested scopes work correctly', () => {
      tracker.enterScope('each');
      expect(tracker.depth).toBe(1);

      tracker.enterScope('if');
      expect(tracker.depth).toBe(2);
      expect(tracker.currentScopeName).toBe('if');

      tracker.exitScope();
      expect(tracker.depth).toBe(1);
      expect(tracker.currentScopeName).toBe('each');

      tracker.exitScope();
      expect(tracker.depth).toBe(0);
    });
  });

  describe('binding management', () => {
    test('addBinding adds to current scope', () => {
      tracker.addBinding('foo', { kind: 'component', name: 'foo' });
      expect(tracker.hasBinding('foo')).toBe(true);
    });

    test('removeBinding removes from current scope', () => {
      tracker.addBinding('foo', { kind: 'component', name: 'foo' });
      expect(tracker.removeBinding('foo')).toBe(true);
      expect(tracker.hasBinding('foo')).toBe(false);
    });

    test('removeBinding returns false for non-existent binding', () => {
      expect(tracker.removeBinding('nonexistent')).toBe(false);
    });

    test('addBindings adds multiple bindings', () => {
      tracker.addBindings([
        ['a', { kind: 'component', name: 'a' }],
        ['b', { kind: 'helper', name: 'b' }],
      ]);
      expect(tracker.hasBinding('a')).toBe(true);
      expect(tracker.hasBinding('b')).toBe(true);
    });
  });

  describe('binding resolution', () => {
    test('resolve finds binding in current scope', () => {
      tracker.addBinding('foo', { kind: 'component', name: 'Foo' });
      const binding = tracker.resolve('foo');
      expect(binding).toEqual({ kind: 'component', name: 'Foo' });
    });

    test('resolve finds binding in parent scope', () => {
      tracker.addBinding('parent', { kind: 'component', name: 'Parent' });
      tracker.enterScope('child');

      const binding = tracker.resolve('parent');
      expect(binding).toEqual({ kind: 'component', name: 'Parent' });
    });

    test('resolve returns undefined for unknown binding', () => {
      expect(tracker.resolve('unknown')).toBeUndefined();
    });

    test('inner scope shadows outer scope', () => {
      tracker.addBinding('item', { kind: 'component', name: 'OuterItem' });
      tracker.enterScope('each');
      tracker.addBinding('item', { kind: 'block-param', name: 'item' });

      const binding = tracker.resolve('item');
      expect(binding?.kind).toBe('block-param');
    });

    test('shadowing is removed when scope exits', () => {
      tracker.addBinding('item', { kind: 'component', name: 'OuterItem' });
      tracker.enterScope('each');
      tracker.addBinding('item', { kind: 'block-param', name: 'item' });
      tracker.exitScope();

      const binding = tracker.resolve('item');
      expect(binding?.kind).toBe('component');
    });
  });

  describe('hasLocalBinding', () => {
    test('returns true for binding in current scope', () => {
      tracker.addBinding('local', { kind: 'component', name: 'local' });
      expect(tracker.hasLocalBinding('local')).toBe(true);
    });

    test('returns false for binding in parent scope', () => {
      tracker.addBinding('parent', { kind: 'component', name: 'parent' });
      tracker.enterScope('child');
      expect(tracker.hasLocalBinding('parent')).toBe(false);
      expect(tracker.hasBinding('parent')).toBe(true); // but hasBinding finds it
    });
  });

  describe('getAllBindings', () => {
    test('returns all visible bindings', () => {
      tracker.addBinding('root', { kind: 'component', name: 'Root' });
      tracker.enterScope('child');
      tracker.addBinding('child', { kind: 'block-param', name: 'child' });

      const bindings = tracker.getAllBindings();
      expect(bindings.size).toBe(2);
      expect(bindings.has('root')).toBe(true);
      expect(bindings.has('child')).toBe(true);
    });

    test('inner bindings shadow outer bindings', () => {
      tracker.addBinding('item', { kind: 'component', name: 'Outer' });
      tracker.enterScope('each');
      tracker.addBinding('item', { kind: 'block-param', name: 'Inner' });

      const bindings = tracker.getAllBindings();
      expect(bindings.get('item')?.name).toBe('Inner');
    });
  });

  describe('getAllBindingNames', () => {
    test('returns set of all binding names', () => {
      tracker.addBinding('a', { kind: 'component', name: 'a' });
      tracker.addBinding('b', { kind: 'helper', name: 'b' });

      const names = tracker.getAllBindingNames();
      expect(names).toEqual(new Set(['a', 'b']));
    });
  });

  describe('withScope', () => {
    test('executes function within scope and exits', () => {
      expect(tracker.depth).toBe(0);

      const result = tracker.withScope('temp', () => {
        expect(tracker.depth).toBe(1);
        return 'result';
      });

      expect(result).toBe('result');
      expect(tracker.depth).toBe(0);
    });

    test('exits scope even if function throws', () => {
      expect(tracker.depth).toBe(0);

      expect(() => {
        tracker.withScope('temp', () => {
          throw new Error('test error');
        });
      }).toThrow('test error');

      expect(tracker.depth).toBe(0);
    });
  });

  describe('withBindings', () => {
    test('adds bindings temporarily', () => {
      const result = tracker.withBindings(
        [['temp', { kind: 'block-param', name: 'temp' }]],
        () => {
          expect(tracker.hasBinding('temp')).toBe(true);
          return 'done';
        }
      );

      expect(result).toBe('done');
      expect(tracker.hasBinding('temp')).toBe(false);
    });

    test('removes bindings even if function throws', () => {
      expect(() => {
        tracker.withBindings(
          [['temp', { kind: 'block-param', name: 'temp' }]],
          () => {
            throw new Error('test');
          }
        );
      }).toThrow('test');

      expect(tracker.hasBinding('temp')).toBe(false);
    });
  });

  describe('createBlockParams', () => {
    test('creates binding info array for block params', () => {
      const params = tracker.createBlockParams(['item', 'index']);

      expect(params).toHaveLength(2);
      expect(params[0]).toEqual([
        'item',
        { kind: 'block-param', name: 'item', sourceRange: undefined },
      ]);
      expect(params[1]).toEqual([
        'index',
        { kind: 'block-param', name: 'index', sourceRange: undefined },
      ]);
    });

    test('includes source range if provided', () => {
      const sourceRange = { start: 10, end: 20 };
      const params = tracker.createBlockParams(['item'], sourceRange);

      expect(params[0][1].sourceRange).toEqual(sourceRange);
    });
  });
});
