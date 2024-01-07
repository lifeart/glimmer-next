import { Component, cell } from '@lifeart/gxt';
import { Button } from './../Button.gts';
import { PageOne } from './PageOne.gts';
import { PageTwo } from './PageTwo.gts';

// another router example, with animation
export class Router extends Component {
  isLocked = false;
  renderCount = 0;
  goToRouteOne = () => {
    if (this.isLocked || this.routeOne.value) return;
    this.routeOne.update(true);
    this.routeTwo.update(false);
    this.isLocked = true;
  };
  goToRouteTwo = () => {
    if (this.isLocked || this.routeTwo.value) return;
    this.routeTwo.update(true);
    this.routeOne.update(false);
    this.isLocked = true;
  };
  routeOne = cell(true);
  routeTwo = cell(false);
  modifier = (element: HTMLDivElement) => {
    if (this.renderCount !== 0) {
      element.style.transform = 'translateX(100%)';
      element.style.opacity = '0.01';
    }
    this.renderCount++;
    let coords!: DOMRect;
    requestAnimationFrame(() => {
      coords = element.getBoundingClientRect();
      element.style.position = 'fixed';
      element.style.opacity = '1';
      element.style.top = `${coords.top}px`;
      element.style.transform = 'translateX(0)';
    });
    element.style.zIndex = String(this.renderCount);
    setTimeout(() => {
      this.isLocked = false;
    }, 500);
    return async () => {
      element.style.position = 'fixed';
      // console.log('element.style.zIndex', );
      element.style.zIndex = String(parseInt(element.style.zIndex) - 2);
      element.style.top = `${coords.top}px`;
      // debugger;
      element.style.opacity = '0.01';
      element.style.transform = 'translateX(-20%)';
      await new Promise((resolve) => setTimeout(resolve, 500));
    };
  };
  <template>
    <Button class={{if this.routeOne 'active'}} @onClick={{this.goToRouteOne}}>
      <:slot>Route One</:slot>
    </Button>
    <Button class={{if this.routeTwo 'active'}} @onClick={{this.goToRouteTwo}}>
      <:slot>Route Two</:slot>
    </Button>
    <style>
      .route-container {background-color: black;min-height: 280px;width:100vw;}
      .page { 
          box-shadow: -9px 0 20px 0px #ddd;
      transition: opacity 0.5s ease-out,
      transform 0.5s ease-out; opacity: 1; min-height: 240px; width: 100vw;
      padding: 20px; color: white; background-color: black; } .active {
      background-color: yellow; }
    </style>
    <div class="route-container">
      {{#if this.routeOne}}
        <div class='page' {{this.modifier}}><PageOne @name='1' /></div>
      {{/if}}
      {{#if this.routeTwo}}
        <div class='page' {{this.modifier}}><PageTwo @name='2' /></div>
      {{/if}}
      </div>
  </template>
}
