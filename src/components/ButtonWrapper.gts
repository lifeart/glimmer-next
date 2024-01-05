import { Component } from '@/utils/component';
import { Button } from '@/components/Button.gts';

type ButtonWrapperSignature = {
  Args: {
    onClick: () => void;
  };
  Element: HTMLButtonElement;
  Blocks: {
    default: [];
  };
};

export class ButtonWrapper extends Component<ButtonWrapperSignature> {
  <template>
    <div class='col-sm-6 smallpad'>
      <Button @onClick={{@onClick}} ...attributes>
        <:slot>
          {{yield}}
        </:slot>
      </Button>
    </div>
  </template>
}
