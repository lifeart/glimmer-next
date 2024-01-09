import { type AnyCell } from './reactive';

export const isTag = Symbol('isTag');
export const $template = 'template' as const;
export const $nodes = 'nodes' as const;
export const $args = 'args' as const;
export const $fwProp = '$fw' as const;
export const $node = 'node' as const;
export const $slotsProp = 'slots' as const;
export const $propsProp = 'props' as const;
export const $attrsProp = 'attrs' as const;
export const $eventsProp = 'events' as const;

export function isFn(value: unknown): value is Function {
  return typeof value === 'function';
}
export function isPrimitive(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number';
}

export function isTagLike(child: unknown): child is AnyCell {
  return (child as AnyCell)[isTag];
}
