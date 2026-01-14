// Array helper can be called in two ways:
// 1. Directly: $__array(...items) - from template compiler for non-ember helpers
// 2. Via helperManager: $__array([...items], {}) - when registered as Ember helper
export function $__array(
  firstArgOrArray: unknown | unknown[],
  ...restArgs: unknown[]
) {
  if (
    Array.isArray(firstArgOrArray) &&
    restArgs.length <= 1 &&
    (restArgs.length === 0 ||
      (typeof restArgs[0] === 'object' && restArgs[0] !== null))
  ) {
    // Called via helperManager: ([...items], hash) format
    return firstArgOrArray;
  }
  // Called directly: (...items) format
  return [firstArgOrArray, ...restArgs];
}
