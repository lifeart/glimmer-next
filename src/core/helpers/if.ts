import { unwrap } from './-private';
import { emberIf } from './ember-keywords';

export function $__if(
  condition: unknown,
  ifTrue: unknown,
  ifFalse: unknown = '',
) {
  // G-kw: Ember toBool. Ember's inline `if` without an inverse is `undefined`
  // (an attribute bound to it is removed), not the '' default below.
  // eslint-disable-next-line prefer-rest-params
  if (EMBER_NATIVE) return emberIf(condition, ifTrue, arguments[2]);
  const cond = unwrap(condition);
  const result = cond ? ifTrue : ifFalse;
  return unwrap(result);
}
