// Minimal gxt app for the bundle-size budget: one component, one cell, one
// event. Its gzip/brotli size tracks what a trivial app pays for the runtime.
import { renderComponent } from '@lifeart/gxt';
import { Hello } from './Hello.gts';

renderComponent(Hello as never, { element: document.getElementById('main')! });
