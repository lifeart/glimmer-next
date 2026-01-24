import { unwrap } from './-private';

export function $__and(...args: unknown[]) {
  return args.every((arg) => !!unwrap(arg));
}
