import { isTag } from './-private';

export function $__not(arg: unknown) {
  if (isTag(arg)) {
    return !arg.value;
  }
  return !arg;
}
