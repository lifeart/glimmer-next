export type DestructorFn = () => void | Promise<void> | Promise<void[]>;
export type Destructors = Array<DestructorFn>;

// destructorsForInstance
const $dfi: WeakMap<object, Destructors> = new WeakMap();
const destroyedObjects = new WeakSet<object>();
const $ea = Object.seal(Object.freeze([])); // empty array;

if (!import.meta.env.SSR) {
  if (IS_DEV_MODE) {
    window['getDestructors'] = () => $dfi;
  }
}
const DESTROYED_NODES = new WeakMap();
export function destroy(ctx: object) {
  if (destroyedObjects.has(ctx)) {
    if (import.meta.env.DEV) {
      console.info(ctx, 'node-is-already-destroyed-here');
      console.error(DESTROYED_NODES.get(ctx));
      console.info('and trying to be re-destroyed here');
      console.error(new Error('here'));
      console.warn(`---------------`);
    }
    return $ea;
  }
  if (import.meta.env.DEV) {
    DESTROYED_NODES.set(ctx, new Error('here').stack);
  }
  destroyedObjects.add(ctx);
  const destructors = $dfi.get(ctx);
  if (destructors === undefined) {
    return $ea;
  }
  $dfi.delete(ctx);
  const results: Promise<void>[] = [];
  let result;
  for (let i = 0; i < destructors.length; i++) {
    result = destructors[i]();
    if (result) {
      results.push(result as Promise<void>);
    }
  }
  return results;
}
export function registerDestructor(ctx: object, ...fn: Destructors) {
  let existingDestructors = $dfi.get(ctx);
  if (existingDestructors === undefined) {
    existingDestructors = [];
    $dfi.set(ctx, existingDestructors);
  }
  existingDestructors.push(...fn);
}

export function isDestroyed(ctx: object) {
  return destroyedObjects.has(ctx);
}

export function associateDestroyableChild(parent: object, child: object) {
  registerDestructor(parent, () => {
    destroy(child);
  });
}
