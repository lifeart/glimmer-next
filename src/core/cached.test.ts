/**
 * Tests for the `cached()` primitive added in commits fa385a5 and f1614ac.
 *
 * `cached(fn)` is a memoizing derivation. The user getter must:
 *   - run exactly once for the first read,
 *   - return the cached value while none of the captured deps' revisions
 *     have changed,
 *   - re-evaluate exactly once when a captured dep changes,
 *   - replay its captured deps into a parent tracker so that an outer
 *     formula reading `cached.value` still depends on those cells,
 *   - route reads of the inner MergedCell tag through the cache too,
 *     so that `executeTag(cached.tag)` (the path the sync-DOM pipeline
 *     uses) does not re-run the user getter an extra time.
 */
import { describe, test, expect } from 'vitest';
import {
  cached,
  cell,
  formula,
  executeTag,
  flushCellOpcodes,
  setIsRendering,
} from './reactive';
import { opcodeFor } from './vm';
import { syncDom } from './runtime';

describe('cached() primitive', () => {
  test('memoizes while deps are unchanged: getter runs exactly once across multiple reads', () => {
    const c = cell(1);
    let runs = 0;
    const memo = cached(() => {
      runs++;
      return c.value * 10;
    }, 'memo-1');

    // First read computes once.
    expect(memo.value).toBe(10);
    expect(runs).toBe(1);

    // Subsequent reads with no dep change must NOT re-run the user fn.
    expect(memo.value).toBe(10);
    expect(memo.value).toBe(10);
    expect(memo.value).toBe(10);
    expect(runs).toBe(1);
  });

  test('re-evaluates exactly once when a captured dep updates', () => {
    const c = cell(1);
    let runs = 0;
    const memo = cached(() => {
      runs++;
      return c.value * 10;
    }, 'memo-2');

    expect(memo.value).toBe(10);
    expect(runs).toBe(1);

    c.update(2);

    // Two reads after the update — only one recompute.
    expect(memo.value).toBe(20);
    expect(memo.value).toBe(20);
    expect(runs).toBe(2);
  });

  test('no-op update (same value) does not invalidate the cache', () => {
    const c = cell(7);
    let runs = 0;
    const memo = cached(() => {
      runs++;
      return c.value + 1;
    }, 'memo-noop');

    expect(memo.value).toBe(8);
    expect(runs).toBe(1);

    // Cell.update() with the same value bumps tagsToRevalidate but
    // does NOT bump _revision (value-equality guard in Cell.update).
    // cached() should treat this as clean and not recompute.
    c.update(7);
    expect(memo.value).toBe(8);
    expect(runs).toBe(1);
  });

  test('changing an unrelated cell does not invalidate', () => {
    const a = cell(1);
    const b = cell(100);
    let runs = 0;
    const memo = cached(() => {
      runs++;
      return a.value;
    }, 'memo-unrelated');

    expect(memo.value).toBe(1);
    expect(runs).toBe(1);

    // We never read b inside the getter — touching it must not cause recompute.
    b.update(200);
    expect(memo.value).toBe(1);
    expect(runs).toBe(1);

    // But a does invalidate.
    a.update(2);
    expect(memo.value).toBe(2);
    expect(runs).toBe(2);
  });

  test('parent formula reading cached.value still depends on the underlying cells', () => {
    const c = cell(3);
    let cachedRuns = 0;
    const memo = cached(() => {
      cachedRuns++;
      return c.value * 2;
    }, 'memo-parent');

    let parentRuns = 0;
    const parent = formula(() => {
      parentRuns++;
      return memo.value + 1;
    }, 'parent-formula');

    expect(parent.value).toBe(7); // (3*2)+1
    expect(cachedRuns).toBe(1);
    expect(parentRuns).toBe(1);

    // Update underlying cell — both should see the change.
    c.update(5);

    expect(parent.value).toBe(11); // (5*2)+1
    expect(cachedRuns).toBe(2);
    expect(parentRuns).toBeGreaterThanOrEqual(2);
  });

  test('invalidate() forces the next read to recompute even if deps are clean', () => {
    const c = cell(1);
    let runs = 0;
    const memo = cached(() => {
      runs++;
      return c.value;
    }, 'memo-invalidate');

    expect(memo.value).toBe(1);
    expect(runs).toBe(1);

    memo.invalidate();
    expect(memo.value).toBe(1);
    expect(runs).toBe(2);
  });

  test('zero-dep getter is treated as potentially stale on later reads', () => {
    // The cached() implementation explicitly treats getters with zero
    // captured deps as "always stale" because they may read non-tracked
    // state (raw arrays, plain props). Verify the contract: at least the
    // first read returns the value, and a global-rev bump forces a
    // recompute even though no deps were captured.
    let runs = 0;
    const memo = cached(() => {
      runs++;
      return 'const-value';
    }, 'memo-zero-dep');

    expect(memo.value).toBe('const-value');
    expect(runs).toBe(1);

    // Bump the global revision via an unrelated cell update.
    const unrelated = cell('x');
    unrelated.update('y');

    // On the next read the zero-dep getter should be re-run (defensive).
    expect(memo.value).toBe('const-value');
    expect(runs).toBeGreaterThan(1);
  });

  test('routing through executeTag(memo.tag) does NOT run the user getter twice', () => {
    // Regression contract for f1614ac: when the sync-DOM pipeline calls
    // executeTag on the inner MergedCell, the memoized read path must be
    // taken instead of running the user fn directly.
    const c = cell(2);
    let runs = 0;
    const memo = cached(() => {
      runs++;
      return c.value * c.value;
    }, 'memo-executeTag');

    // Public read first to seed the cache.
    expect(memo.value).toBe(4);
    expect(runs).toBe(1);

    // Now go through the tag's value getter directly. Must NOT recompute.
    expect(memo.tag.value).toBe(4);
    expect(runs).toBe(1);

    // executeTag triggers tag.value internally — still no recompute.
    executeTag(memo.tag, false);
    expect(runs).toBe(1);

    // After updating the dep, exactly one more recompute regardless of
    // which entry point we use.
    c.update(3);
    expect(memo.tag.value).toBe(9);
    expect(runs).toBe(2);
    expect(memo.value).toBe(9);
    expect(runs).toBe(2);
  });
});

