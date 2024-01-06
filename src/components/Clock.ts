import { cell, registerDestructor, hbs, scope } from '@lifeart/gxt';

function Display(props: { value: string }) {
  scope({ props });
  return hbs`<span>{{props.value}}</span>`;
}

export function Clock(this: any) {
  const time = cell(Date.now(), 'time');

  const timeInterval = setInterval(() => {
    time.value = Date.now();
  }, 1000);

  Object.defineProperty(this, 'current', {
    get() {
      return new Date(time.value).toLocaleTimeString();
    },
    set() {},
  });

  registerDestructor(this, () => {
    clearInterval(timeInterval);
  });

  scope({ Display });

  return hbs`<span><Display @value={{this.current}} /></span>`;
}
