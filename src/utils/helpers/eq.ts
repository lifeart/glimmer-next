import { isTag } from './-private';

export function $__eq(...args: unknown[]) {
  const firstValue = isTag(args[0]) ? args[0].value : args[0];
  return args.every((arg) => (isTag(arg) ? arg.value : arg) === firstValue);
}
