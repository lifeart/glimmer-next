import { Component } from '@/utils/component';
import { hbs } from '@/utils/template';

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
