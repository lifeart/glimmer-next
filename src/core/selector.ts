/**
 * `keyedSelector` — O(2) fan-out for `selected === key` style bindings.
 *
 * Problem (see RESEARCH_LIST_TRACKING_OPTIMIZATION.md §1.2 / §4.2): a binding
 * like `class={{if (eq this.selected item.id) "danger"}}` makes EVERY row's
 * formula subscribe to the single shared `selected` cell. Changing selection
 * then re-executes O(N) formulas even though only two rows visually change.
 *
 * Solution (SolidJS `createSelector` shape): keep ONE subscription on the
 * source and a `Map<key, Cell<boolean>>`. Row formulas call the selector with
 * their key inside their tracking frame, so each row subscribes to ITS OWN
 * per-key boolean cell. When the source changes, only the previous key's cell
 * and the next key's cell flip → exactly ≤2 cell notifications, regardless of
 * list size. Per-key cells are created lazily on first read and reused for
 * repeated reads of the same key.
 *
 * Flip mechanics: the selector's source opcode runs INSIDE the `syncDomSync`
 * drain (it is executed as one of the dirty source cell's ops), where a plain
 * `Cell.update()` would be silently discarded by the drain's terminal
 * `tagsToRevalidate.clear()`. Flips go through `applyCellUpdateSync` — the
 * drain-safe update path (direct mutate + synchronous subscriber flush under
 * `_isRendering`, bypassing the host deferral hook).
 *
 * Lifecycle: `selector.destroy()` removes the source subscription (destroying
 * the internal formula when the source was a function), releases per-key
 * bookkeeping (`opsForTag` arrays, `relatedTags` entries) and clears the map.
 * Pass an `owner` to auto-destroy via `registerDestructor` when the owner
 * (e.g. a component) is destroyed. After destroy, reads return a plain
 * comparison against the last-known key and no longer materialize cells.
 *
 * Memory: key cells whose subscribers are all gone (their rows were destroyed)
 * are swept on every source change (interaction-rate, immediate reclaim) and,
 * watermark-gated, on new-key materialization (so churning data prunes even
 * while the selection never moves). The sweep can only collect keys whose
 * subscriber formulas were DESTROYED; a formula that merely stopped reading a
 * key stays subscribed until it is destroyed (GXT formulas never unbind
 * dropped deps), so pair long-lived selectors with row teardown, not row
 * recycling.
 */
import {
  type Cell,
  type AnyCell,
  cell as createCell,
  formula,
  applyCellUpdateSync,
  opsForTag,
  relatedTags,
  releaseOpArray,
} from '@/core/reactive';
import { opcodeFor } from '@/core/vm';
import { registerDestructor } from '@/core/glimmer/destroyable';
import { isFn } from '@/core/shared';

export interface KeyedSelector<K> {
  (key: K): boolean;
  /** Number of materialized per-key cells (introspection / tests). */
  readonly size: number;
  /** Unsubscribe from the source and drop all per-key cells. Idempotent. */
  destroy(): void;
}

// A key cell with no remaining subscribers is dead weight: its row formulas
// were destroyed (row removed / list cleared) and removed themselves from the
// cell's relatedTags set. Ops-array emptiness — not absence — is the liveness
// signal on the ops side (pooled arrays may linger empty).
function isKeyCellUnused(keyCell: Cell<boolean>): boolean {
  const subs = relatedTags.get(keyCell.id);
  if (subs !== undefined && subs.size > 0) {
    return false;
  }
  const ops = opsForTag.get(keyCell.id);
  return ops === undefined || ops.length === 0;
}

function releaseKeyCell(keyCell: Cell<boolean>): void {
  const ops = opsForTag.get(keyCell.id);
  if (ops !== undefined) {
    opsForTag.delete(keyCell.id);
    releaseOpArray(ops);
  }
  relatedTags.delete(keyCell.id);
}

// Don't sweep tiny maps — the walk costs more than the memory it frees.
const PRUNE_MIN_SIZE = 64;

export function keyedSelector<K>(
  source: Cell<K> | (() => K),
  owner?: object,
  debugName?: string,
): KeyedSelector<K> {
  const cells = new Map<K, Cell<boolean>>();
  // One subscription on the source for the whole selector: a raw Cell is
  // subscribed directly (its ops run when it dirties); a function source is
  // wrapped in a formula so it tracks whatever cells it reads.
  const tag: AnyCell = isFn(source)
    ? formula(source, debugName ?? 'keyedSelector.source')
    : source;
  let isDestroyed = false;
  // Established synchronously below: opcodeFor runs the source op once during
  // construction, before any external read can happen.
  let currentKey!: K;

  // Dead-key sweep: rows that are destroyed leave their key cells
  // subscriber-less but still in the map, so a long-lived selector over
  // churning data (replace-all every tick) would grow without bound.
  // Two triggers with different gating:
  //   - source change (user-interaction rate): full sweep whenever the map is
  //     non-trivial — a selection change after mass row teardown reclaims
  //     everything immediately;
  //   - new-key materialization (render rate): watermark-gated — sweep only
  //     once the map doubles past the last sweep, so churn under a
  //     never-moving selection still prunes without an O(size) walk per read.
  let pruneThreshold = PRUNE_MIN_SIZE;
  function pruneUnusedKeys(): void {
    for (const [key, keyCell] of cells) {
      // Never drop the active key's cell — the next flip needs it.
      if (key === currentKey) continue;
      if (isKeyCellUnused(keyCell)) {
        releaseKeyCell(keyCell);
        cells.delete(key);
      }
    }
    pruneThreshold = Math.max(PRUNE_MIN_SIZE, cells.size * 2);
  }

  const removeSourceOpcode = opcodeFor(tag, (next: unknown) => {
    const nextKey = next as K;
    const prevKey = currentKey;
    if (nextKey === prevKey) {
      return;
    }
    // Commit the new key BEFORE flipping so key cells materialized lazily by
    // re-executing subscriber formulas initialize against the new key.
    currentKey = nextKey;
    const prevCell = cells.get(prevKey);
    if (prevCell !== undefined) {
      applyCellUpdateSync(prevCell, false);
    }
    const nextCell = cells.get(nextKey);
    if (nextCell !== undefined) {
      applyCellUpdateSync(nextCell, true);
    }
    if (cells.size >= PRUNE_MIN_SIZE) {
      pruneUnusedKeys();
    }
  });

  const select = ((key: K): boolean => {
    let keyCell = cells.get(key);
    if (keyCell === undefined) {
      if (isDestroyed) {
        // Frozen post-destroy semantics: plain comparison, no new cells.
        return key === currentKey;
      }
      // Sweep BEFORE inserting: the cell being materialized has no
      // subscribers until its reader's tracking frame closes, so a
      // post-insert sweep would reclaim it and orphan that subscription.
      if (cells.size >= pruneThreshold) {
        pruneUnusedKeys();
      }
      keyCell = createCell(
        key === currentKey,
        IS_DEV_MODE ? `keyedSelector(${String(key)})` : undefined,
      );
      cells.set(key, keyCell);
    }
    // Tracked read: a formula evaluating this subscribes to THIS key's cell,
    // not to the selector source.
    return keyCell.value;
  }) as KeyedSelector<K>;

  const destroy = () => {
    if (isDestroyed) {
      return;
    }
    isDestroyed = true;
    removeSourceOpcode();
    cells.forEach(releaseKeyCell);
    cells.clear();
  };
  select.destroy = destroy;
  Object.defineProperty(select, 'size', {
    get: () => cells.size,
  });

  if (owner !== undefined) {
    registerDestructor(owner, destroy);
  }

  return select;
}
