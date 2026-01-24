import { unwrap } from './-private';

export function $__log(...args: unknown[]) {
  // Unwrap all args (they may be getters in compat mode)
  console.log(...args.map(unwrap));
  return '';
}
