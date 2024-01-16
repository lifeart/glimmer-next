import '@glint/environment-glimmerx';
import '@glint/environment-ember-template-imports';
import 'decorator-transforms/globals';

import { URL } from 'node:url';
import { router } from '@/services/router';
import { Application } from '@/components/Application.gts';
import { render as renderSSR } from '@/utils/ssr';

export async function render(url: string) {
  const urlInstance = new URL(url);
  await router.mount(urlInstance.pathname, true);
  // @ts-expect-error
  const result = await renderSSR((el: HTMLElement) => new Application(el), {
    url,
  });
  await router.unmount();
  return result;
}