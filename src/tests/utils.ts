import {
  type ComponentReturnType,
  destroyElementSync,
  renderComponent,
} from '@/utils/component';
import { getDocument } from '@/utils/dom-api';
import { withRehydration } from '@/utils/ssr/rehydration';
import {
  getRoot,
  resetNodeCounter,
  setRoot,
  resetRoot,
  createRoot,
} from '@/utils/dom';
import { renderInBrowser } from '@/utils/ssr/ssr';
import { runDestructors } from '@/utils/component';
import { registerDestructor } from '@/utils/glimmer/destroyable';
import { $args } from '../utils';
import { $context } from '@/utils/shared';

export async function cleanupRender() {
  const root = getRoot();
  if (root) {
    await Promise.all(runDestructors(root));
  }
  resetNodeCounter();
  resetRoot();
}

export function rehydrate(component: ComponentReturnType) {
  // @ts-expect-error typings mismatch
  withRehydration(component, renderTarget());
}
export async function ssr(component: any) {
  if (getRoot()) {
    throw new Error('Root already exists');
  }
  resetNodeCounter();
  let root = createRoot();
  setRoot(root);
  const content = await renderInBrowser(component);
  renderTarget().innerHTML = content;
  await Promise.all(runDestructors(root));
  resetNodeCounter();
  resetRoot();
}

export function renderTarget() {
  return getDocument().getElementById('ember-testing')!;
}

export async function render(component: ComponentReturnType) {
  const targetElement = getDocument().getElementById('ember-testing')!;
  if (getRoot()) {
    await cleanupRender();
  }
  if (targetElement.childNodes.length) {
    console.warn('testing container not empty, force cleanup');
    console.info(targetElement.innerHTML);
    targetElement.innerHTML = '';
  }
  const owner = createRoot();
  setRoot(owner);
  let renderResult = renderComponent(
    {
      // @ts-expect-error typings mismatch
      [$args]: {
        [$context]: owner,
      },
      template: component,
    },
    targetElement,
    owner,
    false,
  );
  registerDestructor(owner, () => {
    destroyElementSync(renderResult.nodes);
  });
  await rerender();
  // TODO: figure out what is root, at the moment it return node instance, not node.ctx
  if (!getRoot()) {
    throw new Error('Root does not exist');
  }
  return renderResult;
}

export async function rerender(timeout = 16) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}

export function find(selector: string): Element {
  const element = getDocument()
    .getElementById('ember-testing')!
    .querySelector(selector);
  return element as Element;
}

export async function click(selector: string) {
  const element = find(selector);
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
  await rerender();
}

export function step(message: string) {
  QUnit.assert.pushResult({
    message: `[Step] ${message}`,
    result: true,
    expected: true,
    actual: true,
  });
}
