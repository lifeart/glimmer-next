export * from '@glint/template/-private/dsl';
export { Globals } from './globals';

import './integration-declarations';

import {
  ElementForTagName,
  ResolveOrReturn,
} from '@glint/template/-private/dsl';
import {
  ComponentReturn,
  AnyContext,
  AnyFunction,
  DirectInvokable,
  HasContext,
  InvokableInstance,
  Invoke,
  InvokeDirect,
  TemplateContext,
  ModifierReturn,
} from '@glint/template/-private/integration';

// Items that can be directly invoked by value
export declare function resolve<T extends DirectInvokable>(
  item: T,
): T[typeof InvokeDirect];
// Items whose instance type can be invoked
export declare function resolve<
  Args extends unknown[],
  Instance extends InvokableInstance,
>(
  item: (abstract new (...args: Args) => Instance) | null | undefined,
): (
  ...args: Parameters<Instance[typeof Invoke]>
) => ReturnType<Instance[typeof Invoke]>;
// Plain functions
export declare function resolve<
  T extends ((...params: any) => any) | null | undefined,
>(item: T): NonNullable<T>;

export declare const resolveOrReturn: ResolveOrReturn<typeof resolve>;

// We customize the top-level `templateExpression` wrapper function for this environment to
// return a type that's assignable to `TemplateOnlyComponent` from '@ember/component/template-only'.
// Longer term we should rationalize this to a type that doesn't carry extra baggage
// and likely comes from a more sensible path.

import { TemplateOnlyComponent } from '@ember/component/template-only';
import { AttrValue } from '@glint/template';

export declare function templateExpression<
  Signature extends AnyFunction = () => ComponentReturn<{}>,
  Context extends AnyContext = TemplateContext<void, {}, {}, void>,
>(
  f: (𝚪: Context, χ: never) => void,
): TemplateOnlyComponent<never> &
  (abstract new () => InvokableInstance<Signature> & HasContext<Context>);

// We customize `applyModifier` to accept `void | () => void` as a valid modifier return type
export declare function applyModifier(
  modifierResult: Promise<void> | ModifierReturn | void | (() => void),
): void;

/**
 * Given a tag name, returns an appropriate `Element` subtype.
 * NOTE: This will return a union for elements that exist both in HTML and SVG. Technically, this will be too permissive.
 */
type WithShadowRoot = { shadowrootmode?: 'open' | 'closed' };

export declare function emitElement<Name extends string>(
  name: Name,
): { element: ElementForTagName<Name> & WithShadowRoot };

export declare function applyAttributes(
  element: Element,
  attrs: Record<string, AttrValue> & WithShadowRoot,
): void;
