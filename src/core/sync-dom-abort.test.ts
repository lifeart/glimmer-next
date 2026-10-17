import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  cell,
  formula,
  tagsToRevalidate,
  relatedTags,
  setIsRendering,
  isRendering,
  markOpcodeAsync,
  type tagOp,
} from './reactive';
import { opcodeFor } from './vm';
import { syncDom, takeRenderingControl } from './runtime';

/**
 * A revalidation pass that a binding aborts (its formula throws) ends like a
 * completed one: the queue of changed cells is emptied and the rendering flag
 * is reset. Before, the aborted pass left both, so the failing binding ran
 * again in every later sync and later writes were made in rendering state.
 */
describe('syncDom: a pass a binding aborts', () => {
  let release: () => void;
  beforeEach(() => {
    // No gxt microtask drain: each test runs its passes itself.
    release = takeRenderingControl();
    tagsToRevalidate.clear();
    setIsRendering(false);
  });
  afterEach(() => {
    release();
    tagsToRevalidate.clear();
    setIsRendering(false);
  });

  // A binding whose formula throws while `c` is positive.
  function setup() {
    const c = cell(0, 'c');
    const other = cell(0, 'other');
    let runs = 0;
    const seen: unknown[] = [];
    const thrower = formula(() => {
      runs++;
      const v = c.value as number;
      if (v > 0) throw new Error('boom');
      return v;
    }, 'thrower');
    const d1 = opcodeFor(thrower, (v) => {
      seen.push(v);
    });
    const d2 = opcodeFor(other, () => {});
    tagsToRevalidate.clear();
    runs = 0;
    return {
      c,
      other,
      seen,
      runs: () => runs,
      destroy: () => (d1(), d2()),
    };
  }

  test('the error reaches the caller and the pass leaves rendering state', () => {
    const { c, destroy } = setup();
    c.update(1);
    expect(() => syncDom()).toThrow('boom');
    expect(isRendering()).toBe(false);
    destroy();
  });

  test('the queue of changed cells is empty after the aborted pass', () => {
    const { c, destroy } = setup();
    c.update(1);
    expect(() => syncDom()).toThrow('boom');
    expect(tagsToRevalidate.size).toBe(0);
    destroy();
  });

  test('a later sync does not run the failing binding again', () => {
    const { c, other, runs, destroy } = setup();
    c.update(1);
    expect(() => syncDom()).toThrow('boom');
    const after = runs();
    // A sync with nothing queued, then a sync for an unrelated change.
    expect(() => syncDom()).not.toThrow();
    other.update(1);
    expect(() => syncDom()).not.toThrow();
    expect(runs()).toBe(after);
    destroy();
  });

  test('a new change of the binding runs it again', () => {
    const { c, seen, destroy } = setup();
    expect(seen).toEqual([0]);
    c.update(1);
    expect(() => syncDom()).toThrow('boom');
    c.update(-1);
    expect(() => syncDom()).not.toThrow();
    expect(seen).toEqual([0, -1]);
    destroy();
  });

  test('a binding the aborted pass did not reach renders on its next change', () => {
    const c = cell(0, 'c');
    // Created first, so it runs first in the pass.
    const thrower = formula(() => {
      if (c.value === 1) throw new Error('boom');
      return c.value;
    }, 'thrower');
    const reader = formula(() => c.value, 'reader');
    const seen: unknown[] = [];
    const d1 = opcodeFor(thrower, () => {});
    const d2 = opcodeFor(reader, (v) => {
      seen.push(v);
    });
    tagsToRevalidate.clear();
    c.update(1);
    expect(() => syncDom()).toThrow('boom');
    expect(seen).toEqual([0]);
    c.update(2);
    syncDom();
    expect(seen).toEqual([0, 2]);
    d1();
    d2();
  });

  test('guard: a pass that completes leaves no queue and no rendering state', () => {
    const { c, seen, destroy } = setup();
    c.update(-2);
    syncDom();
    expect(seen).toEqual([0, -2]);
    expect(tagsToRevalidate.size).toBe(0);
    expect(isRendering()).toBe(false);
    destroy();
  });

  // Last: marking an opcode async switches this module's syncDom() to the
  // async pass for the rest of the file.
  test('the async pass ends the same way', async () => {
    const { c, other, runs, destroy } = setup();
    const asyncOp: tagOp = async () => {};
    markOpcodeAsync(asyncOp);
    const d3 = opcodeFor(other, asyncOp);
    tagsToRevalidate.clear();
    c.update(1);
    await expect(syncDom() as Promise<void>).rejects.toThrow('boom');
    expect(isRendering()).toBe(false);
    expect(tagsToRevalidate.size).toBe(0);
    const after = runs();
    await syncDom();
    expect(runs()).toBe(after);
    d3();
    destroy();
    relatedTags.delete(c.id);
  });
});
