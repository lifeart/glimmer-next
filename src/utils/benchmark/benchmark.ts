import { Application } from '@/components/Application.gts';
import { withRehydration } from '@/utils/ssr/rehydration';
import { measureRender } from '@/utils/benchmark/measure-render';
import { setResolveRender } from '@/utils/runtime';
import { Root } from '@/utils/dom';
import { cleanupFastContext } from '../context';
import { renderComponent } from '../component';

export function createBenchmark(doc: Document) {
  return {
    async render() {
      await measureRender('render', 'renderStart', 'renderEnd', () => {
        const root = doc.getElementById('app')!;
        if (root.childNodes.length > 1) {
          try {
            withRehydration(Application, {}, root);
            console.info('Rehydration successful');
          } catch (e) {
            console.error('Rehydration failed, fallback to normal render', e);
            const fragment = doc.createDocumentFragment();
            cleanupFastContext();
            renderComponent(Application, {}, fragment, new Root(doc));
            root.innerHTML = '';
            root.appendChild(fragment);
          }
        } else {
          renderComponent(Application, {}, root);
        }
      });

      performance.measure('load', 'navigationStart', 'renderStart');

      return async (name: string, update: () => void) => {
        await measureRender(
          name,
          name + 'Start',
          name + 'End',
          () =>
            new Promise((resolve) => {
              setResolveRender(resolve);
              update();
            }),
        );
      };
    },
  };
}
