import { Application } from '@/components/Application.gts';
import { withRehydration } from '@/utils/ssr/rehydration';
import { getDocument } from '@/utils/dom-api';
import { measureRender } from '@/utils/benchmark/measure-render';
import { setResolveRender } from '@/utils/runtime';
import { runDestructors } from '@/utils/component';
import { getRoot, resetRoot } from '@/utils/dom';

export function createBenchmark() {
  return {
    async render() {
      await measureRender('render', 'renderStart', 'renderEnd', () => {
        const root = getDocument().getElementById('app')!;
        let appRef: Application | null = null; 
        if (root.childNodes.length > 1) {
          try {
            // @ts-expect-error
            withRehydration(function () {
              appRef = new Application(root);
              return appRef;
            }, root);
            console.info('Rehydration successful');
          } catch (e) {
            (async() => {
              console.error('Rehydration failed, fallback to normal render', e);
              await runDestructors(getRoot()!);
              resetRoot();
              root.innerHTML = '';
              appRef = new Application(root);
            })();
           
          }
        } else {
          appRef = new Application(root);
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
