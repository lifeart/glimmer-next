import { type AnyCell } from './reactive';

export const isTag = Symbol('isTag');

export function isFn(value: unknown): value is Function {
  return typeof value === 'function';
}
export function isPrimitive(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number';
}

export function isTagLike(child: unknown): child is AnyCell {
  return (child as AnyCell)[isTag];
}
