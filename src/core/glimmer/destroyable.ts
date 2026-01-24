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
  for (let i = 0; i < destructors.length; i++) {
    destructors[i]();
  }
  // Return array to pool for reuse
  releaseDestructorArray(destructors);
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
  let result;
  for (let i = 0; i < destructors.length; i++) {
    result = destructors[i]();
    if (result) {
      promises.push(result as Promise<void>);
    }
  }
  // Return array to pool for reuse
  releaseDestructorArray(destructors);
}
export function registerDestructor(ctx: object, ...fn: Destructors) {
  let existingDestructors = $dfi.get(ctx);
  if (existingDestructors === undefined) {
    existingDestructors = getDestructorArray();
    $dfi.set(ctx, existingDestructors);
  }
  existingDestructors.push(...fn);
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
