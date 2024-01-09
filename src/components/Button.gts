import type { ComponentLike } from '@glint/template';
type ButtonSignature = {
  Args: {
    onClick?: () => void;
  };
  Element: HTMLButtonElement;
  Blocks: {
    default: [];
  };
};
// @glint-ignore: 1
export const Button: ComponentLike<ButtonSignature> = <template>
  {{! @glint-expect-error: ...attributes }}
  <button class='btn' ...attributes {{on 'click' @onClick}} type='button'>
    {{! @glint-expect-error: yield }}
    {{yield}}
  </button>
</template>;
