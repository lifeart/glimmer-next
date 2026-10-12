import { unwrap } from './-private';
import { emberAnd } from './ember-keywords';

export function $__and(...args: unknown[]) {
  if (EMBER_NATIVE) return emberAnd(args); // G-kw: Ember toBool + value semantics
  return args.every((arg) => !!unwrap(arg));
}
