/**
 * Host tag primitives (src/core/tags.ts): the Glimmer tag protocol on gxt
 * cells. A host (Ember's native layer) uses `tagFor`/`dirtyCell`/
 * `currentRevision` so its property tags and gxt cells are ONE store.
 */
import { describe, test, expect } from 'vitest';
import {
  cell,
  cached,
  cellFor,
  rawCellFor,
  lazyRawCellFor,
  formula,
  getTracker,
  setTracker,
  tracked,
  tagsToRevalidate,
  opsForTag,
  relatedTags,
  type Cell,
} from './reactive';
import {
  tagFor,
  tagMetaFor,
  peekTagFor,
  dirtyCell,
  currentRevision,
  entangleSubscribers,
  UNSET,
} from './tags';
import { opcodeFor } from './vm';
import { HOST_HOOKS } from './host-hooks';
import { syncDom } from './runtime';

// An instance of a class whose `key` is a gxt `@tracked` field with the given
// initializer (the descriptor shape decorator transforms hand to `tracked`).
function trackedInstance(key: string, initializer: () => unknown): object {
  class Foo {}
  const desc = tracked(Foo.prototype, key, {
    initializer,
    enumerable: true,
    configurable: true,
  }) as unknown as PropertyDescriptor;
  Object.defineProperty(Foo.prototype, key, desc);
  return new Foo();
}

describe('tagFor', () => {
  test('returns one stable cell per (obj, key), created holding UNSET', () => {
    const obj = {};
    const a = tagFor(obj, 'a');
    expect(tagFor(obj, 'a')).toBe(a);
    expect(tagFor(obj, 'b')).not.toBe(a);
    expect(tagFor({}, 'a')).not.toBe(a);
    expect(a._value).toBe(UNSET);
    // the pre-resolved meta fast path returns the same cell
    expect(tagFor(obj, 'a', tagMetaFor(obj))).toBe(a);
  });

  test('peekTagFor never creates', () => {
    const obj = {};
    expect(peekTagFor(obj, 'x')).toBeUndefined();
    const t = tagFor(obj, 'x');
    expect(peekTagFor(obj, 'x')).toBe(t);
    expect(peekTagFor(obj, 'y')).toBeUndefined();
  });

  test('tagFor-before-read: never reads obj[key] nor defines an accessor (no recursion)', () => {
    // Shape of a host @tracked accessor that stores its value IN the tag cell:
    // its getter calls tagFor(this, key). If tagFor read obj[key] while
    // creating the cell, this would recurse forever.
    let getterCalls = 0;
    class Host {
      get count(): unknown {
        getterCalls++;
        const t = tagFor(this, 'count');
        if (t._value === UNSET) t._value = 7; // host initializer
        return t._value;
      }
    }
    const obj = new Host();
    const t = tagFor(obj, 'count');
    expect(getterCalls).toBe(0);
    expect(Object.getOwnPropertyDescriptor(obj, 'count')).toBeUndefined();
    expect(obj.count).toBe(7);
    expect(getterCalls).toBe(1);
    expect(tagFor(obj, 'count')).toBe(t);
    expect(t._value).toBe(7);
  });

  test('shares the store with gxt `tracked` (tag after first read)', () => {
    const foo = trackedInstance('x', () => 1) as { x: number };
    expect(foo.x).toBe(1);
    const t = tagFor(foo, 'x');
    expect(t._value).toBe(1);
    const before = t._revision;
    foo.x = 2;
    expect(tagFor(foo, 'x')).toBe(t);
    expect(t._value).toBe(2);
    expect(t._revision).toBeGreaterThan(before);
  });

  test('shares the store with gxt `tracked` (tag BEFORE first read seeds in place)', () => {
    const foo = trackedInstance('x', () => 'init') as { x: string };
    const t = tagFor(foo, 'x');
    expect(t._value).toBe(UNSET);
    expect(foo.x).toBe('init');
    expect(tagFor(foo, 'x')).toBe(t);
    expect(t._value).toBe('init');
    foo.x = 'next';
    expect(t._value).toBe('next');
  });

  test('the UNSET check never evaluates an existing LazyCell (re-entrant host accessor)', () => {
    // Shape of the compat @tracked path: a lazy cell whose initializer reads
    // obj[key], and an accessor that re-enters rawCellFor while that
    // initializer runs. Evaluating the LazyCell inside rawCellFor's existing-
    // cell check recursed until the stack overflowed.
    let reads = 0;
    class Host {
      get x(): unknown {
        reads++;
        return rawCellFor(this as never, 'x' as never) !== undefined ? 1 : 0;
      }
    }
    const obj = new Host();
    const lazy = lazyRawCellFor(obj as never, 'x' as never);
    expect(rawCellFor(obj as never, 'x' as never)).toBe(lazy);
    expect(lazyRawCellFor(obj as never, 'x' as never)).toBe(lazy);
    expect(reads).toBe(0);
    // resolving it later goes through the accessor exactly once
    expect(lazy.value).toBe(1);
    expect(reads).toBe(1);
  });

  test('cellFor on a tagFor cell seeds it in place from obj[key]', () => {
    const obj: { k: number } = { k: 42 };
    const t = tagFor(obj, 'k');
    const c = cellFor(obj, 'k');
    expect(c).toBe(t);
    expect(c.value).toBe(42);
    expect(obj.k).toBe(42);
  });
});

