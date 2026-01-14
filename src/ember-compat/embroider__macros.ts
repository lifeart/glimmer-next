// @ts-expect-error unknown module
import * as gt from '@glimmer/tracking';
export function dependencySatisfies() {
  return true;
}
export function importSync(moduleName: string) {
  if (moduleName === '@glimmer/tracking') {
    return gt;
  }
  console.log('importSync', ...arguments);
  return {};
}
export function macroCondition() {
  return true;
}
