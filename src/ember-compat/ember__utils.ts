export function typeOf(a: unknown) {
  return typeof a;
}
export function isEmpty(a: unknown): boolean {
  if (a === null || a === undefined) return true;
  if (typeof a === 'string') return a.length === 0;
  if (Array.isArray(a)) return a.length === 0;
  if (typeof a === 'object') return Object.keys(a).length === 0;
  return false;
}
export function isEqual(a: unknown, b: unknown): boolean {
  return a === b;
}
export function isNone(obj: unknown): obj is null | undefined {
  return obj === null || obj === undefined;
}
export function isBlank(obj: unknown): boolean {
  if (obj === null || obj === undefined) return true;
  if (typeof obj === 'string') return obj.trim().length === 0;
  if (Array.isArray(obj)) return obj.length === 0;
  return false;
}
export function isPresent(obj: unknown): boolean {
  return !isBlank(obj);
}
