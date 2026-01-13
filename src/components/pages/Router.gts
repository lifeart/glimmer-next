import { Component, cell, registerDestructor } from '@lifeart/gxt';
import { Button } from './../Button.gts';
import { PageOne } from './PageOne.gts';
import { PageTwo } from './PageTwo.gts';
import { Benchmark } from './Benchmark.gts';
import { Renderers } from './Renderers.gts';
import { Tests } from './Tests.gts';
import { Header } from '@/components/Header.gts';

// another router example, with animation
export class Router extends Component {
  isLocked = false;
  renderCount = 0;
  isDestroyCalled = false;
  animationTime = 500;
  constructor() {
    // @ts-expect-error args
    super(...arguments);
    registerDestructor(this, () => {
      this.isDestroyCalled = true;
    });
  }
  goToRoute = (name: string) => {
    if (this.isLocked) {
      return;
    }
    const target = this.routes.find((el) => el.name === name)!.state;
    if (!target || target.value) {
      return;
    }
    const prevRoutes = this.routes
      .filter((el) => el.state.value)
      .map((el) => el.state);
    target.update(true);
    prevRoutes.forEach((el) => el.update(false));

    this.isLocked = true;
  };
  routes = [
    {
      name: 'routeOne',
      text: 'Into',
      state: cell(true, 'routeOne active'),
      Component: PageOne,
    },
    {
      name: 'routeTwo',
      text: 'Goals',
      state: cell(false, 'routeTwo active'),
      Component: PageTwo,
    },
    {
      name: 'benchmark',
      text: 'Benchmark',
      state: cell(false, 'benchmark active'),
      Component: Benchmark,
    },
    {
      name: 'renderers',
      text: 'Renderers',
      state: cell(false, 'renderers active'),
      Component: Renderers,
    },
    {
      name: 'tests',
      text: 'Tests',
      state: cell(false, 'tests active'),
      Component: Tests,
    },
  ];
  modifier = (element: HTMLDivElement): any => {
    if (this.renderCount !== 0) {
      element.style.transform = 'translateX(100%)';
      element.style.opacity = '0.01';
    }
    this.renderCount++;
    let coords!: DOMRect;
    if (import.meta.env.SSR) {
      return;
    }
    element.style.top = `80px`;
    requestAnimationFrame(() => {
      coords = element.getBoundingClientRect();
      element.style.position = 'absolute';
      element.style.opacity = '1';
      element.style.transform = 'translateX(0)';
    });
    element.style.zIndex = String(this.renderCount);
    setTimeout(() => {
      this.isLocked = false;
    }, this.animationTime);
    return async () => {
      if (this.isDestroyCalled) {
        return;
      }
      element.style.position = 'absolute';
      element.style.zIndex = String(parseInt(element.style.zIndex) - 2);
      element.style.opacity = '0.01';
      element.style.transform = 'translateX(-20%)';
      await new Promise((resolve) => setTimeout(resolve, this.animationTime));
    };
  };
  <template>
    {{! 
        We need to fix case with bounds removal,
        at the moment we removing first registered node of the component 
        or placeholder if it's not static, but we need to remove from start to end.
        And likely add start-stop bounds to every component.
     }}

    <Header>

      <:desktop>
        {{#each this.routes key='name' as |route|}}
          <Button
            class={{if route.state 'text-blue-400 bg-slate-800'}}
            {{! @glint-expect-error object-ligeral with same props }}
            class='px-4 py-2 text-sm font-medium rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-all'
            @onClick={{fn this.goToRoute route.name}}
          >
            {{route.text}}
          </Button>
        {{/each}}
      </:desktop>
      <:mobile>
        {{#each this.routes key='name' as |route|}}
          <Button
            class={{if route.state 'text-blue-400 bg-slate-700'}}
            {{! @glint-expect-error object-ligeral with same props }}
            class='w-full px-3 py-3 text-left rounded-lg text-base font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition-colors'
            @onClick={{fn this.goToRoute route.name}}
          >
            {{route.text}}
          </Button>
        {{/each}}
      </:mobile>

    </Header>
    <style>
      .route-container {background-color: #0f172a; min-height:100vh; width:100vw;}
      .page {
        box-shadow: -10px 0 30px rgba(0, 0, 0, 0.3);
        transition: opacity 0.5s ease-out, transform 0.5s ease-out;
        opacity: 1;
        min-height: 100vh;
        width: 100vw;
        color: white;
        background-color: #0f172a;
        overflow-y: auto;
      }
    </style>
    <div class='route-container'>
      {{#each this.routes as |route|}}
        {{#if route.state}}
          <div class='page' {{this.modifier}}><route.Component /></div>
        {{/if}}
      {{/each}}
    </div>
  </template>
}
