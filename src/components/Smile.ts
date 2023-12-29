import { cell } from "@/utils/reactive";
import { hbs, scope } from "@/utils/template";

export function Smile() {
  const isVisible = cell(true, "isVisible");

  const interval = setInterval(() => {
    isVisible.update(!isVisible.value);
  }, 1000);

  const destructors = [() => {
    clearInterval(interval);
  }];

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

  scope({ isVisible, destructors, fadeOut });

  // @todo - fix case when destructors binded to node may change, likely we need to create a new comment node, and keep it stable;
  // upd: fixed, need to add tests for it
  return hbs`{{#if isVisible}}<span {{fadeOut}}>😀</span>{{else}}<span {{fadeOut}}>😉</span>{{/if}}`;
}
