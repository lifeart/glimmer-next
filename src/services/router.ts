import * as pkg from '@lifeart/tiny-router';
import type { Router as RouterType } from '@lifeart/tiny-router';
import { cellFor } from '@lifeart/gxt';

// @ts-expect-error
const { Router } = 'default' in pkg ? pkg.default : pkg;

class GlimmerRouter extends Router {
  constructor(routes: Record<string, string>) {
    super(routes);
    cellFor(this as unknown as RouterType, 'stack');
    cellFor(this as unknown as RouterType, 'prevRoute');
    cellFor(this as unknown as RouterType, 'activeRoute');
  }
}

export const router = new GlimmerRouter({
  main: '',
  tests: '/tests',
  benchmark: '/benchmark',
  pageOne: '/pageOne',
  pageTwo: '/pageTwo',
  isPolarisReady: '/is-polaris-ready',
}) as RouterType;

router.addResolver('isPolarisReady', async () => {
  // preload css   <link rel="preload" href="style.css" as="style" />

  const link = document.createElement('link');
  link.rel = 'preload';
  link.href = '/is-polaris-ready.css';
  link.as = 'style';
  document.head.appendChild(link);
  const { IsPolarisReady } = await import(
    // @ts-ignore import
    '@/components/pages/IsPolarisReady.gts'
  );
  return {
    component: IsPolarisReady,
  };
});
