// This module is responsible for augmenting the upstream definitions of entities that interact
// with templates to include the information necessary for Glint to typecheck them.
import { ComponentLike, HelperLike, ModifierLike } from '@glint/template';
import {
  Context,
  FlattenBlockParams,
  HasContext,
  TemplateContext,
} from '@glint/template/-private/integration';
import {
  ComponentSignatureArgs,
  ComponentSignatureBlocks,
  ComponentSignatureElement,
} from '@glint/template/-private/signature';

//////////////////////////////////////////////////////////////////////
// Components

import '@ember/component/template-only';
// import '@lifeart/gxt';

type ComponentContext<This, S> = TemplateContext<
  This,
  ComponentSignatureArgs<S>['Named'],
  FlattenBlockParams<ComponentSignatureBlocks<S>>,
  ComponentSignatureElement<S>
>;

// declare module '@lifeart/gxt' {
//   export interface Component<S> extends InstanceType<ComponentLike<S>> {
//     [Context]: ComponentContext<this, S>;
//   }
// }


interface TemplateOnlyComponentInstance<S> extends InstanceType<ComponentLike<S>> {
  [Context]: ComponentContext<null, S>;
}

// As with other abstract constructor types, this allows us to provide a class
// and therefore have InstanceType work as needed, while forbidding construction
// by end users.
type TemplateOnlyConstructor<S> = abstract new () => TemplateOnlyComponentInstance<S>;

declare module '@ember/component/template-only' {
  export interface TemplateOnlyComponent<S> extends TemplateOnlyConstructor<S> {}
}
