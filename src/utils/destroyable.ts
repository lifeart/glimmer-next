export type DestructorFn = () => void | Promise<void>;
export type Destructors = Array<DestructorFn>;

// destructorsForInstance
const $dfi: WeakMap<object, Destructors> = new WeakMap();
export function executeDestructors(ctx: object) {
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
