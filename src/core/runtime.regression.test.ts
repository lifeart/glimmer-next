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
import { syncDom } from './runtime';

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
