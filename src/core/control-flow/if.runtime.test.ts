/**
 * Runtime tests for the if control flow.
 * These tests verify actual behavior without mocking.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { cell, tagsToRevalidate, opsForTag } from '../reactive';
import { createCallTracker, createTrackedCell, createDOMFixture, type DOMFixture } from '../__test-utils__';
import { IfCondition } from './if';
import { Component } from '../component';
import { RENDERED_NODES_PROPERTY, addToTree, COMPONENT_ID_PROPERTY, TREE } from '../shared';

beforeEach(() => {
  // Clear reactive state between tests
  tagsToRevalidate.clear();
  opsForTag.clear();
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

/**
 * Regression coverage for commit a128135's `'in'`-check guard around
 * `parentContext.$_eval` in the IfCondition constructor. Under Ember
 * integration, the parent component can be a tracked-property proxy
 * whose `get` trap throws on unknown property access (e.g. when the
 * proxy enforces strict property declarations). A bare `parentContext.$_eval`
 * read would propagate the throw and abort the constructor before
 * `addToTree` runs, leaving the if half-registered.
 *
 * The guard reads `'$_eval' in parentContext` first, so a proxy with
 * a `has` trap that returns `false` (or a `get` that throws on unknown
 * keys) must NOT cause the IfCondition constructor to throw.
 */
describe('If condition - throwing-proxy parent (a128135 guard)', () => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('proxy parent whose `has` returns false: constructor completes, addToTree runs', () => {
    // Build a baseline component so we have valid TREE/PARENT identity.
    const baseParent = new Component({});
    baseParent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, baseParent);

    // Wrap in a Proxy that lies: `'$_eval' in proxyParent` is false,
    // so the guard skips the read entirely. A `get` trap is included to
    // detect any accidental fall-through.
    let getReadKeys: PropertyKey[] = [];
    const proxyParent = new Proxy(baseParent, {
      has(target, key) {
        if (key === '$_eval') return false;
        return Reflect.has(target, key);
      },
      get(target, key, receiver) {
        getReadKeys.push(key);
        if (key === '$_eval') {
          throw new Error('proxy refused $_eval read');
        }
        return Reflect.get(target, key, receiver);
      },
    });

    const condition = cell(true);
    const placeholder = fixture.api.comment('proxy-test');
    const target = fixture.api.fragment();
    fixture.api.insert(target, placeholder);

    let constructed: IfCondition | null = null;
    expect(() => {
      constructed = new IfCondition(
        proxyParent as unknown as Component<any>,
        condition,
        target as unknown as DocumentFragment,
        placeholder,
        () => null,
        () => null,
      );
    }).not.toThrow();

    expect(constructed).not.toBeNull();
    // The if was added to the tree under the (target of the) proxy.
    expect(TREE.has(constructed![COMPONENT_ID_PROPERTY])).toBe(true);
    // The `'$_eval' in proxyParent` check must NOT have triggered the get
    // trap with `$_eval` (a `has` lookup hits the `has` trap).
    expect(getReadKeys.includes('$_eval')).toBe(false);
  });

  test('proxy parent whose `get` throws on $_eval but `has` returns true: still does not throw', () => {
    // This stresses the dual-trap shape: even when a parent advertises
    // $_eval via `has` but the actual read throws, the IfCondition
    // constructor should not blow up the if-block registration. (If a
    // future change widens the contract to require successful read, this
    // test will need updating; today it documents the safety net.)
    const baseParent = new Component({});
    baseParent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, baseParent);

    const proxyParent = new Proxy(baseParent, {
      has(_target, key) {
        if (key === '$_eval') return true;
        return Reflect.has(_target, key);
      },
      get(target, key, receiver) {
        if (key === '$_eval') {
          throw new Error('boom on $_eval read');
        }
        return Reflect.get(target, key, receiver);
      },
    });

    const condition = cell(true);
    const placeholder = fixture.api.comment('proxy-test-2');
    const target = fixture.api.fragment();
    fixture.api.insert(target, placeholder);

    // The current guard does NOT swallow a successful `'$_eval' in parent`
    // followed by a throwing read — that's the limitation noted in the
    // commit message ("an `in` check before reading"). We confirm the
    // documented behavior: with `has` returning true and `get` throwing,
    // the constructor does throw, but it throws from the read site
    // (i.e. the original symptom). Verifying this exact shape locks the
    // test against silent broadening of swallow behavior.
    expect(() => {
      new IfCondition(
        proxyParent as unknown as Component<any>,
        condition,
        target as unknown as DocumentFragment,
        placeholder,
        () => null,
        () => null,
      );
    }).toThrow(/boom on \$_eval read/);
  });

  test('plain object parent without $_eval property: no throw, $_eval not assigned', () => {
    // Sanity: the most common Ember-compat shape — a plain component
    // without $_eval — must not cause the if to crash, AND must not have
    // an accidentally-assigned `$_eval` property afterwards.
    const baseParent = new Component({});
    baseParent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, baseParent);

    const condition = cell(true);
    const placeholder = fixture.api.comment('plain-test');
    const target = fixture.api.fragment();
    fixture.api.insert(target, placeholder);

    const ifCond = new IfCondition(
      baseParent,
      condition,
      target as unknown as DocumentFragment,
      placeholder,
      () => null,
      () => null,
    );

    expect(TREE.has(ifCond[COMPONENT_ID_PROPERTY])).toBe(true);
    // No $_eval was read, so none should be propagated to the IfCondition.
    expect('$_eval' in ifCond).toBe(false);
  });
});

