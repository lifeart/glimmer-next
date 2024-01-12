import { type ComponentReturnType, renderComponent } from '@/utils/component';

export async function render(component: ComponentReturnType) {
  const targetElement = document.getElementById('ember-testing')!;
  // @ts-expect-error typings mismatch
  return renderComponent(new component(), targetElement);
}

export async function allSettled() {
  return new Promise((resolve) => {
    setTimeout(resolve);
  });
}

export function click(selector: string) {
  const element = document
    .getElementById('ember-testing')!
    .querySelector(selector);
  if (!element) {
    throw new Error(
      `Unable to find DOM element matching selector: ${selector}`,
    );
  }
  const event = new MouseEvent('click', {
    view: window,
    bubbles: true,
    cancelable: true,
  });
  element!.dispatchEvent(event);
}

export function step(message: string) {
  QUnit.assert.pushResult({
    message: `[Step] ${message}`,
    result: true,
    expected: true,
    actual: true,
  });
}
