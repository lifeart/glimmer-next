import { isTag } from './-private';

export function $__or(...args: unknown[]) {
  return args.find((arg) => {
    return isTag(arg) ? !!arg.value : !!arg;
  });
}
