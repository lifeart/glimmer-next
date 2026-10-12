import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { cell, formula, tagsToRevalidate, setIsRendering, isRendering } from './reactive';
import { opcodeFor } from './vm';
import { flushRevalidation, syncDom, takeRenderingControl } from './runtime';

/**
 * flushRevalidation — the host-driven revalidation pass (Ember native layer:
 * backburner render queue + loop limit). A cell dirtied DURING a pass must stay
 * queued for the host's next pass; `syncDom()` drops it (end-of-pass clear).
 */
describe('flushRevalidation (host-driven passes)', () => {
  let release: () => void;
  beforeEach(() => {
    // The host owns scheduling: no gxt microtask drain during these tests.
    release = takeRenderingControl();
    tagsToRevalidate.clear();
  });
  afterEach(() => {
    release();
    tagsToRevalidate.clear();
    setIsRendering(false);
  });

  // A binding on `a` whose re-execution writes `b` (another binding's dep).
  function setup() {
    const a = cell(0, 'a');
    const b = cell(0, 'b');
    const seenB: unknown[] = [];
    const writer = formula(() => {
      const v = a.value as number;
      if (v > 0) b.update(v * 10);
      return v;
    }, 'writer');
    const reader = formula(() => b.value, 'reader');
    const d1 = opcodeFor(writer, () => {});
    const d2 = opcodeFor(reader, (v) => {
      seenB.push(v);
    });
    tagsToRevalidate.clear();
    return { a, b, seenB, destroy: () => (d1(), d2()) };
  }

  test('a write made during the pass stays queued and the next pass applies it', () => {
    const { a, seenB, destroy } = setup();
    expect(seenB).toEqual([0]);
    a.update(1);
    expect(flushRevalidation()).toBe(true); // writer wrote b during the pass
    expect(seenB).toEqual([0]); // reader not re-run yet (b dirtied mid-pass)
    expect(flushRevalidation()).toBe(false);
    expect(seenB).toEqual([0, 10]);
    destroy();
  });

  test('contrast: syncDom() drops the mid-pass write (why hosts need this pass)', () => {
    const { a, seenB, destroy } = setup();
    a.update(1);
    syncDom();
    expect(tagsToRevalidate.size).toBe(0);
    syncDom();
    expect(seenB).toEqual([0]); // lost
    destroy();
  });

  test('empty queue: no work, returns false, rendering flag untouched', () => {
    expect(flushRevalidation()).toBe(false);
    expect(isRendering()).toBe(false);
  });

  test('the rendering flag is restored when an opcode throws', () => {
    const c = cell(0, 'c');
    const f = formula(() => {
      if ((c.value as number) > 0) throw new Error('boom');
      return c.value;
    }, 'thrower');
    const d = opcodeFor(f, () => {});
    tagsToRevalidate.clear();
    c.update(1);
    expect(() => flushRevalidation()).toThrow('boom');
    expect(isRendering()).toBe(false);
    d();
  });
});
