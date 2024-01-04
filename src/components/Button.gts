import { Component } from "@/utils/component";

type ButtonSignature = {
  Args: {
    onClick: () => void;
  },
  Element: HTMLButtonElement
  Blocks: {
    slot: [];
  }
}
export class Button extends Component<ButtonSignature> {
  <template>
    <button class="btn" ...attributes {{on 'click' @onClick}}>
            {{yield to="slot"}}
        </button>
  </template>
}
