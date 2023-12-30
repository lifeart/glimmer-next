import { Component } from "@/utils/component";

export class Checkbox extends Component {
  onChange = (e) => {
    console.log("change", e);
  };
  <template>
    <input 
        type="checkbox" 
        checked={{@isChecked}} 
        {{on "change" this.onChange}} />
  </template>
}
