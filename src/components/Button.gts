// import { type Component } from '@lifeart/gxt';

// type ButtonSignature = {
//   Args: {
//     onClick: () => void;
//   };
//   Element: HTMLButtonElement;
//   Blocks: {
//     slot: [];
//   };
// };
export const Button = <template>
  <button class='btn' ...attributes {{on 'click' @onClick}}>
    {{yield}}
  </button>
</template>;
