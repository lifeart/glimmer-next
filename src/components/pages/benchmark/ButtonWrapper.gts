import { Component } from '@lifeart/gxt';
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
    <div class='mb-2'>
      <Button
        class='rounded bg-indigo-600 px-2 py-1 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600'
        @onClick={{@onClick}}
        ...attributes
      >
        {{yield}}
      </Button>
    </div>
  </template>
}
