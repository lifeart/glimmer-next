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
}) as RouterType;
