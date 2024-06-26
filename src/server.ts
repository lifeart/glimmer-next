import 'glint-environment-gxt';
import 'decorator-transforms/globals';

import { URL } from 'node:url';
import { router } from '@/services/router';
import { Application } from '@/components/Application.gts';
import { render as renderSSR } from '@/utils/ssr/ssr';

const queue: Promise<any>[] = [];

export async function render(url: string) {
  await Promise.all(queue);
  let resolve = () => void 0;
  const p = new Promise((_resolve)=> {
    resolve = _resolve as any;
  });
  queue.push(p);
  const urlInstance = new URL(url);
  await router.mount(urlInstance.pathname, true);
  // @ts-expect-error
  const result = await renderSSR((el: HTMLElement) => new Application(el), {
    url,
  });
  await router.unmount();
  resolve();
  queue.splice(queue.indexOf(p), 1);
  return result;
}
