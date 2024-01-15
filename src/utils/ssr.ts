import { renderComponent, runDestructors, type ComponentReturnType } from '@/utils/component';
import { setDocument, getDocument } from './dom-api';
import { getRoot, resetNodeCounter, resetRoot } from '@/utils/dom';

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

  const oldRoot = getRoot();
  if (oldRoot) {
    await runDestructors(oldRoot);
    resetRoot();
  }
  win.close();
  return html;
}
