import { isTag } from './-private';

export function $__if(
  condition: unknown,
  ifTrue: unknown,
  ifFalse: unknown = '',
) {
  if (isTag(condition)) {
    return condition.value ? ifTrue : ifFalse;
  }
  return condition ? ifTrue : ifFalse;
}
