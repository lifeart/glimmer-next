import { $_GET_ARGS, hbs, Root } from '@lifeart/gxt';
import { getContext, provideContext, RENDERING_CONTEXT, ROOT_CONTEXT, API_FACTORY_CONTEXT } from './context';
import { SVGBrowserDOMApi } from './svg-api';
import { HTMLBrowserDOMApi } from './dom-api';
import { MathMLBrowserDOMApi } from './math-api';
import { NS_SVG, NS_MATHML } from './namespaces';
import type { ApiFactory } from './ssr/rehydration';

export function SVGProvider() {
  // @ts-expect-error typings error
  $_GET_ARGS(this, arguments);
  // @ts-expect-error typings error
  const root = getContext<Root>(this, ROOT_CONTEXT)!;
  // @ts-expect-error typings error
  const factory = getContext<ApiFactory>(this, API_FACTORY_CONTEXT);
  const api = factory?.(NS_SVG) ?? new SVGBrowserDOMApi(root.document);
  // @ts-expect-error typings error
  provideContext(this, RENDERING_CONTEXT, api);
  return hbs`{{yield}}`;
}

export function HTMLProvider() {
  // @ts-expect-error typings error
  $_GET_ARGS(this, arguments);
  // @ts-expect-error typings error
  const root = getContext<Root>(this, ROOT_CONTEXT)!;
  // @ts-expect-error typings error
  const factory = getContext<ApiFactory>(this, API_FACTORY_CONTEXT);
  const api = factory?.() ?? new HTMLBrowserDOMApi(root.document);
  // @ts-expect-error typings error
  provideContext(this, RENDERING_CONTEXT, api);
  return hbs`{{yield}}`;
}

export function MathMLProvider() {
  // @ts-expect-error typings error
  $_GET_ARGS(this, arguments);
  // @ts-expect-error typings error
  const root = getContext<Root>(this, ROOT_CONTEXT)!;
  // @ts-expect-error typings error
  const factory = getContext<ApiFactory>(this, API_FACTORY_CONTEXT);
  const api = factory?.(NS_MATHML) ?? new MathMLBrowserDOMApi(root.document);
  // @ts-expect-error typings error
  provideContext(this, RENDERING_CONTEXT, api);
  return hbs`{{yield}}`;
}
