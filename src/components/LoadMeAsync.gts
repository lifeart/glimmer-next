import { context } from '@/utils/context';
import { SUSPENSE_CONTEXT } from '@/utils/suspense';
import { Component } from '@lifeart/gxt';

export default class LoadMeAsync extends Component<{
  Args: { name: string };
}> {
  constructor() {
    // @ts-ignore
    super(...arguments);
    console.log('LoadMeAsync created');
    this.suspense?.start();
  }
  @context(SUSPENSE_CONTEXT) suspense!: {
    start: () => void;
    end: () => void;
  };
  loadData = (_: HTMLElement) => {
    setTimeout(() => {
      this.suspense?.end();
      console.log('Data loaded');
    }, 2000);
  };
  <template>
    {{log 'loadMeAsync rendered'}}
    <div {{this.loadData}} class='inline-flex flex-col items-center'>Async
      component "{{@name}}"</div>
  </template>
}
