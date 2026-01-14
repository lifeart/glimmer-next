// Hash helper can be called in two ways:
// 1. Directly: $__hash({ key: value }) - from template compiler for non-ember helpers
// 2. Via helperManager: $__hash([], { key: value }) - when registered as Ember helper
export function $__hash(
  argsOrObj: unknown[] | Record<string, unknown>,
  hashParams?: Record<string, unknown>,
) {
  // Determine the actual hash object based on calling convention
  let obj: Record<string, unknown>;

  if (Array.isArray(argsOrObj)) {
    // Called via helperManager: (args, hash) format
    obj = hashParams ?? {};
  } else {
    // Called directly: (obj) format
    obj = argsOrObj ?? {};
  }

  const newObj: Record<string, unknown> = {};
  Object.keys(obj).forEach((key) => {
    Object.defineProperty(newObj, key, {
      get() {
        const value = obj[key];
        if (typeof value === 'function') {
          return value.call(obj);
        } else {
          return value;
        }
      },
      set() {
        if (IS_DEV_MODE) {
          throw new Error('unable to set hash object');
        }
      },
      enumerable: true,
    });
  });
  return newObj;
}
