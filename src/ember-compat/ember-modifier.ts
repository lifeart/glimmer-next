export const EmberFunctionalModifiers = new Set();

export function modifier(fn: (element: HTMLElement, properties: any[]) => any) {
  EmberFunctionalModifiers.add(fn);
  return fn;
}
export default class Modifier {
  static emberModifier = true;
  constructor() {
    console.info('ember-modifier created');
  }
}
