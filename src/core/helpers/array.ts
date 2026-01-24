import { unwrap } from './-private';

export function $__array(...params: unknown[]) {
  // Unwrap all args (they may be getters in compat mode)
  return params.map(unwrap);
}
