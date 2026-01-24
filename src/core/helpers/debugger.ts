import { unwrap } from './-private';

export function $__debugger(this: any, ...args: unknown[]) {
  // Unwrap all args (they may be getters in compat mode)
  console.info(this, ...args.map(unwrap));
  debugger;
  return '';
}
