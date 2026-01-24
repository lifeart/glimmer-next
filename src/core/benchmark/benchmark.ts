import { Application } from '@/components/Application.gts';
import { withRehydration } from '@/core/ssr/rehydration';
import { measureRender } from '@/core/benchmark/measure-render';
import { setResolveRender } from '@/core/runtime';
import { Root } from '@/core/dom';
import { cleanupFastContext } from '../context';
import { renderComponent } from '../dom';

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
            renderComponent(Application, {
              element: fragment,
              owner: new Root(doc),
            });
            root.innerHTML = '';
            root.appendChild(fragment);
          }
        } else {
          renderComponent(Application, {
            element: root,
          });
        }
      });

      // Measure load time if navigationStart is available
      try {
        performance.measure('load', 'navigationStart', 'renderStart');
      } catch {
        // navigationStart might not exist in some contexts
      }

      return async (name: string, update: () => void) => {
        const startMark = name + 'Start';
        const endMark = name + 'End';

        // Create start mark synchronously - no delays before this
        performance.mark(startMark);

        await new Promise<void>((resolve) => {
          let resolved = false;
          const safeResolve = () => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          };
          setResolveRender(safeResolve);
          update();
          // Fallback timeout in case no revalidation is triggered
          // (e.g., clearing an already empty list, or click doesn't trigger update)
          setTimeout(safeResolve, 100);
        });

        // Create end mark synchronously after the work completes
        performance.mark(endMark);

        // Create measure to link the marks
        performance.measure(name, startMark, endMark);
      };
    },
  };
}
