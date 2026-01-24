import { unwrap } from './-private';

export function $__eq(...args: unknown[]) {
  const firstValue = unwrap(args[0]);
  return args.every((arg) => unwrap(arg) === firstValue);
}
