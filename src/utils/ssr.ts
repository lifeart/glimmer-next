import { renderComponent, type ComponentReturnType } from '@/utils/component';
import { setDocument, getDocument } from './dom-api';
import { resetNodeCounter } from '@/utils/dom';

type EnvironmentParams = {
  url: string;
};

export async function renderInBrowser(
  componentRenderFn: (rootNode: HTMLElement) => ComponentReturnType,
) {
  const doc = getDocument();
  const rootNode = doc.createElement('div');
  // @todo - add destructor
  renderComponent(componentRenderFn(rootNode), rootNode);
  const html = rootNode.innerHTML;
  rootNode.remove();
  return html;
}

export async function render(
  componentRenderFn: (rootNode: HTMLElement) => ComponentReturnType,
  params: EnvironmentParams,
) {
  const { Window } = await import('happy-dom');
  const win = new Window({ url: params.url });
  const originalDocument = getDocument();
  const doc = win.document;
  setDocument(doc as unknown as Document);

  const rootNode = doc.createElement('div');
  doc.body.appendChild(rootNode);

  resetNodeCounter();
  // @ts-expect-error
  const el = componentRenderFn(rootNode);
  await new Promise((resolve) => {
    setTimeout(resolve);
  });

  const html = rootNode.innerHTML;

  // @ts-expect-error
  await el.destroy();
  resetNodeCounter();

  setDocument(originalDocument as unknown as Document);
  return html;
}
