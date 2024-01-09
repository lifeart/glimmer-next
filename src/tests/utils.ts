import { ComponentReturnType, renderComponent } from "@/utils/component";

export async function render(component: ComponentReturnType) {
    const targetElement = document.getElementById('ember-testing')!;
    // @ts-expect-error typings mismatch
    return renderComponent(new component, targetElement)
  }
  

export function click(selector: string) {
    const element = document.querySelector(selector);
    const event = new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: true,
    });
    element!.dispatchEvent(event);
}