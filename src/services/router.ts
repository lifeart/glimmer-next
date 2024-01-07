import { Router } from '@lifeart/tiny-router';
import { cellFor } from '@lifeart/gxt';

class GlimmerRouter extends Router {
  constructor(...args) {
    super(...args);
    cellFor(this, 'stack');
    cellFor(this, 'prevRoute');
    cellFor(this, 'activeRoute');
  }
}

export const router = new GlimmerRouter({
  main: '',
  pageOne: '/pageOne',
  pageTwo: '/pageTwo',
});
