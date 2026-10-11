import { unwrap } from './-private';
import { emberEq } from './ember-keywords';

export function $__eq(...args: unknown[]) {
  if (EMBER_NATIVE) return emberEq(args); // G-kw: Ember arity (exactly 2)
  const firstValue = unwrap(args[0]);
  return args.every((arg) => unwrap(arg) === firstValue);
}
