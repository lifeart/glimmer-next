import { cell, registerDestructor, hbs, scope } from '@lifeart/gxt';

function ifs(condition: number) {
  return new Date(condition).toLocaleTimeString();
}

function Display(props: { value: string }) {
  scope({ props, ifs, Display });
  return hbs`<span>{{ifs props.value}}{{log (eq props.value 10)}}
    <br>
    {{log  props.value (hash value=props.value name="static")}}
    {{#let props.value 'dddd' as |name1 dd|}}
      This is: {{name1}} / {{dd}}
      <br>
      {{#let (hash parent=name1 palue=123) as |name2|}}
        {{log name2 name2.palue name2.parent name1}}
        This is: {{name2.palue}} and parent {{name2.parent}}
        <br>
        {{#let "321" as |name3|}}
          This is: {{name3}}
        {{/let}}
      {{/let}}
    {{/let}}
  </span>`;
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
