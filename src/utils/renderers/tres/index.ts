import { $_GET_ARGS, hbs, type Root } from '@lifeart/gxt';
import { getContext, provideContext, RENDERING_CONTEXT, ROOT_CONTEXT } from '@/utils/context';
import { TresBrowserDOMApi } from './tres-api';

export function TresProvider() {
  // @ts-expect-error typings error
  $_GET_ARGS(this, arguments);
  // @ts-expect-error typings error
  const root = getContext<Root>(this, ROOT_CONTEXT)!;
  // @ts-expect-error typings error
  provideContext(this, RENDERING_CONTEXT, new TresBrowserDOMApi());
  return hbs`{{yield}}`;
}
