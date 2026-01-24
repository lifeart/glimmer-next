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
    return fn(...unwrappedArgs, ...tail);
  };
}