describe('dirtyCell', () => {
  test('always bumps the revision, even with an unchanged value (unlike Cell.update)', () => {
    const c = cell(1);
    const r0 = c._revision;
    const g0 = currentRevision();
    c.update(1);
    expect(c._revision).toBe(r0);
    expect(currentRevision()).toBe(g0);

    dirtyCell(c as Cell<unknown>);
    expect(c._revision).toBeGreaterThan(r0);
    expect(currentRevision()).toBe(c._revision);
    expect(c.value).toBe(1);
  });

  test('re-runs a subscribed formula on a same-value dirty', async () => {
    const c = cell('same');
    let runs = 0;
    const f = formula(() => {
      runs++;
      return c.value;
    }, 'same-value-dirty');
    const seen: unknown[] = [];
    const destroy = opcodeFor(f, (v) => {
      seen.push(v);
    });
    expect(seen).toEqual(['same']);
    expect(runs).toBe(1);

    dirtyCell(c as Cell<unknown>);
    await syncDom();
    expect(runs).toBe(2);
    expect(seen).toEqual(['same', 'same']);

    // still subscribed afterwards (the drain re-tracked the formula)
    dirtyCell(c as Cell<unknown>);
    await syncDom();
    expect(runs).toBe(3);
    destroy();
  });

  test('invalidates a gxt cached() that read the cell, without a value change', () => {
    const c = cell(3);
    let runs = 0;
    const memo = cached(() => {
      runs++;
      return c.value * 2;
    }, 'dirty-cached');
    expect(memo.value).toBe(6);
    expect(memo.value).toBe(6);
    expect(runs).toBe(1);
    dirtyCell(c as Cell<unknown>);
    expect(memo.value).toBe(6);
    expect(runs).toBe(2);
  });

  test('an unsubscribed tag is not enqueued for the DOM drain, but still signals the host', async () => {
    await syncDom();
    let signals = 0;
    const prevHook = HOST_HOOKS.scheduleRevalidate;
    HOST_HOOKS.scheduleRevalidate = () => {
      signals++;
    };
    try {
      const t = tagFor({}, 'lonely');
      const r0 = t._revision;
      dirtyCell(t);
      expect(t._revision).toBeGreaterThan(r0);
      expect(tagsToRevalidate.has(t)).toBe(false);
      expect(signals).toBe(1);
      await syncDom();
      expect(opsForTag.has(t.id)).toBe(false);
      expect(relatedTags.has(t.id)).toBe(false);
    } finally {
      HOST_HOOKS.scheduleRevalidate = prevHook;
    }
  });

  test('a host value stored in the tag cell is read by a formula tracking the tag', async () => {
    const obj = {};
    const t = tagFor(obj, 'v');
    t._value = 'a';
    const f = formula(() => tagFor(obj, 'v').value, 'host-storage');
    const seen: unknown[] = [];
    const destroy = opcodeFor(f, (v) => {
      seen.push(v);
    });
    t._value = 'b';
    dirtyCell(t);
    await syncDom();
    expect(seen).toEqual(['a', 'b']);
    destroy();
  });

  test('a host tracking frame (gxt tracker) captures tag reads', () => {
    const obj = {};
    const t = tagFor(obj, 'p');
    const prev = getTracker();
    const frame = new Set<Cell>();
    setTracker(frame);
    try {
      void t.value;
    } finally {
      setTracker(prev);
    }
    expect(frame.has(t)).toBe(true);
  });
});

describe('entangleSubscribers (late-bound dependencies)', () => {
  test('a formula subscribed to `source` re-runs when an entangled cell is dirtied', async () => {
    const source = cell('s');
    const late = cell('late');
    let runs = 0;
    const f = formula(() => {
      runs++;
      return source.value;
    }, 'entangle');
    const destroy = opcodeFor(f, () => {});
    expect(runs).toBe(1);
    dirtyCell(late as Cell<unknown>);
    await syncDom();
    expect(runs).toBe(1); // not subscribed yet
    entangleSubscribers(source as Cell<unknown>, [late as Cell<unknown>]);
    expect(runs).toBe(1); // entangling re-runs nothing
    dirtyCell(late as Cell<unknown>);
    await syncDom();
    expect(runs).toBe(2);
    destroy();
  });

  test('no subscribers: a no-op', () => {
    const source = cell(1);
    const late = cell(2);
    entangleSubscribers(source as Cell<unknown>, [late as Cell<unknown>]);
    expect(relatedTags.has(late.id)).toBe(false);
  });
});
