import { cell, type Cell, cellFor, formula } from '@lifeart/gxt';

export function createComputeRef(fn: () => unknown) {
  return formula(fn, 'ComputeRef');
}
export function createConstRef(value: unknown, debugLabel = 'ConstRef') {
  return cell(value, debugLabel);
}
export function createUnboundRef(value: unknown, debugLabel = 'UnboundRef') {
  return cell(value, debugLabel);
}
export function createPrimitiveRef(
  value: unknown,
  debugLabel = 'PrimitiveRef',
) {
  return cell(value, debugLabel);
}
export function childRefFor(value: Cell<object>, path: string) {
  // @ts-expect-error
  return cellFor(value.value, path);
}
export function valueForRef(ref: Cell<unknown>) {
  return ref.value;
}
export const UNDEFINED_REFERENCE = Symbol('undefined-reference');
