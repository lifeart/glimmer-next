import { registerDestructor } from "@/utils/destroyable";
import { cell } from "@/utils/reactive";
import { hbs, scope } from "@/utils/template";
import { effect } from "@/utils/vm";

export function Smile(this: object) {
  const isVisible = cell(true, "isVisible");

  const interval = setInterval(() => {
    isVisible.update(!isVisible.value);
  }, 1000);

  let ticker = 0;

  const destroyEffect = effect(() => {
    ticker++;
    let localTicker = ticker;
    console.info(`smile is rendered with value: ${String(isVisible.value)}, ${localTicker}`);
    return () => {
      console.log(`destroying effect: ${localTicker}`);
    }
  });

  setTimeout(() => {
    console.log('destroying effect before component is destroyed:');
    destroyEffect();
  }, 5000);

  const fadeOut = (element: HTMLSpanElement) => {
    element.style.opacity = "0.1";
    element.style.transition = "opacity 0.2s linear";

    setTimeout(() => {
      element.style.opacity = "1";
    }, 100);

    return async () => {
      element.style.opacity = "0";
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
