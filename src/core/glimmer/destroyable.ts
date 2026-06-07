import { AdaptivePool, config } from '@/core/config';

export type DestructorFn = () => void | Promise<void> | Promise<void[]>;
export type Destructors = Array<DestructorFn>;

// destructorsForInstance
const $dfi: WeakMap<object, Destructors> = new WeakMap();
const destroyedObjects = new WeakSet<object>();

// Adaptive pool for destructor arrays with automatic growth/shrink
const destructorPool = new AdaptivePool<Destructors>(
  config.destructorArrayPool,
  () => [],
  (arr) => { arr.length = 0; },
);

function getDestructorArray(): Destructors {
  return destructorPool.acquire();
}

function releaseDestructorArray(arr: Destructors) {
  destructorPool.release(arr);
}

// Host-registerable destruction-error reporter. Mirrors `setOpcodeErrorReporter`
// in reactive.ts. The destruction layer is FIRST-ERROR-WINS: every sibling
// destructor / DOM removal always runs to completion (a throwing row-3
// destructor must not leak rows 4..N — the leak fix), and the FIRST captured
// error is surfaced here exactly once per teardown scope.
//
// Policy (the propagation decision, NOT the completion guarantee):
//   * NO reporter registered (standalone glimmer-next, the default): the error
//     is dev-logged and SWALLOWED — matching pre-PR master behavior, so a
//     throwing teardown can't abort an enclosing standalone flow / test.
//   * Reporter registered (the Ember host installs one at gxt-backend init): the
//     reporter receives the first error and decides what to do — record it,
//     forward it to Ember's `runTask`/`assert.throws`, and/or RE-THROW to
//     propagate. Whatever the reporter throws propagates to the caller.
//
// The reporter is the ONLY thing that can cause a destruction error to escape
// the teardown; `reportDestructionError` itself never throws on its own.
export type DestructionErrorReporter = (error: unknown) => void;

let _destructionErrorReporter: DestructionErrorReporter | null = null;

export function setDestructionErrorReporter(
  reporter: DestructionErrorReporter | null,
): void {
  _destructionErrorReporter = reporter;
}

// Surface the first error captured during a first-error-wins teardown scope.
// Call this instead of `throw firstError`. When a host reporter is installed it
// is invoked with the error (and may re-throw to propagate); otherwise the
// error is dev-logged and swallowed (master-compatible standalone default).
export function reportDestructionError(error: unknown): void {
  if (_destructionErrorReporter !== null) {
    // The reporter owns the propagation policy; if it re-throws, that escapes
    // by design (the Ember host wants the error surfaced to runTask/assert).
    _destructionErrorReporter(error);
    return;
  }
  if (IS_DEV_MODE) {
    console.error('Error during destruction:', error);
  }
}

if (!import.meta.env.SSR) {
  if (IS_DEV_MODE) {
    window['getDestructors'] = () => $dfi;
  }
}
const DESTROYED_NODES = new WeakMap();
export function destroySync(ctx: object) {
  if (import.meta.env.DEV) {
    if (destroyedObjects.has(ctx)) {
      if (import.meta.env.DEV) {
        console.info(ctx, 'node-is-already-destroyed-here');
        console.error(DESTROYED_NODES.get(ctx));
        console.info('and trying to be re-destroyed here');
        console.error(new Error('here'));
        console.warn(`---------------`);
      }
      return;
    }
    DESTROYED_NODES.set(ctx, new Error('here').stack);
  }
  destroyedObjects.add(ctx);
  const destructors = $dfi.get(ctx);
  if (destructors === undefined) {
    return;
  }
  $dfi.delete(ctx);
  // First-error-wins: complete all destructors, throw the first error after.
  // Matches classic Ember backburner semantics; ensures one bad destructor
  // doesn't leak siblings (the common case during 2998-row teardown).
  let firstError: unknown = undefined;
  for (let i = 0; i < destructors.length; i++) {
    try {
      destructors[i]();
    } catch (e) {
      if (firstError === undefined) firstError = e;
    }
  }
  // Return array to pool for reuse
  releaseDestructorArray(destructors);
  if (firstError !== undefined) {
    reportDestructionError(firstError);
  }
}
export function destroy(ctx: object, promises: Array<Promise<void>> = []) {
  if (import.meta.env.DEV) {
    if (destroyedObjects.has(ctx)) {
      if (import.meta.env.DEV) {
        console.info(ctx, 'node-is-already-destroyed-here');
        console.error(DESTROYED_NODES.get(ctx));
        console.info('and trying to be re-destroyed here');
        console.error(new Error('here'));
        console.warn(`---------------`);
      }
      return;
    }
    DESTROYED_NODES.set(ctx, new Error('here').stack);
  }
  destroyedObjects.add(ctx);
  const destructors = $dfi.get(ctx);
  if (destructors === undefined) {
    return;
  }
  $dfi.delete(ctx);
  // First-error-wins: complete all destructors, throw the first sync error
  // after. Async rejections are accumulated into `promises` and surfaced
  // through the caller's Promise.all unchanged.
  let firstError: unknown = undefined;
  let result;
  for (let i = 0; i < destructors.length; i++) {
    try {
      result = destructors[i]();
      if (result) {
        promises.push(result as Promise<void>);
      }
    } catch (e) {
      if (firstError === undefined) firstError = e;
    }
  }
  // Return array to pool for reuse
  releaseDestructorArray(destructors);
  if (firstError !== undefined) {
    reportDestructionError(firstError);
  }
}
export function registerDestructor(ctx: object, ...fn: Destructors) {
  let existingDestructors = $dfi.get(ctx);
  if (existingDestructors === undefined) {
    existingDestructors = getDestructorArray();
    $dfi.set(ctx, existingDestructors);
  }
  // Inline push without spread — `fn` is already an array. Spread would
  // re-walk it and `Array.prototype.push.apply`-style hot paths get
  // deoptimized by V8 above ~32 elements.
  for (let i = 0; i < fn.length; i++) {
    existingDestructors.push(fn[i]);
  }
}

/**
 * Same as registerDestructor but takes a destructor array directly,
 * avoiding the rest-parameter `arguments` collection allocation per call.
 * Used on hot per-element paths in `_DOM` where we already have the
 * destructors pre-built in an array.
 */
export function registerDestructorBatch(ctx: object, fns: Destructors) {
  let existingDestructors = $dfi.get(ctx);
  if (existingDestructors === undefined) {
    existingDestructors = getDestructorArray();
    $dfi.set(ctx, existingDestructors);
  }
  for (let i = 0; i < fns.length; i++) {
    existingDestructors.push(fns[i]);
  }
}

// Track objects whose destruction is in progress (marked early)
// This is separate from destroyedObjects to allow destroy() to still run
const destructionInProgress = new WeakSet<object>();

export function isDestroyed(ctx: object) {
  return destroyedObjects.has(ctx);
}

// Check if destruction has started (either in progress or completed)
export function isDestructionStarted(ctx: object) {
  return destroyedObjects.has(ctx) || destructionInProgress.has(ctx);
}

// Mark an object as destruction in progress without running destructors.
// Used when an async destroy method needs to mark itself early
// to prevent double-destruction from child iteration.
// Unlike `destroy()`, this doesn't run destructors - it just marks the intent.
export function markAsDestroyed(ctx: object) {
  destructionInProgress.add(ctx);
}

export function associateDestroyableChild(parent: object, child: object) {
  registerDestructor(parent, () => {
    destroy(child);
  });
}
