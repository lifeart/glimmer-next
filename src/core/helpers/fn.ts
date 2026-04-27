import { isTag, isGetter } from './-private';

/**
 * The `fn` helper for currying functions with bound arguments.
 *
 * Important: We only unwrap getter functions (arrow functions with no prototype),
 * NOT Cells. This is because:
 * - Getters like `() => this.value` should be evaluated at call time
 * - But Cells passed as arguments should remain as Cells so callbacks can call `.update()` on them
 *
 * Example: `{{fn this.updateCell this.myCell}}` - myCell should stay as a Cell
 *
 * Design notes:
 * - This helper is designed to work with IS_GLIMMER_COMPAT_MODE=true (the default)
 * - In compat mode, the compiler wraps arguments in getters for reactivity
 * - We unwrap these getters at call time, but preserve Cells for callback use
 * - Unlike `unwrap()` which unwraps both getters AND Cells, this only unwraps getters
 */
export function $__fn(fn: Function, ...args: unknown[]) {
  return (...tail: unknown[]) => {
    // Unwrap the function itself if it's a compiler-generated getter (e.g., () => this.myAction)
    // Compiler getters are zero-arg arrow functions that return functions.
    // We check: is it a getter? If so, call it — if the result is a function, use it.
    // Otherwise use the original (it was a real function, not a getter).
    let resolvedFn: Function = fn as Function;
    // Re-evaluate the wrapper getter on every invocation: in compat mode
    // `fn` is `() => this.action`, and we want each call to resolve the
    // current `this.action` value (which may have been replaced) and to
    // register a fresh tracking-frame dependency. Memoizing across calls
    // would cause stale-action and dropped-dependency bugs.
    if (isGetter(fn) && fn.length === 0) {
      const maybeResolved = (fn as () => unknown)();
      if (typeof maybeResolved === 'function') {
        resolvedFn = maybeResolved;
      }
    }
    // Unwrap getter functions but preserve Cells and other values
    const unwrappedArgs = args.map((arg) => {
      // Explicitly preserve Cells - they need to be passed to callbacks
      // for `.update()` calls to work
      if (isTag(arg)) {
        return arg;
      }
      // Unwrap compiler-generated getters (arrow functions)
      if (isGetter(arg)) {
        return arg();
      }
      // Keep other values as-is
      return arg;
    });
    return resolvedFn(...unwrappedArgs, ...tail);
  };
}
