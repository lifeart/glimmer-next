import { Component } from '@lifeart/gxt';

import { repo } from './repo';

function isBlank(str: string) {
  return str.trim().length === 0;
}

export class Create extends Component {
  <template>
    <input
      class='new-todo'
      {{on 'keydown' this.createTodo}}
      aria-label='What needs to be done?'
      placeholder='What needs to be done?'
      autofocus
    />
  </template>

  createTodo = (event: Event) => {
    let { keyCode, target } = event as Event & {
      keyCode: number;
      target: HTMLInputElement;
    };
    let value = target.value.trim();

    if (keyCode === 13 && !isBlank(value)) {
      repo.add({ title: value, completed: false });
      target.value = '';
    }
  };
}
