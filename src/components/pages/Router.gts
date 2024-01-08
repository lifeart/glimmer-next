import { Component, cell, registerDestructor } from '@lifeart/gxt';
import { Button } from './../Button.gts';
import { PageOne } from './PageOne.gts';
import { PageTwo } from './PageTwo.gts';

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
      text: 'Route One',
      state: cell(true),
      Component: PageOne,
    },
    {
      name: 'routeTwo',
      text: 'Route Two',
      state: cell(false),
      Component: PageTwo,
    },
  ];
  modifier = (element: HTMLDivElement): any => {
    if (this.renderCount !== 0) {
      element.style.transform = 'translateX(100%)';
      element.style.opacity = '0.01';
    }
    this.renderCount++;
    let coords!: DOMRect;
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
    <div>
      {{! ToDo - fix case where each not removed without wrapper div }}
      {{#each this.routes as |route|}}
        <Button
          class={{if route.state 'active'}}
          @onClick={{fn this.goToRoute route.name}}
        >
          <:slot>{{route.text}}</:slot>
        </Button>
      {{/each}}
    </div>
    <style>
      .route-container {background-color: black;min-height: 280px;width:100vw;}
      .page { box-shadow: -9px 0 20px 0px #ddd; transition: opacity 0.5s
      ease-out, transform 0.5s ease-out; opacity: 1; min-height: 240px; width:
      100vw; padding: 20px; color: white; background-color: black; } .active {
      background-color: yellow; }
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
