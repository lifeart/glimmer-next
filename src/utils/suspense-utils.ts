import { Component } from './component';
import { getContext } from './context';

export const SUSPENSE_CONTEXT = Symbol('suspense');

export type SuspenseContext = {
  start: () => void;
  end: () => void;
};

/**
 * Track a promise within a suspense boundary.
 *
 * Calls `start()` on the nearest suspense context when invoked,
 * and `end()` when the promise settles (resolves or rejects).
 *
 * @param ctx - The component context to find the suspense boundary from
 * @param promise - The promise to track
 * @returns A promise that resolves/rejects with the same value as the input,
 *          but guarantees that `end()` has been called when awaited
 *
 * @example
 * ```ts
 * const data = await followPromise(this, fetch('/api/data'));
 * // At this point, suspense end() has been called
 * ```
 */
export function followPromise<T extends Promise<any>>(
  ctx: Component<any>,
  promise: T,
): Promise<Awaited<T>> {
  const suspense = getContext<SuspenseContext>(ctx, SUSPENSE_CONTEXT);
  suspense?.start();
  return promise.finally(() => suspense?.end()) as Promise<Awaited<T>>;
}
