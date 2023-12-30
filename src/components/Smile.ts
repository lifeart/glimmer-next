import { cell, formula } from "@/utils/reactive";
import { hbs, scope } from "@/utils/template";
import { effect } from "@/utils/vm";

export function Smile() {
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

  const time = cell(Date.now(), 'time');

  const timeInterval = setInterval(() => {
    time.value = Date.now();
  }, 1000);

  const currentTime = formula(() => {
    return new Date(time.value).toLocaleString();
  })

  const destructors = [() => {
    clearInterval(interval);
    clearInterval(timeInterval);
  }, destroyEffect];

  scope({ isVisible, destructors, fadeOut, currentTime });




  // @todo - fix case when destructors binded to node may change, likely we need to create a new comment node, and keep it stable;
  // upd: fixed, need to add tests for it
  return hbs`{{#if isVisible}}<span {{fadeOut}}>😀</span>{{else}}<span {{fadeOut}}>😉</span>{{/if}}`;
}
