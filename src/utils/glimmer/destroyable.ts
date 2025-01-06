export type DestructorFn = () => void | Promise<void>;
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
  destroyedObjects.add(ctx);
  const destructors = $dfi.get(ctx);
  if (destructors === undefined) {
    return [];
  }
  $dfi.delete(ctx);
  const results: Promise<void>[] = [];
  for (let i = 0; i < destructors.length; i++) {
    let result = destructors[i]();
    if (result) {
      results.push(result as unknown as Promise<void>);
    }
  }
  return results;
}
export function registerDestructor(ctx: object, ...fn: Destructors) {
  const existingDestructors = $dfi.get(ctx) ?? [];
  existingDestructors.push(...fn);
  $dfi.set(ctx, existingDestructors);
}
export function unregisterDestructor(ctx: object, ...fn: Destructors) {
  const existingDestructors = $dfi.get(ctx) ?? [];
  $dfi.set(ctx, existingDestructors.filter((d) => {
    return !fn.includes(d);
  }));
}

export function isDestroyed(ctx: object) {
  return destroyedObjects.has(ctx);
}

export function associateDestroyableChild(parent: object, child: object) {
  registerDestructor(parent, () => {
    destroy(child);
  });
}
