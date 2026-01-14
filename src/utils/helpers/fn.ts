// Fn helper can be called in two ways:
// 1. Directly: $__fn(fn, ...args) - from template compiler for non-ember helpers
// 2. Via helperManager: $__fn([fn, ...args], {}) - when registered as Ember helper
export function $__fn(
  fnOrArgs: Function | unknown[],
  ...restArgs: unknown[]
) {
  let fn: Function;
  let args: unknown[];

  if (Array.isArray(fnOrArgs)) {
    // Called via helperManager: ([fn, ...args], hash) format
    [fn, ...args] = fnOrArgs as [Function, ...unknown[]];
  } else {
    // Called directly: (fn, ...args) format
    fn = fnOrArgs;
    args = restArgs;
  }

  return (...tail: unknown[]) => {
    return fn(...args, ...tail);
  };
}
