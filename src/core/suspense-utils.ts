import { Component } from './component';
import { getContext } from './context';
import { registerDestructor } from './glimmer/destroyable';

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
 * The promise is also registered with the destructor tree so that
 * component destruction waits for pending async operations.
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
  // SUSPENSE_CONTEXT is optional - only provided when inside a Suspense boundary
  const suspense = getContext<SuspenseContext>(ctx, SUSPENSE_CONTEXT, false);
  suspense?.start();

  // Wrap the promise with .finally() to ensure end() is called
  const trackedPromise = promise.finally(() => suspense?.end()) as Promise<Awaited<T>>;

  // Register the promise with the destructor tree so destruction waits for it.
  // We use .catch(() => {}) to ensure the destructor never rejects,
  // as rejected destructors would break the destruction flow.
  // The original promise rejection is still propagated to the caller via trackedPromise.
  registerDestructor(ctx, () => trackedPromise.catch(() => {}));

  return trackedPromise;
}
