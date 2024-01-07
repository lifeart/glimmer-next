import { Component, cell } from '@lifeart/gxt';
import { Button } from './Button.gts';
import { PageOne} from './pages/PageOne.gts';
import { PageTwo } from './pages/PageTwo.gts';

export class Router extends Component {
    isLocked = false;
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
    }
    routeOne = cell(true);
    routeTwo = cell(false);
    modifier = (element: HTMLDivElement) => {
        element.style.transform = 'translateX(-100%)';
        let coords!: DOMRect;
        requestAnimationFrame(() => {
            coords = element.getBoundingClientRect();
            element.style.transform = 'translateX(0)';
        })
        setTimeout(() => {
            this.isLocked = false;
        }, 1000);
        return async () => {
            element.style.position = 'fixed';
            element.style.top = `${coords.top}px`;
            element.style.transform = 'translateX(100%)';
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    <template>
        <Button class={{if this.routeOne 'active'}} @onClick={{this.goToRouteOne}}>
            <:slot>Route One</:slot>
        </Button>
        <Button class={{if this.routeTwo 'active'}} @onClick={{this.goToRouteTwo}}>
            <:slot>Route Two</:slot>
        </Button>
        <style>
            .page {
                transform: translate3d(0);
                transition: opacity 0.5s ease-in-out, transform 1s ease-in-out;
                opacity: 1;
                min-height: 160px;
                width: 100vw;
                padding: 20px;
                color: white;
                background-color: rgba(0,0,0,0.5)
            }
            .active {
                background-color: yellow;
            }
        </style>
        {{#if this.routeOne}}
            <div class="page" {{this.modifier}}><PageOne @name="1" /></div>
        {{/if}}
        {{#if this.routeTwo}}
            <div class="page" {{this.modifier}}><PageTwo @name="2" /></div>
        {{/if}}
    </template>
}