import { type AnyCell } from '../reactive';
export function $__if(
  condition: unknown,
  ifTrue: unknown,
  ifFalse: unknown = '',
) {
  if (typeof condition === 'object') {
    return (condition as AnyCell).value ? ifTrue : ifFalse;
  }
  return condition ? ifTrue : ifFalse;
}
