import { $template, Component } from '../utils';
import { TEMPLATE_ONLY } from './ember__component__template-only';
export const TEMPLATE_META = new Map();
export function setComponentTemplate(tpl: any, cmp: any) {
  if (cmp.TEMPLATE_ONLY === TEMPLATE_ONLY) {
    // For template-only components, wrap in a Component class
    // so that the component lifecycle is properly set up
    TEMPLATE_META.set(tpl, cmp);
    return class TemplateOnlyComponent extends Component {
      [$template] = tpl.bind(this);
    };
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
