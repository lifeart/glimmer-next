import { Component } from '@lifeart/gxt';

export default class GlimmerComponent extends Component {
  constructor(owner: any, args: any, props: any) {
    console.log('glimmer-component:super', owner, args, props);
    // debugger;
    super(args, props);
  }
  static componentType = 'glimmer-component';
  willDestroy() {}
}
