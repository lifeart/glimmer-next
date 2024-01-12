export default function willDestroy(_: HTMLElement, cb: () => void) {
  return () => {
    cb();
  };
}
