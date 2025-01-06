export type DestructorFn = () => void | Promise<void>;
export type Destructors = Array<DestructorFn>;

// destructorsForInstance
const $dfi: WeakMap<object, Destructors> = new WeakMap();
const destroyedObjects = new WeakSet<object>();

export function destroy(ctx: object) {
  if (destroyedObjects.has(ctx)) {
    return;
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
}
export function registerDestructor(ctx: object, fn: DestructorFn) {
  const existingDestructors = $dfi.get(ctx) ?? [];
  existingDestructors.push(fn);
  $dfi.set(ctx, existingDestructors);
}

export function isDestroyed(ctx: object) {
  return destroyedObjects.has(ctx);
}

export function associateDestroyableChild(parent: object, child: object) {
  registerDestructor(parent, () => {
    destroy(child);
  });
}
