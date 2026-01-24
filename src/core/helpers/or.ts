import { unwrap } from './-private';

export function $__or(...args: unknown[]) {
  for (const arg of args) {
    const value = unwrap(arg);
    if (value) {
      return value;
    }
  }
  return args.length > 0 ? unwrap(args[args.length - 1]) : undefined;
}
