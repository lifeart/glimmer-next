import { isArgThunk } from './-private';

/**
 * `(hash)`: an object whose members read their values when they are read.
 *
 * A member's getter is called when the member is read; any other value is the
 * member's value. Under the Ember dialect (WITH_EMBER_INTEGRATION) the getter
 * is one the compiler branded (`$_argThunk`, serializers/value.ts
 * `brandArgGetter`) and any other function — an action, a `(fn)` result — is
 * the member's value, returned as it is; a standalone build calls every
 * function (the compiler wraps every member in a getter).
 */
export function $__hash(obj: Record<string, unknown>) {
  const newObj = {};
  Object.keys(obj).forEach((key) => {
    Object.defineProperty(newObj, key, {
      get() {
        const value = obj[key];
        if (
          typeof value === 'function' &&
          (!WITH_EMBER_INTEGRATION || isArgThunk(value))
        ) {
          return value.call(obj);
        }
        return value;
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
