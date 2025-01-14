import { $_GET_ARGS, hbs, Root } from '@lifeart/gxt';
import { getContext, provideContext, RENDERING_CONTEXT, ROOT_CONTEXT } from './context';
import { SVGBrowserDOMApi } from './svg-api';
import { HTMLBrowserDOMApi } from './dom-api';
import { MathMLBrowserDOMApi } from './math-api';

export function SVGProvider() {
  // @ts-expect-error typings error
  $_GET_ARGS(this, arguments);
  // @ts-expect-error typings error
  const root = getContext<Root>(this, ROOT_CONTEXT)!;
  // @ts-expect-error typings error
  provideContext(this, RENDERING_CONTEXT, new SVGBrowserDOMApi(root.document));
  return hbs`{{yield}}`;
}

export function HTMLProvider() {
  // @ts-expect-error typings error
  $_GET_ARGS(this, arguments);
  // @ts-expect-error typings error
  const root = getContext<Root>(this, ROOT_CONTEXT)!;
  // @ts-expect-error typings error
  provideContext(this, RENDERING_CONTEXT, new HTMLBrowserDOMApi(root.document));
  return hbs`{{yield}}`;
}

export function MathMLProvider() {
  // @ts-expect-error typings error
  $_GET_ARGS(this, arguments);
  // @ts-expect-error typings error
  const root = getContext<Root>(this, ROOT_CONTEXT)!;
  // @ts-expect-error typings error
  provideContext(this, RENDERING_CONTEXT, new MathMLBrowserDOMApi(root.document));
  return hbs`{{yield}}`;
}
