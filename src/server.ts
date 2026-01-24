import 'glint-environment-gxt';
import 'decorator-transforms/globals';

import { URL } from 'node:url';
import { createRouter } from '@/services/router';
import { Application } from '@/components/Application.gts';
import { render as renderSSR } from '@/core/ssr/ssr';

export async function render(url: string) {
  const urlInstance = new URL(url);
  const router = createRouter();
  await router.mount(urlInstance.pathname, true);
  const result = await renderSSR(Application, {router}, {url});
  try {
    return result;
  } finally {
    router.unmount();
  }
}
