// import { next, cancel, later, scheduleOnce } from '@ember/runloop';
export function next() {
  console.log('next', ...arguments);
}
export function cancel() {
  console.log('cancel', ...arguments);
}
export function throttle(ctx: any, fn: () => void, timeout: number) {
  // implement function:
  setTimeout(() => {
    fn.call(ctx);
  }, timeout);
}
export function later(ctx: any, fn: () => void, delay = 10) {
  setTimeout(fn.bind(ctx), delay);
}
export function scheduleOnce(stage: 'afterRender', ctx: any, fn = () => {}) {
  if (stage === 'afterRender') {
    requestAnimationFrame(() => {
      fn.call(ctx);
    });
    return;
  }
  console.log('scheduleOnce', ...arguments);
}
