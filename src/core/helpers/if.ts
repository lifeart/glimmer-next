import { unwrap } from './-private';
import { emberIf } from './ember-keywords';

export function $__if(
  condition: unknown,
  ifTrue: unknown,
  ifFalse: unknown = '',
) {
  if (EMBER_NATIVE) return emberIf(condition, ifTrue, ifFalse); // G-kw: Ember toBool
  const cond = unwrap(condition);
  const result = cond ? ifTrue : ifFalse;
  return unwrap(result);
}
