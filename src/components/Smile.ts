import { cell } from "@/utils/reactive";
import { hbs, scope } from "@/utils/template";

export function Smile() {
  const isVisible = cell(true, "isVisible");

  const interval = setInterval(() => {
    isVisible.update(!isVisible.value);
  }, 1000);

  const destructors = [() => clearInterval(interval)];

  scope({ isVisible, destructors });

  return hbs`{{#if isVisible}}😀{{else}}😉{{/if}}`;
}
