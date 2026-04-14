import { type Component } from '@/core/component-class';
import { renderComponent } from '@/core/dom';
import { runDestructors } from '@/core/destroy';
import { createRoot, resetNodeCounter, Root } from '@/core/dom';
import { takeRenderingControl } from '@/core/runtime';
import {
  defaultHappyDomProvider,
  type SsrDomProvider,
} from '@/core/ssr/dom-provider';

type EnvironmentParams = {
  url: string;
  /**
   * Optional DOM provider. When omitted, happy-dom is used (default
   * behavior, unchanged). Hosts like FastBoot can inject SimpleDOM
   * by supplying their own provider.
   */
  domProvider?: SsrDomProvider;
};

export type { SsrDomProvider } from '@/core/ssr/dom-provider';
export { defaultHappyDomProvider } from '@/core/ssr/dom-provider';

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
  const provider =
    params.domProvider ?? (await defaultHappyDomProvider());
  const instance = provider.createDocument({ url: params.url });
  const doc = instance.document;
  const Serializer = instance.XMLSerializer;
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

  const s = new Serializer();

  const html = Array.from(rootNode.childNodes as ArrayLike<any>)
    .map((n: any) => s.serializeToString(n))
    .join('');

  // Suppress reactive updates during destruction to prevent
  // scheduleRevalidate() from queuing syncDomAsync() microtasks
  // that can starve the event loop via infinite Set iteration
  // when cell updates are triggered during destructor execution.
  const releaseControl = takeRenderingControl();
  try {
    await Promise.all(runDestructors(root));
  } finally {
    releaseControl();
  }
  // Release provider resources (for happy-dom: cancelAsync + close).
  instance.dispose();
  return html;
}
