import type { ComponentReturnType } from "./component";

export function hbs(_: TemplateStringsArray) {
  return {} as unknown as ComponentReturnType;
}
export function scope(items: Record<string, unknown>): void {
  if (typeof items !== 'object' || items === null) {
    throw new Error('scope() accepts only object');
  }
  // TODO: implement
}
