import {
  renderComponent,
  runDestructors,
  type ComponentReturnType,
} from '@/utils/component';
import { setDocument, getDocument } from '../dom-api';
import { getRoot, resetNodeCounter, resetRoot } from '@/utils/dom';
import { $args, $context, $template } from '../shared';

type EnvironmentParams = {
  url: string;
};

export async function renderInBrowser(
  componentRenderFn: (rootNode: HTMLElement) => ComponentReturnType,
) {
  if (import.meta.env.DEV) {
    if (!getRoot()) {
      throw new Error('Unable to detect render root');
    }
  }
  const doc = getDocument();
  const rootNode = doc.createElement('div');
  // @todo - add destructor
  renderComponent(
    {
      // @ts-expect-error typings error
      [$args]: {
            [$context]: getRoot(),
      },
      [$template]: function () {
        // @ts-expect-error typings error
        return new componentRenderFn(...arguments);
      },
    },
    rootNode,
    getRoot(),
  );
  const html = rootNode.innerHTML;
  rootNode.remove();
  return html;
}

export async function render(
  componentRenderFn: (rootNode: HTMLElement) => ComponentReturnType,
  params: EnvironmentParams,
) {
  const { Window, XMLSerializer } = await import('happy-dom');
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

  const s = new XMLSerializer();

  const html = Array.from(rootNode.childNodes)
    .map((n) => s.serializeToString(n))
    .join('');

  const oldRoot = getRoot();
  if (oldRoot) {
    await runDestructors(oldRoot);
    resetRoot();
  }
  win.close();
  return html;
}
