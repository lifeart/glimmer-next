import { ComponentLike } from '@glint/template';
import { Cell } from './cell';

type ArrayLike<T> = ReadonlyArray<T> | Iterable<T>;

export type EachKeyword = abstract new <T = any>() => InstanceType<
  ComponentLike<{
    Args: {
      Positional: [items: ArrayLike<T> | Cell<ArrayLike<T>> | null | undefined];
      Named: { key?: string; sync?: true };
    };
    Blocks: {
      default: [T, number];
      else: [];
    };
  }>
>;