describe('cached() subscription survives a consume + clean read (regression)', () => {
  // Root cause: the drain (and flushCellOpcodes) CONSUMES a dirty cell's
  // subscriber set before re-executing the subscribed tags. A plain formula
  // re-collects its deps on re-execution and re-adds itself to each dep
  // cell's subscriber set. But a cached() tag whose readCached() clean path
  // hits (isClean() === true — e.g. after a same-value cell.update(), which
  // schedules a drain WITHOUT bumping any revision) returns the memoized
  // value WITHOUT touching its dep cells, so the tag is never re-added to
  // the consumed subscriber sets — it is permanently unsubscribed and later
  // REAL dep updates never reach its opcodes.

  test('same-value update() drain must not permanently unsubscribe the cached tag', async () => {
    const c = cell(1);
    let runs = 0;
    const memo = cached(() => {
      runs++;
      return c.value * 10;
    }, 'memo-sub-drop-drain');

    const seen: number[] = [];
    const destroy = opcodeFor(memo.tag, (value) => {
      seen.push(value as number);
    });
    expect(seen).toEqual([10]);
    expect(runs).toBe(1);

    // Same-value update: enqueues the cell for revalidation (observable
    // side-effect semantics) but does NOT bump _revision, so the cached
    // read in the drain is CLEAN. The drain consumes c's subscriber set;
    // the clean read must re-establish the subscription.
    c.update(1);
    await syncDom();
    expect(runs).toBe(1); // cache stayed clean — no recompute

    // REAL change: must reach the opcode through the (re-established)
    // subscription.
    c.update(2);
    await syncDom();
    expect(seen[seen.length - 1]).toBe(20);
    expect(runs).toBe(2);

    destroy();
  });

  test('cache seeded via memo.value (not tag.value) survives the same-value drain too', async () => {
    const c = cell(1);
    const memo = cached(() => c.value * 3, 'memo-sub-drop-self-seeded');
    // Seed through the PUBLIC getter first — this exercises the recompute
    // path where the cache's dep bookkeeping and tag.relatedCells could
    // alias the same Set object (and be wiped by the tag's re-tracking).
    expect(memo.value).toBe(3);

    const seen: number[] = [];
    const destroy = opcodeFor(memo.tag, (value) => {
      seen.push(value as number);
    });
    expect(seen).toEqual([3]);

    c.update(1); // same value — drain consumes, cache stays clean
    await syncDom();

    c.update(2); // real change — must still reach the opcode
    await syncDom();
    expect(seen[seen.length - 1]).toBe(6);

    destroy();
  });

  test('flushCellOpcodes consume path also re-subscribes a clean cached tag', async () => {
    const c = cell(5);
    let runs = 0;
    const memo = cached(() => {
      runs++;
      return c.value + 1;
    }, 'memo-sub-drop-flush');

    const seen: number[] = [];
    const destroy = opcodeFor(memo.tag, (value) => {
      seen.push(value as number);
    });
    expect(seen).toEqual([6]);
    expect(runs).toBe(1);

    // Host-style synchronous flush (Ember integration path): consumes c's
    // subscriber set and re-executes the cached tag while its cache is
    // still clean (no revision bump happened).
    setIsRendering(true);
    try {
      flushCellOpcodes(c);
    } finally {
      setIsRendering(false);
    }
    expect(runs).toBe(1); // clean — memoized value served

    // Later REAL dep update must still reach the opcode.
    c.update(7);
    await syncDom();
    expect(seen[seen.length - 1]).toBe(8);
    expect(runs).toBe(2);

    destroy();
  });
});
