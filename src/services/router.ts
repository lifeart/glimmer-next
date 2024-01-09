import { Router } from '@lifeart/tiny-router';
import { cellFor } from '@lifeart/gxt';

class GlimmerRouter extends Router {
  constructor(routes: Record<string, string>) {
    super(routes);
    cellFor(this, 'stack');
    cellFor(this, 'prevRoute');
    cellFor(this, 'activeRoute');
  }
}

export const router = new GlimmerRouter({
  main: '',
  tests: '/tests',
  benchmark: '/benchmark',
  pageOne: '/pageOne',
  pageTwo: '/pageTwo',
});
