import type { AnyCell } from '../reactive';
import { isTagLike } from '../shared';

export function isTag(arg: unknown): arg is AnyCell {
  if (typeof arg === 'object' && arg !== null && isTagLike(arg)) {
    return true;
  } else {
    return false;
  }
}
