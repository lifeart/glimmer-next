export const modifierManagers = new WeakMap();
export function setModifierManager(manager: any, modifier: any) {
  modifierManagers.set(modifier, manager);
  return modifier;
}
export function capabilities() {
  return {};
}
export function on() {
  console.log('on', ...arguments);
  return '';
}
