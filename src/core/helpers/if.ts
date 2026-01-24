import { unwrap } from './-private';

export function $__if(
  condition: unknown,
  ifTrue: unknown,
  ifFalse: unknown = '',
) {
  const cond = unwrap(condition);
  return cond ? ifTrue : ifFalse;
}
