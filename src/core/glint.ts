/**
 * Opt-in Glint integration (types only).
 *
 * Load it once in a Glint project, e.g. from any `.d.ts` file:
 * `/// <reference types="@lifeart/gxt/glint" />`. It needs `@glint/template`
 * (an optional peer dependency); the rest of the published types do not.
 *
 * It gives `Component` Glint's `[Context]` / `[Invoke]` keys, so Glint can
 * type a class's template and resolve the class when a template invokes it,
 * and it maps `ComponentInvokeReturn` (the `TOC` return type) onto Glint's
 * `ComponentReturn`. Both keys are Glint's own unique symbols, which is why
 * they cannot be re-declared here: a local copy would be a different key.
 */
import type {
  TemplateContext,
  Context,
  Invoke,
  ComponentReturn,
} from '@glint/template/-private/integration';

type Get<T, K, Otherwise = {}> = K extends keyof T
  ? Exclude<T[K], undefined>
  : Otherwise;

// `Props` resolves to the augmented module's own export.
declare module './component-class' {
  interface Component<T extends Props = any> {
    [Context]: TemplateContext<
      this,
      Get<T, 'Args'>,
      Get<T, 'Blocks'>,
      Get<T, 'Element', null>
    >;
    [Invoke]: (
      args?: Get<T, 'Args'>,
    ) => ComponentReturn<Get<T, 'Blocks'>, Get<T, 'Element', null>>;
  }
}

declare module './types' {
  interface TemplateTypeRegistry<Blocks, El> {
    componentReturn: ComponentReturn<Blocks, El>;
  }
}

export {};
