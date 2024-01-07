export function $__eq(...args: unknown[]) {
  const firstValue = args[0];
  return args.every((arg) => arg === firstValue);
}
