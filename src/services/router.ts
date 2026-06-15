import * as tinyRouter from '@lifeart/tiny-router';
import type { Router as RouterType } from '@lifeart/tiny-router';
import { tracked } from '@lifeart/gxt';
import { repo } from '@/components/pages/todomvc/repo';

// Handle both ESM and CJS module formats
// Use dynamic property access to avoid Rollup's static analysis warning
const defaultKey = 'defa' + 'ult';
const hasDefault = defaultKey in tinyRouter;
const Router = hasDefault
  ? (tinyRouter as Record<string, any>)[defaultKey].Router
  : tinyRouter.Router;

/**
 * Preload a stylesheet via `<link rel="preload">` — a browser-only progressive
 * enhancement. Guard on RUNTIME DOM availability (`typeof document`), not the
 * build-time `import.meta.env.SSR` flag: the flag is only set in vite's SSR
 * build, so `!import.meta.env.SSR` was `true` (→ ran `document.createElement`)
 * in EVERY other non-browser context — plain Node, a worker, a non-vite SSR
 * host, a test without a DOM — throwing `ReferenceError: document is not
 * defined`. A capability check is correct everywhere: it runs exactly when a
 * document exists and is a safe no-op otherwise. (Fixes #141.)
 */
export function preloadCss(href: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  const link = document.createElement('link');
  link.rel = 'preload';
  link.href = href;
  link.as = 'style';
  document.head.appendChild(link);
}

class GlimmerRouter extends Router {
  // @ts-expect-error
  @tracked stack;
  // @ts-expect-error
  @tracked prevRoute;
  // @ts-expect-error
  @tracked activeRoute;
}

export function createRouter() {
  // @ts-expect-error - Router constructor typing issue with ESM/CJS compat
  const router = new GlimmerRouter({
    main: '',
    tests: '/tests',
    benchmark: '/benchmark',
    pageOne: '/pageOne',
    pageTwo: '/pageTwo',
    renderers: '/renderers',
    isPolarisReady: '/is-polaris-ready',
    todomvc: '/todomvc',
    'todomvc.all': '/todomvc/all',
    'todomvc.active': '/todomvc/active',
    'todomvc.completed': '/todomvc/completed',
  }) as RouterType;

  router.addResolver('isPolarisReady', async () => {
    preloadCss('/is-polaris-ready.css');
    const { IsPolarisReady } = await import(
      // @ts-ignore import
      '@/components/pages/IsPolarisReady.gts'
    );
    return {
      component: IsPolarisReady,
    };
  });

  router.addResolver('todomvc', async () => {
    preloadCss('/todomvc.css');
    const { ToDoMVC } = await import(
      // @ts-ignore import
      '@/components/pages/ToDoMVC.gts'
    );
    const model = {
      component: ToDoMVC,
    };
    router._resolvedData['todomvc'] = {
      model,
      params: {},
    };
    return model;
  });

  router.addResolver('todomvc.all', async () => {
    console.log('todomvc.all');

    const page = await import(
      // @ts-ignore import
      '@/components/pages/todomvc/page.gts'
    );
    return {
      component: page.default,
      get model() {
        return repo.all;
      },
    };
  });
  router.addResolver('todomvc.active', async () => {
    const page = await import(
      // @ts-ignore import
      '@/components/pages/todomvc/page.gts'
    );
    return {
      component: page.default,
      get model() {
        return repo.active;
      },
    };
  });

  router.addResolver('todomvc.completed', async () => {
    const page = await import(
      // @ts-ignore import
      '@/components/pages/todomvc/page.gts'
    );
    return {
      component: page.default,
      get model() {
        return repo.completed;
      },
    };
  });

  return router;
}

export const router = createRouter();
