import { Signal } from "signal-polyfill";
import { isRehydrationScheduled } from "./rehydration";
import { setIsRendering } from "./reactive";

let revalidateScheduled = false;
type voidFn = () => void;
let resolveRender: undefined | voidFn = undefined;
export const w = new Signal.subtle.Watcher(() => {
    scheduleRevalidate();
});

export let signalsToUnwatch: Signal.Computed<any>[] = [];
export function setResolveRender(value: () => void) {
  resolveRender = value;
}

export function scheduleRevalidate() {
  if (!revalidateScheduled) {
    if (IS_DEV_MODE) {
      if (isRehydrationScheduled()) {
        throw new Error('You can not schedule revalidation during rehydration');
      }
    }
    revalidateScheduled = true;
    Promise.resolve().then(async () => {
      await syncDom();
      if (resolveRender !== undefined) {
        resolveRender();
        resolveRender = undefined;
      }
      revalidateScheduled = false;
    });
  }
}
export async function syncDom() {
  setIsRendering(true);
  w.getPending().forEach((cell) => {
    cell.get();
  });
  w.unwatch(...signalsToUnwatch);
  w.watch();
  setIsRendering(false);
}

