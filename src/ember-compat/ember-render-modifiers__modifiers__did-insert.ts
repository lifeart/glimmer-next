export default function didInsert(
  el: HTMLElement,
  fb: (el: HTMLElement) => void,
) {
  requestAnimationFrame(() => {
    if (typeof fb !== 'function') {
      console.warn(
        'ember-render-modifiers: didInsert modifier must be a function',
      );
      return;
    }
    fb(el);
  });
}
