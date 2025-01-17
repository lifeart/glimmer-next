import {
  type Component,
  renderComponent,
  runDestructors,
} from '@/utils/component';
import { createRoot, resetNodeCounter, Root } from '@/utils/dom';

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
    args,
    rootNode,
    root,
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
  renderComponent(component, args, rootNode as unknown as HTMLElement, root);
  resetNodeCounter();

  const s = new XMLSerializer();

  const html = Array.from(rootNode.childNodes)
    .map((n) => s.serializeToString(n))
    .join('');

  await runDestructors(root);
  win.close();
  return html;
}
