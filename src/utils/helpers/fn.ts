export function $__fn(fn: Function, ...args: unknown[]) {
  return (...tail: unknown[]) => {
    return fn(...args, ...tail);
  };
}
