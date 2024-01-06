import { Component, hbs } from '@lifeart/gxt';

type InputArgs = {
  value: string;
};

export class Input extends Component<InputArgs> {
  onChange = (e: Event) => {
    console.log('change', e);
  };
  template = hbs`<input
        {{on 'change' this.onChange}} 
        type="text" 
        value={{@value}}
     />`;
}
