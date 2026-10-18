import { beforeEach, describe, expect, test } from 'vitest';
import {
  cell,
  formula,
  executeTag,
  executeTagSync,
  tagsToRevalidate,
  opsForTag,
  relatedTags,
  setTracker,
  setIsRendering,
} from './reactive';
import { opcodeFor } from './vm';
import { flushRevalidation, syncDom, takeRenderingControl } from './runtime';

beforeEach(() => {
  tagsToRevalidate.clear();
  opsForTag.clear();
  relatedTags.clear();
  setTracker(null);
  setIsRendering(false);
});

describe('runtime regressions (sync/async split)', () => {
  test('dedupes shared merged tags during one flush', async () => {
    const left = cell(1);
    const right = cell(2);
    const updates: number[] = [];

    const sharedTag = formula(() => left.value + right.value, 'shared-tag');
    const destroy = opcodeFor(sharedTag, (value) => {
      updates.push(value as number);
    });

    const baseline = updates.length;

    left.update(10);
    right.update(20);
    await syncDom();

    // Both source cells invalidate the same merged tag in one cycle.
    // It must run exactly once with the final value.
    expect(updates.length).toBe(baseline + 1);
    expect(updates[updates.length - 1]).toBe(30);

    destroy();
  });

  test('executeTag(tag, false) matches executeTagSync behavior', () => {
    const source = cell(7);
    const values: number[] = [];
    const destroy = opcodeFor(source, (value) => {
      values.push(value as number);
    });

    values.length = 0;
    const syncOverloadResult = executeTag(source, false);
    expect(syncOverloadResult).toBeUndefined();
    expect(values).toEqual([7]);

    values.length = 0;
    const syncAliasResult = executeTagSync(source);
    expect(syncAliasResult).toBeUndefined();
    expect(values).toEqual([7]);

    destroy();
  });
});

describe('ops bookkeeping of a revalidation pass', () => {
  // A list formula (created first, so it runs first in the pass) whose opcode
  // tears down and re-creates one bound formula per row; each row formula
  // reads the shared `selected` cell (krausest's `clear`: `rows` and
  // `selected` change in the same pass).
  function setup() {
    const rows = cell<number[]>([1, 2, 3], 'rows');
    const selected = cell(0, 'selected');
    const listTag = formula(() => rows.value, 'list');
    let rowTags: Array<ReturnType<typeof formula>> = [];
    let unbindRows: Array<() => void> = [];
    const mountRows = (items: number[]) => {
      rowTags = items.map((i) => formula(() => selected.value === i, `row-${i}`));
      unbindRows = rowTags.map((tag) => opcodeFor(tag, () => {}));
    };
    const unbindList = opcodeFor(listTag, (items) => {
      unbindRows.forEach((unbind) => unbind());
      mountRows(items as number[]);
    });
    tagsToRevalidate.clear();
    return {
      rows,
      selected,
      listTag,
      rowTags: () => rowTags,
      destroy: () => {
        unbindRows.forEach((unbind) => unbind());
        unbindList();
      },
    };
  }

  test('syncDom: rows destroyed in the pass leave no ops entries behind', () => {
    const { rows, selected, listTag, rowTags, destroy } = setup();
    const destroyedRows = rowTags();
    expect(opsForTag.size).toBe(4);
    rows.update([]);
    selected.update(2);
    syncDom();
    for (const tag of destroyedRows) {
      expect(tag.isDestroyed).toBe(true);
      expect(opsForTag.has(tag.id)).toBe(false);
    }
    // Only the live list binding is left.
    expect([...opsForTag.keys()]).toEqual([listTag.id]);
    destroy();
    expect(opsForTag.size).toBe(0);
  });

  test('flushRevalidation: rows destroyed in the pass leave no ops entries behind', () => {
    const release = takeRenderingControl();
    try {
      const { rows, selected, listTag, rowTags, destroy } = setup();
      const destroyedRows = rowTags();
      rows.update([]);
      selected.update(2);
      expect(flushRevalidation()).toBe(false);
      for (const tag of destroyedRows) {
        expect(opsForTag.has(tag.id)).toBe(false);
      }
      expect([...opsForTag.keys()]).toEqual([listTag.id]);
      destroy();
      expect(opsForTag.size).toBe(0);
    } finally {
      release();
    }
  });

  test('a changed cell with only formula subscribers gets no ops entry', () => {
    const { rows, selected, rowTags, destroy } = setup();
    const seen: unknown[] = [];
    const unbind = opcodeFor(rowTags()[1], (v) => {
      seen.push(v);
    });
    seen.length = 0;
    selected.update(2);
    syncDom();
    expect(seen).toEqual([true]);
    expect(opsForTag.has(selected.id)).toBe(false);
    expect(opsForTag.has(rows.id)).toBe(false);
    unbind();
    destroy();
  });

  test('a changed cell nothing reads gets no ops entry', async () => {
    const lonely = cell(1, 'lonely');
    lonely.update(2);
    syncDom();
    expect(opsForTag.has(lonely.id)).toBe(false);
    // The async form resolves the same way.
    await executeTag(lonely, true);
    expect(opsForTag.has(lonely.id)).toBe(false);
  });

  test('a formula with no ops of its own still re-subscribes when it runs in a pass', () => {
    const source = cell(1, 'source');
    const shared = formula(() => source.value, 'shared');
    const seen: unknown[] = [];
    // A dependent formula reads `shared`; `shared` itself has no opcode.
    const dependent = formula(() => shared.value, 'dependent');
    const unbind = opcodeFor(dependent, (v) => {
      seen.push(v);
    });
    // Subscribe `shared` directly to `source` as a pass would.
    setIsRendering(true);
    void shared.value;
    setIsRendering(false);
    expect(relatedTags.get(source.id)?.has(shared)).toBe(true);
    source.update(2);
    syncDom();
    expect(seen).toEqual([1, 2]);
    expect(opsForTag.has(shared.id)).toBe(false);
    // Re-subscribed by the pass's read.
    expect(relatedTags.get(source.id)?.has(shared)).toBe(true);
    unbind();
    shared.destroy();
  });
});
