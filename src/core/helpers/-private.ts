import type { AnyCell } from '../reactive';
import { isTagLike } from '../shared';

/**
 * Check if a value is a Cell/Tag (reactive value).
 */
export function isTag(arg: unknown): arg is AnyCell {
  if (typeof arg === 'object' && arg !== null && isTagLike(arg)) {
    return true;
  } else {
    return false;
  }
}

/**
 * Check if a value is a compiler-generated getter function.
 * The compiler wraps reactive values in arrow functions: `() => this.value`
 * Arrow functions have no `.prototype` property, while regular functions do.
 *
 * Note: This heuristic also matches async functions and bound functions,
 * but in compat mode (the default), these come through getters and are
 * handled correctly.
 */
export function isGetter(value: unknown): value is () => unknown {
  return typeof value === 'function' && !value.prototype;
}

/**
 * Unwrap a value - if it's a getter function, call it to get the actual value.
 * If it's a Tag (reactive cell), get its .value property.
 *
 * IMPORTANT: Only unwraps arrow functions (no prototype) to avoid calling
 * user callbacks or functions returned by helpers like `fn`.
 * The compiler generates getters as arrow functions: () => this.value
 *
 * Used by reactive helpers ($__if, $__eq, $__and, $__or, $__not) that need
 * to compare VALUES, not Cell references.
 */
export function unwrap(value: unknown): unknown {
  // Handle getter functions: () => actualValue
  if (isGetter(value)) {
    value = value();
  }
  // Handle reactive Tags/Cells
  if (isTag(value)) {
    return value.value;
  }
  return value;
}

const ARG_THUNK_FLAG = '$_isArgThunk';

/**
 * Mark `fn` as a compiler-emitted reactive ARG thunk and return it (identity).
 * Emitted by the compiler around the reactive getters of the arguments it
 * builds (`brandArgGetter`). A no-op on non-functions.
 */
export function $_argThunk<T>(fn: T): T {
  if (typeof fn === 'function') {
    (fn as any)[ARG_THUNK_FLAG] = true;
  }
  return fn;
}

/**
 * True when `fn` is a thunk the compiler marked as a reactive arg getter (via
 * `$_argThunk`). The arg-access layer invokes only these; every other function
 * value (a forwarded action, a `{{fn}}`/helper bound result) passes through.
 * Hosts (the Ember bridge) call this instead of shape heuristics
 * (`fn.length`/`fn.prototype`), which it retires — it is minification-proof.
 */
export function isArgThunk(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as any)[ARG_THUNK_FLAG] === true;
}
