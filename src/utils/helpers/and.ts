import { isTag } from './-private';

export function $__and(...args: unknown[]) {
  return args.every((arg) => {
    if (isTag(arg)) {
      return !!arg.value;
    }
    return !!arg;
  });
}
