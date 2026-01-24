import { type Component } from '@/core/component-class';
import { renderComponent } from '@/core/dom';
import { runDestructors } from '@/core/destroy';
import { createRoot, resetNodeCounter, Root } from '@/core/dom';

type EnvironmentParams = {
  url: string;
};

export async function renderInBrowser(
  componentRenderFn: typeof Component,
  args: Record<string, unknown>,
  root: Root,
) {
  const doc = root.document;
  const rootNode = doc.createElement('div');

  // @todo - add destructor
  renderComponent(
    componentRenderFn,
    {
      args,
      element: rootNode,
      owner: root,
    },
  );
  const html = rootNode.innerHTML;
  rootNode.remove();
  return html;
}

export async function render(
  component: typeof Component<any>,
  args: Record<string, unknown>,
  params: EnvironmentParams,
  root: Root = createRoot(),
) {
  const { Window, XMLSerializer } = await import('happy-dom');
  const win = new Window({ url: params.url });
  const doc = win.document;
  root.document = doc as unknown as Document;

  const rootNode = doc.createElement('div');
  doc.body.appendChild(rootNode);

  resetNodeCounter();
  renderComponent(component, {
    args, 
    element: rootNode as unknown as HTMLElement, 
    owner: root,
  });
  resetNodeCounter();

  const s = new XMLSerializer();

  const html = Array.from(rootNode.childNodes)
    .map((n) => s.serializeToString(n))
    .join('');

  await Promise.all(runDestructors(root));
  // Cancel any pending async operations before closing
  win.happyDOM.cancelAsync();
  win.close();
  return html;
}
