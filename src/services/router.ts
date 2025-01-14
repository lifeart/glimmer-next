import * as pkg from '@lifeart/tiny-router';
import type { Router as RouterType } from '@lifeart/tiny-router';
import { tracked } from '@lifeart/gxt';
import { repo } from './../components/pages/todomvc/repo';

// @ts-expect-error
const { Router } = 'default' in pkg ? pkg.default : pkg;

class GlimmerRouter extends Router {
  // @ts-expect-error
  @tracked stack;
  // @ts-expect-error
  @tracked prevRoute;
  // @ts-expect-error
  @tracked activeRoute;
}

export function createRouter() {
  // @ts-expect-error
  const router = new GlimmerRouter({
    main: '',
    tests: '/tests',
    benchmark: '/benchmark',
    pageOne: '/pageOne',
    pageTwo: '/pageTwo',
    isPolarisReady: '/is-polaris-ready',
    todomvc: '/todomvc',
    'todomvc.all': '/todomvc/all',
    'todomvc.active': '/todomvc/active',
    'todomvc.completed': '/todomvc/completed',
  }) as RouterType;

  router.addResolver('isPolarisReady', async () => {
    // preload css   <link rel="preload" href="style.css" as="style" />
    if (!import.meta.env.SSR) {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.href = '/is-polaris-ready.css';
      link.as = 'style';
      document.head.appendChild(link);
    }
    const { IsPolarisReady } = await import(
      // @ts-ignore import
      '@/components/pages/IsPolarisReady.gts'
    );
    return {
      component: IsPolarisReady,
    };
  });

  router.addResolver('todomvc', async () => {
    // preload css   <link rel="preload" href="style.css" as="style" />
    console.log('todomvc');
    if (!import.meta.env.SSR) {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.href = '/todomvc.css';
      link.as = 'style';
      document.head.appendChild(link);
    }
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
