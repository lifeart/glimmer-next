export type DestructorFn = () => void | Promise<void>;
export type Destructors = Array<DestructorFn>;

// destructorsForInstance
const $dfi: WeakMap<object, Destructors> = new WeakMap();
const destroyedObjects = new WeakSet<object>();

export function destroy(ctx: object) {
  destroyedObjects.add(ctx);
  if (!$dfi.has(ctx)) {
    return;
  }
  $dfi.get(ctx)!.forEach((d) => {
    d();
  });
  $dfi.delete(ctx);
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
