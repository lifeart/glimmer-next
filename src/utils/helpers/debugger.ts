export function $__debugger(this: any, ...args: unknown[]) {
  console.info(this, ...args);
  debugger;
  return '';
}
