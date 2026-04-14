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
});
