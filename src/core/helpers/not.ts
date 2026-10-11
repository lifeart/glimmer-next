import { unwrap } from './-private';
import { emberNot } from './ember-keywords';

export function $__not(arg: unknown) {
  // G-kw: Ember toBool + arity assert (rest args only in EMBER_NATIVE builds).
  // eslint-disable-next-line prefer-rest-params
  if (EMBER_NATIVE) return emberNot(Array.prototype.slice.call(arguments));
  return !unwrap(arg);
}
