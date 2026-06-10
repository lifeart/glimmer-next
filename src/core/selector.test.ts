/**
 * Tests for the keyedSelector primitive (src/core/selector.ts).
 *
 * Verifies the O(2) fan-out contract: when the source key changes, ONLY the
 * formulas subscribed to the previous key's cell and the next key's cell
 * re-execute — every other key's subscriber stays untouched. Also covers lazy
 * per-key cell creation/reuse, initial truth for the currently-selected key,
 * function sources, in-drain batching (snapshotted drain work list), and
 * destroy/owner cleanup.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  cell,
  formula,
  tagsToRevalidate,
  opsForTag,
  relatedTags,
  setTracker,
  setIsRendering,
} from './reactive';
import { opcodeFor } from './vm';
import { keyedSelector } from './selector';
import { destroySync } from './glimmer/destroyable';

// drain the microtask-scheduled syncDom
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  tagsToRevalidate.clear();
  opsForTag.clear();
  relatedTags.clear();
  setTracker(null);
  setIsRendering(false);
});

/**
 * Subscribe one formula per key to `select` and count opcode executions.
 * Mirrors how a row's class-binding formula subscribes in real templates.
 */
function subscribeKeys<K>(
  select: (key: K) => boolean,
  keys: K[],
): {
  counts: Map<K, number>;
  values: Map<K, boolean>;
  destructors: Array<() => void>;
} {
  const counts = new Map<K, number>();
  const values = new Map<K, boolean>();
  const destructors: Array<() => void> = [];
  for (const key of keys) {
    const f = formula(() => select(key), `selector-test-${String(key)}`);
    destructors.push(
      opcodeFor(f, (value: unknown) => {
        counts.set(key, (counts.get(key) ?? 0) + 1);
        values.set(key, value as boolean);
      }),
    );
  }
  return { counts, values, destructors };
}

