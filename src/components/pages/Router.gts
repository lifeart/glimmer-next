import { Component, cell, registerDestructor } from '@lifeart/gxt';
import { Button } from './../Button.gts';
import { PageOne } from './PageOne.gts';
import { PageTwo } from './PageTwo.gts';
import { Benchmark } from './Benchmark.gts';
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
      state: cell(true),
      Component: PageOne,
    },
    {
      name: 'routeTwo',
      text: 'Goals',
      state: cell(false),
      Component: PageTwo,
    },
    {
      name: 'benchmark',
      text: 'Benchmark',
      state: cell(false),
      Component: Benchmark,
    },
    {
      name: 'tests',
      text: 'Tests',
      state: cell(false),
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
    requestAnimationFrame(() => {
      coords = element.getBoundingClientRect();
      element.style.position = 'absolute';
      element.style.opacity = '1';
      element.style.top = `${coords.top}px`;
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
      // console.log('element.style.zIndex', );
      element.style.zIndex = String(parseInt(element.style.zIndex) - 2);
      element.style.top = `${coords.top}px`;
      // debugger;
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
            class={{if route.state 'text-sky-500'}}
            {{! @glint-expect-error object-ligeral with same props }}
            class='text-sm font-semibold leading-6 text-gray-900'
            @onClick={{fn this.goToRoute route.name}}
          >
            {{route.text}}
          </Button>
        {{/each}}
      </:desktop>
      <:mobile>
        {{#each this.routes key='name' as |route|}}
          <Button
            class={{if route.state 'text-sky-500'}}
            {{! @glint-expect-error object-ligeral with same props }}
            class='-mx-3 block rounded-lg px-3 py-2 text-base font-semibold leading-7 text-gray-900 hover:bg-gray-50'
            @onClick={{fn this.goToRoute route.name}}
          >
            {{route.text}}
          </Button>
        {{/each}}
      </:mobile>

    </Header>
    <style>
      .route-container {background-color: black;height:100vh;width:100vw;} .page
      { box-shadow: -13px -15px 20px 0px #e3e3e3; transition: opacity 0.5s
      ease-out, transform 0.5s ease-out; opacity: 1; height: 100vh; width:
      100vw; padding: 20px; color: white; background-color: black; }
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
