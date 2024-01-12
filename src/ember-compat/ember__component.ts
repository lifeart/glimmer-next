import { $template, Component } from '../utils';
import { TEMPLATE_ONLY } from './ember__component__template-only';
export const TEMPLATE_META = new Map();
export function setComponentTemplate(tpl: any, cmp: any) {
  if (cmp.TEMPLATE_ONLY === TEMPLATE_ONLY) {
    // console.log(cmp);
    TEMPLATE_META.set(tpl, cmp);
    return tpl;
  } else {
    return class extends cmp {
      [$template] = tpl.bind(this);
    };
  }
}

export default class EmberComponent extends Component {
  constructor() {
    // @ts-expect-error
    super(...arguments);
    console.log('EmberComponent', ...arguments);
  }
}
