import { renderComponent, runDestructors, Component, cell } from '@lifeart/gxt';
import { PageOne } from './pages/PageOne.gts';
import { PageTwo } from './pages/PageTwo.gts';
import { PageThree } from './pages/PageThree.gts';
import { Benchmark } from './pages/Benchmark.gts';
import { NestedRouter } from './pages/NestedRouter.gts';
import { router } from './../services/router';
export class Application extends Component {
  router = router;
  rootNode!: HTMLElement;
  components = {
    pageOne: PageOne,
    pageTwo: PageTwo,
    main: PageThree,
    benchmark: Benchmark,
  };
  async destroy() {
    await Promise.all(runDestructors(this.rootNode));
    this.rootNode.innerHTML = '';
    this.rootNode = null!;
  }
  constructor(rootNode: HTMLElement) {
    super({});
    this.rootNode = rootNode;
    renderComponent(this, this.rootNode);
    // router init
    requestAnimationFrame(() => {
      router.mount(window.location.pathname);
    });
  }
  <template>
    <div class='container'>
      <NestedRouter
        @components={{this.components}}
        @stack={{this.router.stack}}
      />
    </div>
  </template>
}
