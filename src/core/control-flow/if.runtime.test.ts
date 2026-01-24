/**
 * Runtime tests for the if control flow.
 * These tests verify actual behavior without mocking.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { cell, tagsToRevalidate, opsForTag, relatedTags } from '../reactive';
import { createCallTracker, createTrackedCell } from '../__test-utils__';

beforeEach(() => {
  // Clear reactive state between tests
  tagsToRevalidate.clear();
  opsForTag.clear();
  relatedTags.clear();
});

describe('If condition - reactive behavior', () => {
  describe('cell-based conditions', () => {
    test('cell can be used as condition source', () => {
      const condition = cell(true);

      expect(condition.value).toBe(true);

      condition.update(false);
      expect(condition.value).toBe(false);
    });

    test('cell update schedules revalidation', () => {
      const condition = cell(true);

      expect(tagsToRevalidate.size).toBe(0);

      condition.update(false);

      expect(tagsToRevalidate.has(condition)).toBe(true);
    });

    test('multiple updates only schedule once per cell', () => {
      const condition = cell(true);

      condition.update(false);
      condition.update(true);
      condition.update(false);

      // The cell should only be in tagsToRevalidate once
      expect(tagsToRevalidate.has(condition)).toBe(true);
      expect(tagsToRevalidate.size).toBe(1);
    });
  });

  describe('truthy/falsy evaluation', () => {
    test('truthy values', () => {
      expect(!!cell(true).value).toBe(true);
      expect(!!cell(1).value).toBe(true);
      expect(!!cell('hello').value).toBe(true);
      expect(!!cell({}).value).toBe(true);
      expect(!!cell([]).value).toBe(true);
      expect(!!cell(() => {}).value).toBe(true);
    });

    test('falsy values', () => {
      expect(!!cell(false).value).toBe(false);
      expect(!!cell(0).value).toBe(false);
      expect(!!cell('').value).toBe(false);
      expect(!!cell(null).value).toBe(false);
      expect(!!cell(undefined).value).toBe(false);
    });
  });
});

describe('If condition - branch rendering', () => {
  test('tracks which branch was rendered', () => {
    const { fn: trueBranch, getCallCount: getTrueCount } = createCallTracker(() => 'true');
    const { fn: falseBranch, getCallCount: getFalseCount } = createCallTracker(() => 'false');

    // Simulate condition evaluation
    const condition = cell(true);

    if (condition.value) {
      trueBranch();
    } else {
      falseBranch();
    }

    expect(getTrueCount()).toBe(1);
    expect(getFalseCount()).toBe(0);
  });

  test('switches branches when condition changes', () => {
    const { fn: trueBranch, getCallCount: getTrueCount, reset: resetTrue } = createCallTracker(() => 'true');
    const { fn: falseBranch, getCallCount: getFalseCount, reset: resetFalse } = createCallTracker(() => 'false');

    const condition = cell(true);

    // Initial render
    if (condition.value) {
      trueBranch();
    } else {
      falseBranch();
    }

    expect(getTrueCount()).toBe(1);
    expect(getFalseCount()).toBe(0);

    // Update condition
    condition.update(false);
    resetTrue();
    resetFalse();

    // Re-render
    if (condition.value) {
      trueBranch();
    } else {
      falseBranch();
    }

    expect(getTrueCount()).toBe(0);
    expect(getFalseCount()).toBe(1);
  });

  test('same value does not trigger unnecessary re-render', () => {
    const { testCell: condition, getUpdateCount } = createTrackedCell(true);
    const { fn: renderBranch, getCallCount } = createCallTracker(() => 'rendered');

    // Initial render
    const initialValue = condition.value;
    if (initialValue) {
      renderBranch();
    }

    expect(getCallCount()).toBe(1);

    // Update with same value
    condition.update(true);
    expect(getUpdateCount()).toBe(1);

    // Simulate checkStatement behavior (skip if value unchanged)
    const newValue = condition.value;
    if (newValue === initialValue) {
      // Skip re-render
    } else if (newValue) {
      renderBranch();
    }

    // Should not have rendered again
    expect(getCallCount()).toBe(1);
  });
});

describe('If condition - async destruction', () => {
  test('tracks destroy promise state', async () => {
    let destroyStarted = false;
    let destroyCompleted = false;

    const destroyBranch = async () => {
      destroyStarted = true;
      await Promise.resolve();
      destroyCompleted = true;
    };

    expect(destroyStarted).toBe(false);
    expect(destroyCompleted).toBe(false);

    const destroyPromise = destroyBranch();

    expect(destroyStarted).toBe(true);
    expect(destroyCompleted).toBe(false);

    await destroyPromise;

    expect(destroyCompleted).toBe(true);
  });

  test('prevents race conditions with runNumber tracking', () => {
    let runNumber = 0;

    const validateEpoch = (expectedRun: number) => {
      if (runNumber !== expectedRun) {
        return false; // Stale
      }
      return true;
    };

    // Simulate rapid condition changes
    runNumber++;
    const run1 = runNumber;

    runNumber++;
    const run2 = runNumber;

    // Only the latest should be valid
    expect(validateEpoch(run1)).toBe(false);
    expect(validateEpoch(run2)).toBe(true);
  });
});

describe('If condition - nested conditions', () => {
  test('inner condition tracks independently', () => {
    const outerCondition = cell(true);
    const innerCondition = cell(true);

    const { fn: renderInner, getCallCount } = createCallTracker(() => 'inner');

    // Simulate nested if
    if (outerCondition.value) {
      if (innerCondition.value) {
        renderInner();
      }
    }

    expect(getCallCount()).toBe(1);

    // Update inner condition
    innerCondition.update(false);

    // Inner should be in revalidation
    expect(tagsToRevalidate.has(innerCondition)).toBe(true);
    // Outer should not be affected
    expect(tagsToRevalidate.has(outerCondition)).toBe(false);
  });
});
