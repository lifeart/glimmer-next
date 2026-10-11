import { unwrap } from './-private';
import { emberOr } from './ember-keywords';

export function $__or(...args: unknown[]) {
  if (EMBER_NATIVE) return emberOr(args); // G-kw: Ember toBool + value semantics
  for (const arg of args) {
    const value = unwrap(arg);
    if (value) {
      return value;
    }
  }
  return args.length > 0 ? unwrap(args[args.length - 1]) : undefined;
}
