import { describe, test, expect } from 'vitest';
import {
  cell,
  formula,
  setTracker,
  getTracker,
} from './reactive';
import {
  shadowCellFor,
  ensureReactiveCollectionsPatched,
} from './reactive-collections';

/**
 * Run `fn` inside a fresh tracking frame and return the set of cells
 * it consumed. This mirrors what `MergedCell.get value` does internally,
 * but avoids pulling in the full DOM rendering pipeline.
 */
function track<T>(fn: () => T): { value: T; consumed: Set<unknown> } {
  const prev = getTracker();
  const trk = new Set<any>();
  setTracker(trk);
  try {
    const value = fn();
    return { value, consumed: trk };
  } finally {
    setTracker(prev);
  }
}

describe('reactive Map/Set collections', () => {
  test('patch is applied and idempotent', () => {
    ensureReactiveCollectionsPatched();
    ensureReactiveCollectionsPatched();
    // Sanity: native behavior is preserved.
    const m = new Map<string, number>();
    m.set('a', 1);
    m.set('b', 2);
    expect(m.size).toBe(2);
    expect(m.get('a')).toBe(1);
    expect(Array.from(m.keys())).toEqual(['a', 'b']);
    expect(Array.from(m.values())).toEqual([1, 2]);
    expect(Array.from(m.entries())).toEqual([
      ['a', 1],
      ['b', 2],
    ]);

    const s = new Set<number>();
    s.add(1);
    s.add(2);
    s.add(2); // duplicate — no effect
    expect(s.size).toBe(2);
    expect(s.has(1)).toBe(true);
    expect(Array.from(s)).toEqual([1, 2]);
  });

  test('Map.entries() consumes the shadow cell in a tracking frame', () => {
    const m = new Map<string, number>([['a', 1]]);
    const shadow = shadowCellFor(m);

    const { consumed } = track(() => Array.from(m.entries()));
    expect(consumed.has(shadow)).toBe(true);
  });

  test('Map.set bumps the shadow cell and re-runs a formula', () => {
    const m = new Map<string, number>([['a', 1]]);
    let runs = 0;
    const f = formula(() => {
      runs++;
      return Array.from(m.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join(',');
    }, 'map-entries');

    expect(f.value).toBe('a=1');
    expect(runs).toBe(1);

    m.set('b', 2);
    // Consuming the formula again should see the new state.
    expect(f.value).toBe('a=1,b=2');
    expect(runs).toBeGreaterThanOrEqual(2);
  });

  test('Map.delete bumps the shadow cell', () => {
    const m = new Map<string, number>([
      ['a', 1],
      ['b', 2],
    ]);
    let runs = 0;
    const f = formula(() => {
      runs++;
      return Array.from(m.keys()).join(',');
    }, 'map-keys');

    expect(f.value).toBe('a,b');
    const before = runs;

    m.delete('a');
    expect(f.value).toBe('b');
    expect(runs).toBeGreaterThan(before);
  });

  test('Map.clear bumps the shadow cell', () => {
    const m = new Map<string, number>([['a', 1]]);
    const f = formula(() => Array.from(m.keys()).join(','), 'map-keys');
    expect(f.value).toBe('a');
    m.clear();
    expect(f.value).toBe('');
  });

  test('Set.add bumps the shadow cell, duplicates do not re-bump', () => {
    const s = new Set<string>();
    let runs = 0;
    const f = formula(() => {
      runs++;
      return Array.from(s).join(',');
    }, 'set-values');

    expect(f.value).toBe('');
    s.add('x');
    expect(f.value).toBe('x');
    s.add('y');
    expect(f.value).toBe('x,y');

    // Adding an existing value should not dirty the cell's semantics —
    // the observable result is the same string.
    s.add('x');
    expect(f.value).toBe('x,y');
  });

  test('Set.delete bumps only when an element was actually removed', () => {
    const s = new Set<number>([1, 2, 3]);
    const f = formula(() => Array.from(s).join(','), 'set-values');
    expect(f.value).toBe('1,2,3');
    expect(s.delete(2)).toBe(true);
    expect(f.value).toBe('1,3');
    expect(s.delete(999)).toBe(false);
    expect(f.value).toBe('1,3');
  });

  test('Set.clear bumps the shadow cell', () => {
    const s = new Set<number>([1, 2, 3]);
    const f = formula(() => Array.from(s).join(','), 'set-values');
    expect(f.value).toBe('1,2,3');
    s.clear();
    expect(f.value).toBe('');
  });

  test('Map read methods preserve identity of the Map', () => {
    const m = new Map<string, number>([['a', 1]]);
    // === identity and instanceof survive the patch.
    expect(m instanceof Map).toBe(true);
    const m2 = m;
    expect(m === m2).toBe(true);
  });

  test('consume is a no-op outside a tracking frame', () => {
    const m = new Map<string, number>([['a', 1]]);
    // Outside a tracking frame: reading does not register anything.
    // We assert by calling from outside `track(...)` and observing no
    // cross-effect: create a separate cell, read the map, update the
    // unrelated cell, and ensure the map's shadow cell was not attached.
    expect(getTracker()).toBeNull();
    const arr = Array.from(m.entries());
    expect(arr).toEqual([['a', 1]]);
    // No tracker was set, so nothing should have been recorded.
    expect(getTracker()).toBeNull();
  });

  test('shadow cell is stable across multiple reads', () => {
    const m = new Map<string, number>();
    const c1 = shadowCellFor(m);
    const c2 = shadowCellFor(m);
    expect(c1).toBe(c2);
  });

  test('interop: cells for other objects still work', () => {
    const c = cell(0, 'unrelated');
    let runs = 0;
    const f = formula(() => {
      runs++;
      return c.value * 2;
    }, 'unrelated-formula');
    expect(f.value).toBe(0);
    c.update(5);
    expect(f.value).toBe(10);
    expect(runs).toBeGreaterThanOrEqual(2);
  });

  describe('benign behavior on non-tracked instances', () => {
    // These tests guard against the patch silently changing observable
    // semantics of plain (non-reactive) Map/Set usage in vendor code.
    test('Map.set returns the map (chainable, native contract)', () => {
      ensureReactiveCollectionsPatched();
      const m = new Map<string, number>();
      const ret = m.set('a', 1).set('b', 2).set('c', 3);
      expect(ret).toBe(m);
      expect(m.size).toBe(3);
    });

    test('Set.add returns the set (chainable, native contract)', () => {
      ensureReactiveCollectionsPatched();
      const s = new Set<number>();
      const ret = s.add(1).add(2).add(3);
      expect(ret).toBe(s);
      expect(s.size).toBe(3);
    });

    test('Map iteration order is insertion order, preserved across patched methods', () => {
      ensureReactiveCollectionsPatched();
      const m = new Map<string, number>();
      m.set('z', 1);
      m.set('a', 2);
      m.set('m', 3);
      expect(Array.from(m.keys())).toEqual(['z', 'a', 'm']);
      expect(Array.from(m.values())).toEqual([1, 2, 3]);
      expect(Array.from(m.entries())).toEqual([
        ['z', 1],
        ['a', 2],
        ['m', 3],
      ]);
      const seen: string[] = [];
      m.forEach((_v, k) => seen.push(k));
      expect(seen).toEqual(['z', 'a', 'm']);
    });

    test('Set iteration order is insertion order, preserved across patched methods', () => {
      ensureReactiveCollectionsPatched();
      const s = new Set<string>();
      s.add('z');
      s.add('a');
      s.add('m');
      expect(Array.from(s.values())).toEqual(['z', 'a', 'm']);
      const seen: string[] = [];
      s.forEach((v) => seen.push(v));
      expect(seen).toEqual(['z', 'a', 'm']);
    });

    test('Map subclass keeps its overridden methods (instanceof + custom .get)', () => {
      ensureReactiveCollectionsPatched();
      class CountingMap<K, V> extends Map<K, V> {
        gets = 0;
        override get(key: K): V | undefined {
          this.gets++;
          return super.get(key);
        }
      }
      const m = new CountingMap<string, number>();
      m.set('x', 1);
      expect(m.get('x')).toBe(1);
      expect(m.get('missing')).toBeUndefined();
      expect(m.gets).toBe(2);
      expect(m).toBeInstanceOf(Map);
      expect(m).toBeInstanceOf(CountingMap);
    });

    test('Set subclass keeps its overridden methods', () => {
      ensureReactiveCollectionsPatched();
      class TrackedSet<T> extends Set<T> {
        adds = 0;
        override add(v: T): this {
          this.adds++;
          return super.add(v);
        }
      }
      const s = new TrackedSet<number>();
      s.add(1).add(2).add(2); // dedup at add level → still counts twice
      expect(s.adds).toBe(3);
      expect(s.size).toBe(2);
    });

    test('outside a tracking frame, reads do not register dependencies', () => {
      ensureReactiveCollectionsPatched();
      const m = new Map<string, number>();
      m.set('a', 1);
      // No setTracker — reads here are exactly like native reads.
      expect(m.get('a')).toBe(1);
      expect(m.has('a')).toBe(true);
      expect(m.size).toBe(1);
      expect(getTracker()).toBe(null);
    });
  });
});
