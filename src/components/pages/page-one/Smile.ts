import { registerDestructor, hbs, scope } from '@lifeart/gxt';
import { cell } from '@lifeart/gxt';
import { effect } from '@lifeart/gxt';

export function Smile(this: object) {
  const isVisible = cell(true, 'isVisible');

  const interval = setInterval(() => {
    if (import.meta.env.SSR) {
      return;
    }
    isVisible.update(!isVisible.value);
  }, 1000);

  let ticker = 0;

  if (!import.meta.env.SSR) {
    const destroyEffect = effect(() => {
      ticker++;
      let localTicker = ticker;
      return () => {
        console.log(`destroying effect: ${localTicker}`);
      };
    });

    setTimeout(() => {
      console.log('destroying effect before component is destroyed:');
      destroyEffect();
    }, 5000);
  }

  const fadeOut = (element: HTMLSpanElement) => {
    if (import.meta.env.SSR) {
      return;
    }
    element.style.opacity = '0.1';
    element.style.transition = 'opacity 0.2s linear';

    setTimeout(() => {
      element.style.opacity = '1';
    }, 100);

    return async () => {
      element.style.opacity = '0';
      await new Promise((resolve) => setTimeout(resolve, 200));
    };
  };

  registerDestructor(this, () => {
    clearInterval(interval);
  });

  scope({ isVisible, fadeOut });

  // upd: fixed, need to add tests for it
  return hbs`{{#if isVisible}}<span {{fadeOut}}>😀</span>{{else}}<span {{fadeOut}}>😉</span>{{/if}}`;
}
