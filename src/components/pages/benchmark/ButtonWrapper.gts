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
    <Button
      class='px-3 py-2 text-xs font-medium rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 hover:text-white border border-slate-600 transition-all shadow-sm'
      @onClick={{@onClick}}
      ...attributes
    >
      {{yield}}
    </Button>
  </template>
}
