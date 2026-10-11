/**
 * The template-function wrapper shared by the AOT module assembler
 * (plugins/test.ts, `.gjs`/`.gts` `<template>` tags) and the runtime compiler's
 * `compileTemplateSource` (plugins/runtime-compiler.ts). ONE builder, so a
 * template compiled at runtime under a host's flag set is emitted exactly like
 * the same template compiled ahead of time under the same flags (the Ember
 * native layer's emission-equality guarantee — AOT and runtime-compiled
 * templates must never drift).
 *
 * Browser-safe: no babel / node imports (the runtime compiler bundles it).
 */
import {
  SYMBOLS,
  LOOSE_SYMBOLS,
  NATIVE_SYMBOLS,
  OUTLET_SYMBOLS,
  PROPERTY_TAG_SYMBOLS,
  RECYCLE_SYMBOLS,
  SELF_SYMBOLS,
} from './symbols';
import type { Flags } from './flags';

/** The compile facts the wrapper needs (a subset of CompileResult). */
export interface WrappableTemplate {
  readonly code: string;
  readonly usedArgsAlias: boolean;
  readonly usedSlots: boolean;
  readonly usedFw: boolean;
  /** EMBER_SELF (G6): the body reads the self alias `$s`. */
  readonly usedSelf?: boolean;
}

export interface TemplateFunctionOptions {
  /** A class-body template (carried by its class): never `$_tpl`-branded. */
  readonly isClassTemplate?: boolean;
  /** Name for the branded function (`$_tpl(function Name() {…})`). */
  readonly templateName?: string;
}

/**
 * EMBER_SELF (G6) preamble statement, or '' when the body never reads `$s`.
 * `this` stays the render node; `$s` is the template's self.
 */
export function selfPreamble(template: WrappableTemplate): string {
  return template.usedSelf === true ? 'const $s = $_self(this);' : '';
}

/**
 * The `function () { … }` wrapper of a `<template>` (template-tag) template:
 * `$_GET_ARGS`, the preamble locals the body actually references (ground truth
 * from the compiler), `const roots = …` and `$_fin(roots, this)`. Under
 * EMBER_NATIVE a template-only template is branded `$_tpl(function Name() {…})`
 * (G14). With every Ember-native flag off the text is exactly the historic
 * assembler output.
 */
export function buildTemplateTagFunction(
  template: WrappableTemplate,
  flags: Partial<Flags>,
  options: TemplateFunctionOptions = {},
): string {
  const slotsResolution = `const $slots = ${SYMBOLS.$_GET_SLOTS}(this, arguments);`;
  const maybeFw = template.usedFw ? `const $fw = ${SYMBOLS.$_GET_FW}(this, arguments);` : '';
  const maybeSlots = template.usedSlots ? slotsResolution : '';
  const maybeArgsAlias = template.usedArgsAlias ? `const $a = this[${SYMBOLS.$args}];` : '';
  const self = selfPreamble(template);
  const maybeSelf = self === '' ? '' : `\n      ${self}`;
  const declareRoots = `const roots = ${template.code};`;
  const declareReturn = `return ${SYMBOLS.FINALIZE_COMPONENT}(roots, this);`;

  let result = `function () {
      ${maybeFw}
      ${SYMBOLS.$_GET_ARGS}(this, arguments);${maybeSelf}
      ${maybeArgsAlias}
      ${maybeSlots}
      ${declareRoots}
      ${declareReturn}
    }`;
  // EMBER_NATIVE (G14): brand template-only templates so the host can tell
  // them apart from its own function-shaped values (`isTemplateFn`).
  // Class-body templates are carried by their class and stay unbranded.
  // The call wrapper defeats JS name inference (`const Foo = $_tpl(function
  // () {…})` has an empty `.name`), so name the function after its binding.
  if (flags.EMBER_NATIVE === true && options.isClassTemplate !== true) {
    const name = options.templateName;
    const fn = name ? `function ${name}${result.slice('function '.length)}` : result;
    result = `$_tpl(${fn})`;
  }
  return result;
}

/** The maker's parameter: the values of the call's `scope` option. */
export const PRECOMPILE_SCOPE_PARAM = '$__scope';

/**
 * G10 (Ember native layer): the build-time replacement for the template-string
 * argument of an Ember `precompileTemplate(\`…\`, { scope, strictMode })` call
 * — a template MAKER the host's runtime `precompileTemplate` calls (lazily)
 * with the values of the call's `scope` option:
 *
 *   ($__scope) => { const { a, b } = $__scope; return $_tpl(function () {…}); }
 *
 * The scope keys are the template's only lexical names (bound as `const`s, so
 * a renamed entry `scope: () => ({ shadowArray: array })` binds `shadowArray`);
 * the template function itself is exactly the `<template>` wrapper
 * (buildTemplateTagFunction). Without scope keys: `() => $_tpl(function () {…})`.
 */
export function buildPrecompileTemplateMaker(
  template: WrappableTemplate,
  flags: Partial<Flags>,
  scopeKeys: readonly string[],
): string {
  const fn = buildTemplateTagFunction(template, flags, {});
  if (scopeKeys.length === 0) return `() => ${fn}`;
  return `(${PRECOMPILE_SCOPE_PARAM}) => {
      const { ${scopeKeys.join(', ')} } = ${PRECOMPILE_SCOPE_PARAM};
      return ${fn};
    }`;
}

/**
 * The Ember-native-layer runtime symbols a module compiled under `flags` may
 * reference, beyond the always-on barrel (`Object.values(SYMBOLS)`): the AOT
 * assembler imports exactly these from the main entry; the runtime compiler
 * binds them. Empty with every Ember-native flag off.
 */
export function nativeTemplateSymbols(flags: Partial<Flags>): string[] {
  const symbols: string[] = [];
  if (flags.EMBER_NATIVE === true) symbols.push(...NATIVE_SYMBOLS);
  if (flags.EMBER_OUTLET === true) symbols.push(...OUTLET_SYMBOLS);
  if (flags.EMBER_PROPERTY_TAGS === true) symbols.push(...PROPERTY_TAG_SYMBOLS);
  if (flags.EMBER_SELF === true) symbols.push(...SELF_SYMBOLS);
  if (flags.EMBER_LOOSE_COMPONENTS === true) symbols.push(...LOOSE_SYMBOLS);
  return Array.from(new Set(symbols));
}

/**
 * Every free runtime identifier a template body (plus its wrapper) compiled
 * under `flags` may reference from the MAIN `@lifeart/gxt` entry — exactly the
 * AOT import list: the always-on barrel (`Object.values(SYMBOLS)` minus the
 * recycle entry points, which live in `@lifeart/gxt/recycle` and are imported
 * only by modules that use `key="@recycle"`, plugins/babel.ts) plus the
 * Ember-native symbols. A runtime host binds each name to the export of the
 * same name from the main entry.
 */
export function templateScopeNames(flags: Partial<Flags>): string[] {
  const recycle = new Set<string>(RECYCLE_SYMBOLS);
  const barrel = Object.values(SYMBOLS).filter((name) => !recycle.has(name));
  return Array.from(new Set([...barrel, ...nativeTemplateSymbols(flags)]));
}
