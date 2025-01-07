export type DestructorFn = () => void | Promise<void> | Promise<void[]>;
export type Destructors = Array<DestructorFn>;

// destructorsForInstance
const $dfi: WeakMap<object, Destructors> = new WeakMap();
const destroyedObjects = new WeakSet<object>();

if (!import.meta.env.SSR) {
  if (IS_DEV_MODE) {
    window['getDestructors'] = () => $dfi;
  }
}
export function destroy(ctx: object) {
  if (destroyedObjects.has(ctx)) {
    if (import.meta.env.DEV) {
      console.warn(`Trying to destroy already destroyed node`);
    }
    return [];
  }
  destroyedObjects.add(ctx);
  const destructors = $dfi.get(ctx);
  if (destructors === undefined) {
    return [];
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
