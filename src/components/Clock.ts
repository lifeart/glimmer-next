import { registerDestructor } from "@/utils/destroyable";
import { cell, formula } from "@/utils/reactive";
import { hbs, scope } from "@/utils/template";

export function Clock() {
  const time = cell(Date.now(), "time");

  const timeInterval = setInterval(() => {
    time.value = Date.now();
  }, 1000);

  const current = formula(() => {
    return new Date(time.value).toLocaleTimeString();
  });

  // @ts-expect-error this is not typed
  registerDestructor(this, () => {
    clearInterval(timeInterval);
  });

  scope({ current });

  return hbs`<span>{{current}}</span>`;
}
