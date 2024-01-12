export function typeOf(a: unknown) {
  return typeof a;
}
export function isEmpty(a: undefined) {
  return !!a;
}
export function isEqual(a: undefined, b: undefined) {
  return a === b;
}
export function isNone(obj: any): obj is null | undefined {
  return obj === null || obj === undefined;
}
