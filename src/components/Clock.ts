import { registerDestructor } from "@/utils/destroyable";
import { cell } from "@/utils/reactive";
import { hbs, scope } from "@/utils/template";


function Display(props: { value: string }) {
  console.log("Display", props);
  scope({ props });
  return hbs`<span>{{props.value}}</span>`;
}

export function Clock() {
  const time = cell(Date.now(), "time");

  const timeInterval = setInterval(() => {
    time.value = Date.now();
  }, 1000);

  Object.defineProperty(this, "current", {
    get() {
      return new Date(time.value).toLocaleTimeString();
    },
    set() {
    }
  });

  // @ts-expect-error this is not typed
  registerDestructor(this, () => {
    clearInterval(timeInterval);
  });

  scope({ Display });

  return hbs`<span><Display @value={{this.current}} /></span>`;
}
