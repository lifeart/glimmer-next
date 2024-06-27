export type DestructorFn = () => void | Promise<void>;
export type Destructors = Array<DestructorFn>;

// destructorsForInstance
const $dfi: WeakMap<object, Destructors> = new WeakMap();
const destroyedObjects = new WeakSet<object>();
const destroyStack = new WeakMap<object, any>();
export function destroy(ctx: object) {
  if (destroyedObjects.has(ctx)) {
    console.info('Already destroyed', ctx.debugName || ctx.constructor.name);
    console.warn(new Error().stack);
    console.warn(destroyStack.get(ctx));
    return;
  }
  destroyedObjects.add(ctx);
  destroyStack.set(ctx, new Error().stack);
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
