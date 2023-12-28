import { Cell } from "@/utils/reactive";
import { hbs, scope } from "@/utils/template";

export function Smile() {
  const isVisible = new Cell(true, "isVisible");

  setInterval(() => {
    isVisible.update(!isVisible.value);
  }, 1000);

  scope({ isVisible });

  return hbs`{{#if isVisible}}😀{{else}}😉{{/if}}`;
}
