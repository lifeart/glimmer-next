import { Application } from '@/components/Application.gts';
import { withRehydration } from '@/utils/rehydration';
import { getDocument } from '@/utils/dom-api';
import { measureRender } from '@/utils/measure-render';
import { setResolveRender } from '@/utils/runtime';

export function createBenchmark() {
  return {
    async render() {
      await measureRender('render', 'renderStart', 'renderEnd', () => {
        const root = getDocument().getElementById('app')!;
        if (root.childNodes.length > 1) {
          try {
            // @ts-expect-error
            withRehydration(function () {
              return new Application(root);
            }, root);
            console.info('Rehydration successful');
          } catch (e) {
            console.error('Rehydration failed, fallback to normal render', e);
            root.innerHTML = '';
            new Application(root);
          }
        } else {
          new Application(root);
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
