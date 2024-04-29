import { Component, type Cell } from '@lifeart/gxt';

export class Checkbox extends Component<{
  Args: { isChecked: Cell<boolean> };
}> {
  onChange = (e: Event) => {
    const { isChecked } = this.args;
    if (typeof isChecked === 'object') {
      isChecked.update(!isChecked.value);
    }
    console.log('change', e);
  };
  <template>
    <input
      type='checkbox'
      checked={{@isChecked}}
      {{on 'change' this.onChange}}
    />
  </template>
}
