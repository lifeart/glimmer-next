import { ComponentLike } from '@glint/template';
import { Cell } from './cell';

type ElementType = ShadowRoot | Element | Cell<Element>;
type ElementFn = () => ElementType;
export type InElementKeyword = ComponentLike<{
  Args: {
    Positional: [element: ElementType | ElementFn];
    Named: {
      insertBefore?: null | undefined;
    };
  };
  Blocks: {
    default: [];
  };
}>;