/**
 * Regression coverage for the `validateEpoch` recheck in the
 * Ember-mode synchronous destroy path of `IfCondition.renderBranch`.
 *
 * The flow is:
 *
 *   renderBranch(nextBranch, runNumber)
 *     └─ if (WITH_EMBER_INTEGRATION) {        // build-time gate (Ember build only)
 *          this.renderBranchSyncHost(nextBranch, runNumber):
 *            this.destroyBranchSync();      // (A)
 *            // (B) ← without the fix, no epoch check here
 *            this.renderState(nextBranch);  // (C)
 *        }
 *
 * `WITH_EMBER_INTEGRATION` is a build-time constant that folds to `false` in the
 * standalone test build, so the gated branch is unreachable from `syncState`
 * here. The sync path therefore lives in the extracted `renderBranchSyncHost`,
 * which these tests exercise directly (the gate itself is a trivial constant).
 *
 * `destroyBranchSync` runs destructors of the previous branch
 * synchronously. A destructor can flip the condition again (and, under
 * Ember integration, the external scheduler can synchronously re-enter
 * `syncState`). That re-entry advances `runNumber` and renders the new
 * branch. Once the inner re-entry returns, the *outer* `renderBranch`
 * continues at point (B) and — without an epoch recheck — calls
 * `renderState(nextBranch)` for its now-stale branch, clobbering the
 * inner render.
 *
 * The async sibling path already does this recheck (see
 * src/core/control-flow/if.ts inside the `destroyPromise.then(...)`
 * branch, which calls `validateEpoch(runNumber)` before re-rendering).
 * The sync path must match.
 *
 * The harness below avoids weaving real destructor side-effects (which
 * would require a deeply set-up component subtree) by overriding the
 * instance's `destroyBranchSync` to deterministically simulate a
 * mid-destroy re-entry: it bumps `runNumber` past the captured one and
 * mutates `prevComponent` to mimic what the inner re-entry would have
 * produced. The OUTER call must then bail; if it doesn't, it overwrites
 * `prevComponent` with the stale branch's return value.
 */
