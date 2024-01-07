import { cell, registerDestructor, hbs, scope } from '@lifeart/gxt';

function ifs(condition: number) {
  return new Date(condition).toLocaleTimeString();
}

function Display(props: { value: string }) {
  scope({ props, ifs });
  return hbs`<span>{{ifs props.value}}{{log (eq props.value 10)}}</span>`;
}

export function Clock(this: any) {
  const time = cell(Date.now(), 'time');

  const timeInterval = setInterval(() => {
    time.value = Date.now();
  }, 1000);

  Object.defineProperty(this, 'current', {
    get() {
      return time.value;
    },
    set() {},
  });

  registerDestructor(this, () => {
    clearInterval(timeInterval);
  });

  scope({ Display });

  return hbs`<span><Display @value={{this.current}} /></span>`;
}
