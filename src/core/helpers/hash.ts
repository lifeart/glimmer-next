export function $__hash(obj: Record<string, unknown>) {
  const newObj = {};
  Object.keys(obj).forEach((key) => {
    Object.defineProperty(newObj, key, {
      get() {
        const value = obj[key];
        if (typeof value === 'function') {
          // Don't call CurriedComponent functions — they should be preserved as-is
          // so they can be rendered later (e.g., {{object.comp}} in Ember's contextual components)
          const resolved = value.call(obj);
          if (resolved && (resolved as any).__isCurriedComponent) {
            return resolved;
          }
          return resolved;
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
