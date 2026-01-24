import { $_GET_ARGS, Root } from '@/core/dom';
import { hbs } from '@/core/template';
import { getContext, provideContext, RENDERING_CONTEXT, ROOT_CONTEXT, API_FACTORY_CONTEXT } from './context';
import { SVGBrowserDOMApi } from './svg-api';
import { HTMLBrowserDOMApi } from './dom-api';
import { MathMLBrowserDOMApi } from './math-api';
import { NS_SVG, NS_MATHML } from './namespaces';
import type { ApiFactoryWrapper } from './ssr/rehydration';

export function SVGProvider() {
  // @ts-expect-error typings error
  $_GET_ARGS(this, arguments);
  // @ts-expect-error typings error
  const root = getContext<Root>(this, ROOT_CONTEXT)!;
  // @ts-expect-error typings error
  // API_FACTORY_CONTEXT is optional - only provided during SSR rehydration
  const factoryWrapper = getContext<ApiFactoryWrapper>(this, API_FACTORY_CONTEXT, false);
  const api = factoryWrapper?.factory(NS_SVG) ?? new SVGBrowserDOMApi(root.document);
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
  // API_FACTORY_CONTEXT is optional - only provided during SSR rehydration
  const factoryWrapper = getContext<ApiFactoryWrapper>(this, API_FACTORY_CONTEXT, false);
  const api = factoryWrapper?.factory() ?? new HTMLBrowserDOMApi(root.document);
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
  // API_FACTORY_CONTEXT is optional - only provided during SSR rehydration
  const factoryWrapper = getContext<ApiFactoryWrapper>(this, API_FACTORY_CONTEXT, false);
  const api = factoryWrapper?.factory(NS_MATHML) ?? new MathMLBrowserDOMApi(root.document);
  // @ts-expect-error typings error
  provideContext(this, RENDERING_CONTEXT, api);
  return hbs`{{yield}}`;
}