describe('keyedSelector', () => {
  test('initial read is true for the currently-selected key, false otherwise', () => {
    const source = cell(2);
    const select = keyedSelector(source);

    expect(select(2)).toBe(true);
    expect(select(1)).toBe(false);
    expect(select(999)).toBe(false);

    select.destroy();
  });

  test('per-key cells are created lazily and reused for repeated reads', () => {
    const source = cell(1);
    const select = keyedSelector(source);

    expect(select.size).toBe(0); // nothing materialized before any read

    select(7);
    expect(select.size).toBe(1);

    select(7); // repeated read of the same key reuses the one cell
    select(7);
    expect(select.size).toBe(1);

    select(8);
    expect(select.size).toBe(2);

    select.destroy();
  });

  test('only old and new key subscribers re-execute on change (O(2) fan-out)', async () => {
    const source = cell(1);
    const select = keyedSelector(source);
    const keys = [1, 2, 3, 4, 5];
    const { counts, values, destructors } = subscribeKeys(select, keys);

    // initial evaluation: each subscriber ran exactly once
    for (const k of keys) expect(counts.get(k)).toBe(1);
    expect(values.get(1)).toBe(true);
    for (const k of [2, 3, 4, 5]) expect(values.get(k)).toBe(false);

    source.update(3);
    await settle();

    // ONLY key 1 (deselected) and key 3 (selected) re-ran
    expect(counts.get(1)).toBe(2);
    expect(counts.get(3)).toBe(2);
    expect(counts.get(2)).toBe(1);
    expect(counts.get(4)).toBe(1);
    expect(counts.get(5)).toBe(1);
    expect(values.get(1)).toBe(false);
    expect(values.get(3)).toBe(true);

    // second change: 3 → 5; keys 1/2/4 still untouched
    source.update(5);
    await settle();
    expect(counts.get(3)).toBe(3);
    expect(counts.get(5)).toBe(2);
    expect(counts.get(1)).toBe(2);
    expect(counts.get(2)).toBe(1);
    expect(counts.get(4)).toBe(1);
    expect(values.get(3)).toBe(false);
    expect(values.get(5)).toBe(true);

    destructors.forEach((d) => d());
    select.destroy();
  });

  test('re-setting the same key is a no-op (no subscriber re-runs)', async () => {
    const source = cell(1);
    const select = keyedSelector(source);
    const { counts, destructors } = subscribeKeys(select, [1, 2]);

    source.update(1);
    await settle();

    expect(counts.get(1)).toBe(1);
    expect(counts.get(2)).toBe(1);

    destructors.forEach((d) => d());
    select.destroy();
  });

  test('selecting a key with no materialized cell still deselects the old one', async () => {
    const source = cell(1);
    const select = keyedSelector(source);
    const { counts, values, destructors } = subscribeKeys(select, [1]);

    source.update(42); // nobody ever read key 42
    await settle();

    expect(counts.get(1)).toBe(2);
    expect(values.get(1)).toBe(false);
    // a later read of the new key materializes its cell with the right value
    expect(select(42)).toBe(true);

    destructors.forEach((d) => d());
    select.destroy();
  });

  test('function source: wraps in a formula and tracks its dependencies', async () => {
    const source = cell(10);
    const select = keyedSelector(() => source.value);
    const { counts, values, destructors } = subscribeKeys(select, [10, 20]);

    expect(values.get(10)).toBe(true);
    expect(values.get(20)).toBe(false);

    source.update(20);
    await settle();

    expect(counts.get(10)).toBe(2);
    expect(counts.get(20)).toBe(2);
    expect(values.get(10)).toBe(false);
    expect(values.get(20)).toBe(true);

    destructors.forEach((d) => d());
    select.destroy();
  });

  test('flips apply even when the drain work list was snapshotted (multi-cell batch)', async () => {
    // When >1 cell is dirty, syncDomSync iterates a SNAPSHOT of
    // tagsToRevalidate — cells dirtied mid-drain would be cleared without
    // executing. The selector must therefore flush flips synchronously.
    const source = cell(1);
    const unrelated = cell(0);
    let unrelatedRuns = 0;
    const dropUnrelated = opcodeFor(unrelated, () => {
      unrelatedRuns++;
    });
    const select = keyedSelector(source);
    const { counts, values, destructors } = subscribeKeys(select, [1, 2, 3]);

    // dirty BOTH cells in the same tick → snapshot path in the drain
    unrelated.update(99);
    source.update(3);
    await settle();

    expect(unrelatedRuns).toBe(2); // initial + batch
    expect(counts.get(1)).toBe(2);
    expect(counts.get(3)).toBe(2);
    expect(counts.get(2)).toBe(1);
    expect(values.get(1)).toBe(false);
    expect(values.get(3)).toBe(true);

    dropUnrelated();
    destructors.forEach((d) => d());
    select.destroy();
  });

  test('destroy unsubscribes from the source and clears the key map', async () => {
    const source = cell(1);
    const select = keyedSelector(source);
    const { counts, destructors } = subscribeKeys(select, [1, 2]);
    expect(select.size).toBe(2);

    select.destroy();

    expect(select.size).toBe(0);
    // source opcode fully removed (ops array drained + released)
    expect(opsForTag.has(source.id)).toBe(false);

    source.update(2);
    await settle();

    // no subscriber re-ran — the selector is disconnected
    expect(counts.get(1)).toBe(1);
    expect(counts.get(2)).toBe(1);

    // post-destroy reads: frozen plain comparison, no new cells materialized
    expect(select(1)).toBe(true);
    expect(select(2)).toBe(false);
    expect(select.size).toBe(0);

    // idempotent
    select.destroy();

    destructors.forEach((d) => d());
  });

  test('dead keys are pruned on source change once the map grows (destroyed rows)', async () => {
    const source = cell(0);
    const select = keyedSelector(source, undefined, 'prune-test');
    // Cross the sweep threshold (PRUNE_MIN_SIZE = 64) with 70 subscribed keys.
    const keys = Array.from({ length: 70 }, (_, i) => i + 1);
    const { counts, destructors } = subscribeKeys(select, keys);
    expect(select.size).toBe(70);

    // Destroy all but 5 subscribers — simulates rows leaving the list. Their
    // formulas remove themselves from the key cells' relatedTags sets.
    destructors.slice(5).forEach((d) => d());

    source.update(3);
    await settle();

    // Swept down to the live keys (the active key's cell is always kept).
    expect(select.size).toBeLessThanOrEqual(6);
    expect(select(3)).toBe(true);
    expect(select(4)).toBe(false);
    // Surviving subscriber for key 3 saw the flip.
    expect(counts.get(3)).toBe(2);

    destructors.slice(0, 5).forEach((d) => d());
    select.destroy();
  });

  test('destroy is registered on the owner when one is passed', async () => {
    const owner = {};
    const source = cell(1);
    const select = keyedSelector(source, owner);
    const { counts, destructors } = subscribeKeys(select, [1, 2]);

    destroySync(owner);

    expect(select.size).toBe(0);
    source.update(2);
    await settle();
    expect(counts.get(1)).toBe(1);
    expect(counts.get(2)).toBe(1);

    destructors.forEach((d) => d());
  });
});
