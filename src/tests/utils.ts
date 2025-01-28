import {
  type ComponentReturnType,
  renderComponent,
  Component,
} from '@/utils/component';
import { withRehydration } from '@/utils/ssr/rehydration';
import { resetNodeCounter, createRoot, $_c } from '@/utils/dom';
import { renderInBrowser } from '@/utils/ssr/ssr';
import { runDestructors } from '@/utils/component';
import { $_fin, Root } from '../utils';
import { addToTree, PARENT, RENDERED_NODES_PROPERTY, TREE } from '@/utils/shared';
import { cleanupFastContext } from '@/utils/context';

let ROOT: null | Root = null;

let $doc =
  typeof document !== 'undefined'
    ? document
    : (undefined as unknown as Document);
export function setDocument(newDocument: Document) {
  $doc = newDocument;
}
export function getDocument() {
  return $doc;
}

export function resetRoot() {
  ROOT = null;
}
export function setRoot(root: Root) {
  if (IS_DEV_MODE) {
    if (ROOT) {
      throw new Error('Root already exists');
    }
  }
  ROOT = root;
}
export function getRoot() {
  return ROOT;
}

export async function cleanupRender() {
  const rootIds: number[] = [];
  PARENT.forEach((ref, id) => {
    if (ref === null) {
      rootIds.push(id);
    }
  });
  const roots = rootIds.map((id) => TREE.get(id)!);
  for (const root of roots) {
    await Promise.all(runDestructors(root));
  }
  resetNodeCounter();
  resetRoot();
}

export function rehydrate(component: typeof Component, args: Record<string, unknown> = {}) {
  withRehydration(component, args, renderTarget());
}
export async function ssr(component: typeof Component) {
  resetNodeCounter();
  let root = createRoot();
  setRoot(root);
  const content = await renderInBrowser(component, {}, root);
  renderTarget().innerHTML = content;
  await Promise.all(runDestructors(root));
  resetNodeCounter();
  resetRoot();
}

export function renderTarget() {
  return getDocument().getElementById('ember-testing')!;
}

export function createTestComponent(component: ComponentReturnType, owner: Root): typeof Component {
  const debugName = `${QUnit.config.current.moduleName}::${QUnit.config.current.testName}`;

  class TestComponentContainer extends Component {
    [RENDERED_NODES_PROPERTY] = [];
    constructor() {
      // @ts-expect-error
      super(...arguments);
      // @ts-expect-error
      this.debugName = debugName;
    }
    // @ts-expect-error
    template(args: Record<string, unknown>) {
      // @ts-expect-error
      addToTree(owner, this);
      return $_fin([$_c(component, {
        ...args,
        // @ts-expect-error
      }, this)], this);
    }
  }

  TestComponentContainer.prototype.toString = () => debugName;
  return TestComponentContainer as unknown as typeof Component;
}

export async function render(component: ComponentReturnType) {
  cleanupFastContext();
  const targetElement = getDocument().getElementById('ember-testing')!;
  await cleanupRender();
  if (targetElement.childNodes.length) {
    console.warn('testing container not empty, force cleanup');
    console.info(targetElement.innerHTML);
    targetElement.innerHTML = '';
  }
  const owner = createRoot();
  setRoot(owner);

  let renderResult = renderComponent(
    createTestComponent(component, owner),
    {
      element: targetElement,
      owner,
    }
  );
  await rerender();
  return renderResult;
}

export async function rerender(timeout = 16) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}

export function find<T extends Element>(selector: string): T {
  const element = getDocument()
    .getElementById('ember-testing')!
    .querySelector(selector);
  return element as T;
}

export function findAll<T extends Element>(selector: string): NodeListOf<T> {
  const element = getDocument()
    .getElementById('ember-testing')!
    .querySelectorAll(selector);
  return element as NodeListOf<T>;
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