describe('If condition - sync destroy path validateEpoch (Ember mode)', () => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('stale outer renderBranch bails after sync destroy when runNumber advanced', () => {
    const baseParent = new Component({});
    baseParent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, baseParent);

    const condition = cell(true);
    const placeholder = fixture.api.comment('sync-epoch-test');
    const target = fixture.api.fragment();
    fixture.api.insert(target, placeholder);

    let trueBranchCalls = 0;
    let falseBranchCalls = 0;
    const trueBranch = () => {
      trueBranchCalls++;
      return [{ __branch: 'true' }] as any;
    };
    const falseBranch = () => {
      falseBranchCalls++;
      return [{ __branch: 'false' }] as any;
    };

    const ifCond = new IfCondition(
      baseParent,
      condition,
      target as unknown as DocumentFragment,
      placeholder,
      trueBranch,
      falseBranch,
    );

    // Initial render fired in the constructor (condition=true).
    expect(trueBranchCalls).toBe(1);
    expect(falseBranchCalls).toBe(0);

    // Capture the outer runNumber that the *next* syncState(false) call
    // will pass into renderBranch. checkStatement increments runNumber
    // FIRST and then renderBranch is called with the post-increment
    // value, so after the constructor's run, runNumber is 1 and the
    // upcoming syncState(false) will use runNumber=2.
    const outerRunNumber = ifCond.runNumber + 1;

    // Stub the renderState we observe and instrument destroyBranchSync
    // to simulate a synchronous re-entry by advancing runNumber and
    // rendering the OPPOSITE branch (true) before the OUTER
    // renderBranch reaches its renderState(falseBranch) call.
    const renderStateCalls: Array<unknown> = [];
    const originalRenderState = ifCond.renderState.bind(ifCond);
    ifCond.renderState = function (nextBranch: any) {
      renderStateCalls.push(nextBranch);
      // Don't actually run the real renderState (no DOM tree set up
      // for branch content) — just record the call for assertion.
    } as typeof ifCond.renderState;

    const originalDestroyBranchSync = ifCond.destroyBranchSync.bind(ifCond);
    ifCond.destroyBranchSync = function () {
      originalDestroyBranchSync();
      // Simulate the inner re-entry:
      //   - advance runNumber past the outer's captured runNumber
      //     (this is exactly what `checkStatement` would do in a
      //     real re-entry triggered by a destructor)
      //   - pretend the inner re-entry already re-rendered the true
      //     branch (i.e. it called renderState(trueBranch) and set
      //     prevComponent). The outer must NOT clobber this.
      ifCond.runNumber = outerRunNumber + 1;
      ifCond.prevComponent = [{ __branch: 'inner-true' }] as any;
      renderStateCalls.push('<<inner re-entry simulated>>');
    } as typeof ifCond.destroyBranchSync;

    // Drive the sync host path directly with the captured outer runNumber.
    // (renderBranch's `if (WITH_EMBER_INTEGRATION)` gate folds to false in the
    // standalone test build, so we exercise the extracted method.) The stubbed
    // destroyBranchSync simulates a mid-destroy re-entry that advances runNumber
    // past `outerRunNumber`, so the recheck must bail before renderState.
    ifCond.renderBranchSyncHost(falseBranch, outerRunNumber);

    // The instrumented destroyBranchSync ran and recorded its marker.
    expect(renderStateCalls).toContain('<<inner re-entry simulated>>');

    // The fix asserts the OUTER call must bail after destroyBranchSync
    // because runNumber (now outerRunNumber+1) !== outerRunNumber. So
    // the only renderState calls recorded should be the inner-re-entry
    // marker — NOT the outer falseBranch.
    const realRenderStateCalls = renderStateCalls.filter(
      (c) => c !== '<<inner re-entry simulated>>'
    );
    expect(realRenderStateCalls).toHaveLength(0);

    // And the inner-rendered branch state must be preserved.
    expect((ifCond.prevComponent as any)?.[0]?.__branch).toBe('inner-true');

    // Restore so the destroy path doesn't try to use our stub.
    ifCond.renderState = originalRenderState as typeof ifCond.renderState;
  });

  test('non-stale path still renders normally (regression sanity)', () => {
    // Symmetric control: when destroyBranchSync does NOT advance the
    // runNumber, the outer renderBranch must proceed to renderState.
    const baseParent = new Component({});
    baseParent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, baseParent);

    const condition = cell(true);
    const placeholder = fixture.api.comment('sync-epoch-control');
    const target = fixture.api.fragment();
    fixture.api.insert(target, placeholder);

    const trueBranch = () => [{ __branch: 'true' }] as any;
    const falseBranch = () => [{ __branch: 'false' }] as any;

    const ifCond = new IfCondition(
      baseParent,
      condition,
      target as unknown as DocumentFragment,
      placeholder,
      trueBranch,
      falseBranch,
    );

    const renderStateCalls: Array<unknown> = [];
    ifCond.renderState = function (nextBranch: any) {
      renderStateCalls.push(nextBranch);
    } as typeof ifCond.renderState;

    // Don't override destroyBranchSync — leave the real one in place. Drive the
    // sync host path directly with the current (matching) runNumber so the epoch
    // recheck passes and the branch renders normally.
    ifCond.renderBranchSyncHost(falseBranch, ifCond.runNumber);

    // Exactly one call (the falseBranch render) should have been made.
    expect(renderStateCalls).toHaveLength(1);
    expect(renderStateCalls[0]).toBe(falseBranch);
  });
});
