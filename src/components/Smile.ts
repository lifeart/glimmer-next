import { cell } from "@/utils/reactive";
import { hbs, scope } from "@/utils/template";

export function Smile() {
  const isVisible = cell(true, "isVisible");

  const interval = setInterval(() => {
    isVisible.update(!isVisible.value);
  }, 1000);

  const destructors = [() => clearInterval(interval)];

  const fadeOut = (element: HTMLSpanElement) => {
    element.style.opacity = "0.1";
    element.style.transition = "opacity 0.2s linear";

    setTimeout(() => {
      element.style.opacity = "1";
    });

    return async () => {
      element.style.opacity = "0";
      await new Promise((resolve) => setTimeout(resolve, 200));
    };
  };

  scope({ isVisible, destructors, fadeOut });

  return hbs`{{#if isVisible}}<span {{fadeOut}}>😀</span>{{else}}<span {{fadeOut}}>😉</span>{{/if}}`;
}
