/**
 * Ember loose-mode (resolver-mode) resolution — G11, EMBER_LOOSE_COMPONENTS.
 *
 * Only active when `ctx.looseMode` (the EMBER_LOOSE_COMPONENTS flag AND a
 * template compiled with `strictMode: false`). Mirrors Glimmer's loose-mode
 * syntax rules (@glimmer/syntax `loose-resolution.ts`) for names the template
 * has NO lexical binding for:
 *
 *   - `<FooBar>` / `<Foo::Bar>` — uppercase-first — is a component resolved by
 *     name; Ember's `customizeComponentName` dasherization gives the registry
 *     name (`foo-bar`, `foo/bar`, `<XFoo>` → `x-foo`). A lowercase tag
 *     (`<div>`, `<foo-bar>`) is an element;
 *   - `{{#name …}}…{{/name}}` (block) is a component;
 *   - `{{name …}}` in content (append) position is a component OR a helper —
 *     decided by the host at render time (Glimmer resolves it when the template
 *     is first compiled for an owner); with no arguments, a name that is
 *     neither renders nothing;
 *   - sub-expressions / attribute values are helpers and modifiers are
 *     modifiers — those already reach the host managers as name strings.
 */
import type { CompilerContext } from '../context';
import type { SourceRange } from '../types';
import { addError } from '../context';
import { BUILT_IN_HELPER_NAMES } from '../serializers/symbols';
import { hasRealBinding } from './utils';

const SIMPLE_DASHERIZE_REGEXP = /[A-Z]|::/g;
const ALPHA = /[A-Za-z0-9]/;

/**
 * Ember's component-name dasherization (ember-template-compiler
 * `dasherize-component-name.ts`, the `customizeComponentName` hook Ember passes
 * to Glimmer): diverges from `String.dasherize` so `<XFoo />` resolves to
 * `x-foo`; `::` becomes `/`.
 */
export function dasherizeComponentName(name: string): string {
  return name.replace(SIMPLE_DASHERIZE_REGEXP, (char, index: number) => {
    if (char === '::') {
      return '/';
    }
    if (index === 0 || !ALPHA.test(name[index - 1]!)) {
      return char.toLowerCase();
    }
    return `-${char.toLowerCase()}`;
  });
}

/**
 * The registry name of a loose-mode angle-bracket component invocation, or
 * `null` when `tag` is not one (a lexical binding, a path / `@arg` / named
 * block / namespaced element, a lowercase element). A malformed single-colon
 * component name (`<Foo:Bar>`) is a compile error (Ember's assertion).
 */
export function looseComponentTagName(
  ctx: CompilerContext,
  tag: string,
  range?: SourceRange
): string | null {
  if (!ctx.looseMode) return null;
  if (tag.length === 0) return null;
  const first = tag[0]!;
  // Glimmer classifies by the FIRST character: uppercase = component
  // (`<Foo::Bar>` included), anything else (`<foo-bar>`, `<foo::bar>`) = element.
  if (!(first >= 'A' && first <= 'Z')) return null;
  if (tag.includes('.')) return null;
  const isNamespaced = tag.includes('::');
  if (!isNamespaced && hasRealBinding(ctx, tag)) return null;
  if (!isNamespaced && tag.includes(':')) {
    addError(
      ctx,
      `You tried to invoke a component named <${tag} /> in "${ctx.filename ?? '[NO MODULE]'}", but that is not a valid name for a component. Did you mean to use the "::" syntax for nested components?`,
      'E002',
      range
    );
    return null;
  }
  return dasherizeComponentName(tag);
}

/**
 * Block keywords (`{{#if}}`, …) that are never a by-name component.
 */
const LOOSE_BLOCK_KEYWORDS: ReadonlySet<string> = new Set([
  'if',
  'unless',
  'each',
  'each-in',
  'let',
  'with',
  'in-element',
  '-in-element',
  'component',
]);

/**
 * True when a block statement `{{#name …}}` with a simple callee is a
 * loose-mode by-name component invocation.
 */
export function isLooseBlockComponent(ctx: CompilerContext, name: string, isSimplePath: boolean): boolean {
  if (!ctx.looseMode || !isSimplePath) return false;
  if (LOOSE_BLOCK_KEYWORDS.has(name)) return false;
  return !hasRealBinding(ctx, name);
}

/**
 * Append-position keywords / built-ins the compiler lowers itself (they never
 * reach the by-name component-or-helper resolution).
 */
const LOOSE_APPEND_KEYWORDS: ReadonlySet<string> = new Set([
  'yield',
  'outlet',
  'unless',
  'unique-id',
  'mount',
  'component',
  'helper',
  'modifier',
  'element',
  'input',
  'textarea',
  'mut',
  'readonly',
  'unbound',
  'debugger',
  'log',
  'has-block',
  'has-block-params',
  'hasBlock',
  'hasBlockParams',
]);

/**
 * True when a content-position mustache `{{name …}}` with a simple callee is
 * a loose-mode by-name component-or-helper invocation.
 */
export function isLooseAppend(ctx: CompilerContext, name: string, isSimplePath: boolean): boolean {
  if (!ctx.looseMode || !isSimplePath || ctx.inAttributeValue || ctx.inAttributeConcat) {
    return false;
  }
  if (LOOSE_APPEND_KEYWORDS.has(name) || BUILT_IN_HELPER_NAMES.has(name)) return false;
  return !hasRealBinding(ctx, name);
}

/**
 * A loose template renders / invokes a dotted path whose head is a free name
 * (`{{hello.world}}`, `{{#hello.world}}`): Glimmer's compile-time error (there
 * is no implicit-this fallback and a free name cannot have members). `null`
 * when the path is fine.
 */
export function looseFreePathError(
  ctx: CompilerContext,
  head: string,
  path: string,
  position: 'append' | 'block'
): string | null {
  if (!ctx.looseMode) return null;
  if (hasRealBinding(ctx, head)) return null;
  return position === 'append'
    ? `You attempted to render a path (\`{{${path}}}\`), but ${head} was not in scope`
    : `You attempted to invoke a path (\`{{#${path}}}\`) but ${head} was not in scope`;
}
