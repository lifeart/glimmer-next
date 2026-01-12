import type { ComponentReturnType } from "./component";

/**
 * Tagged template literal for Glimmer templates.
 *
 * This function is a build-time marker that gets transformed by the Vite plugin.
 * At build time, the plugin replaces `hbs`...`` with compiled template code.
 *
 * If this function is called at runtime, it means the template was not compiled,
 * which indicates a build configuration issue.
 */
export function hbs(_: TemplateStringsArray): ComponentReturnType {
  throw new Error(
    'hbs template was not compiled. Ensure the glimmer-next Vite plugin is configured correctly. ' +
    'Templates using hbs`...` must be processed at build time.'
  );
}
export function scope(items: Record<string, unknown>): void {
  if (typeof items !== 'object' || items === null) {
    throw new Error('scope() accepts only object');
  }
  // TODO: implement
}
