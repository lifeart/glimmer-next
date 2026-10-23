import { Component, cell } from '@lifeart/gxt';

export class Hello extends Component {
  count = cell(0);
  increment = () => {
    this.count.value = this.count.value + 1;
  };
  <template>
    <button type='button' {{on 'click' this.increment}}>Hello, clicked {{this.count}} times</button>
  </template>
}
