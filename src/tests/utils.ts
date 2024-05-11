import { type ComponentReturnType, destroyElementSync, renderComponent } from '@/utils/component';
import { getDocument } from '@/utils/dom-api';
import { withRehydration } from '@/utils/ssr/rehydration';
import { getRoot, resetNodeCounter, setRoot, resetRoot } from '@/utils/dom';
import { renderInBrowser } from '@/utils/ssr/ssr';
import { runDestructors } from '@/utils/component';
import { registerDestructor } from '@/utils/glimmer/destroyable';

export async function cleanupRender() {
  const root = getRoot();
  if (root) {
    await Promise.all(runDestructors(root));
  }
  resetNodeCounter();
  resetRoot();
}

export function rehydrate(component: ComponentReturnType) {
  let cmp: any = null;
  withRehydration(() => {
    // @ts-expect-error typings mismatch
    cmp = new component();
    return cmp;
  }, renderTarget());
  if (!getRoot()) {
    setRoot(cmp.ctx || cmp);
  }
}
export async function ssr(component: any) {
  if (getRoot()) {
    throw new Error('Root already exists');
  }
  resetNodeCounter();
  let cmp: any = null;
  const content = await renderInBrowser(() => {
    cmp = new component({});
    return cmp;
  });
  renderTarget().innerHTML = content;
  if (cmp.ctx) {
    await Promise.all(runDestructors(cmp.ctx));
  } else {
    await Promise.all(runDestructors(cmp));
  }
  const root = getRoot();
  if (root && cmp !== root) {
    await Promise.all(runDestructors(root));
  }
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
    targetElement.innerHTML = '';
  }
  // @ts-expect-error typings mismatch
  const cmp = new component();

  let renderResult = renderComponent(cmp, targetElement, cmp.ctx);
  registerDestructor(cmp.ctx || cmp, () => {
    destroyElementSync(cmp.nodes);
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

export async function click(selector: string) {
  const element = getDocument()
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
