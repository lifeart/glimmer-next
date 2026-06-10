/**
 * Render-Root isolation - synchronous root-boundary state swapping.
 *
 * Lets an SSR driver run N sequential synchronous render roots, each with its
 * own isolated {node counter, parent-context stack, rendering-context caches},
 * so a throw or leak in render N cannot corrupt render N+1.
 *
 * SYNCHRONOUS ONLY by design (see non-goals in RENDER_ROOT_DESIGN.md): no
 * AsyncLocalStorage / async interleaving. The swap window opens on entry and
 * closes in `finally` the instant `fn` returns; it must not wrap an `async` fn
 * whose awaited work mints nodes after the first `await`.
 *
 * Behaviorally inert until a caller opts in: the per-node hot path
 * (`NODE_COUNTER++`, stack push/pop, `fastRenderingContext` reads) is untouched.
 */
import { getNodeCounter, setNodeCounter } from '@/core/dom';
import { snapshotParentContext, restoreParentContext } from '@/core/tracking';
import { snapshotRenderingContext, restoreRenderingContext } from '@/core/context';

export interface RenderRootState {
  nodeCounter: number;
  parentContextStack: number[];
  renderingContext: { fast: unknown; root: unknown };
}

/** Fresh, fully-isolated state for one render root (counter at 0, empty stack,
 *  no ambient rendering context — identical to a cold module load). */
export function createRenderRootState(): RenderRootState {
  return {
    nodeCounter: 0,
    parentContextStack: [],
    renderingContext: { fast: null, root: null },
  };
}

/**
 * Run `fn` with `state` swapped into the module globals, restoring the previous
 * (outer) globals on exit — including on throw. SYNCHRONOUS ONLY: `fn` must do
 * all node-minting synchronously before returning (no `await` inside the swapped
 * window). See non-goals.
 */
export function withRenderRoot<T>(state: RenderRootState, fn: () => T): T {
  // SAVE outer
  const outerCounter = getNodeCounter();
  const outerParent = snapshotParentContext();
  const outerCtx = snapshotRenderingContext();
  // SWAP IN this root
  setNodeCounter(state.nodeCounter);
  restoreParentContext(state.parentContextStack);
  restoreRenderingContext(state.renderingContext);
  try {
    return fn();
  } finally {
    // CHECKPOINT this root's mutated state (so a later re-entry resumes exactly)
    state.nodeCounter = getNodeCounter();
    state.parentContextStack = snapshotParentContext();
    state.renderingContext = snapshotRenderingContext();
    // RESTORE outer (runs on throw too)
    setNodeCounter(outerCounter);
    restoreParentContext(outerParent);
    restoreRenderingContext(outerCtx);
  }
}
