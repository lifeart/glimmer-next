export function $__hash(obj: Record<string, unknown>) {
  const newObj = {};
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
