import { Component } from './component';
import { getContext } from './context';

export const SUSPENSE_CONTEXT = Symbol('suspense');

export type SuspenseContext = {
  start: () => void;
  end: () => void;
};

export function followPromise<T extends Promise<any>>(ctx: Component<any>, promise: T): T {
  getContext<SuspenseContext>(ctx, SUSPENSE_CONTEXT)?.start();
  // Add no-op catch to prevent unhandled rejection from the .finally() chain
  // The original promise rejection is still propagated to the caller
  promise.finally(() => {
    Promise.resolve().then(() => {
      getContext<SuspenseContext>(ctx, SUSPENSE_CONTEXT)?.end();
    });
  }).catch(() => {});
  return promise;
}
