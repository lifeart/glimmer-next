import type { ComponentLike } from '@glint/template';

type ArrayLike<T> = ReadonlyArray<T> | Iterable<T> | Array<T>;

export type EachKeyword = abstract new <T = any>() => InstanceType<
  ComponentLike<{
    Args: {
      Positional: [items: ArrayLike<T> | null | undefined];
      Named: { key?: string, sync?: boolean };
    };
    Blocks: {
      default: [T, number];
    };
  }>
>;