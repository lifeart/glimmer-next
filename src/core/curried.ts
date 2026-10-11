/**
 * Curried values for the Ember native layer (G9).
 *
 * Under the EMBER_NATIVE build flag, `(component X a=1)`, `(helper Y 1)` and
 * `(modifier Z 1)` (`$_componentHelper` / `$_helperHelper` /
 * `$_modifierHelper`) return a CURRIED VALUE instead of invoking the definition
 * directly: a branded function carrying the definition plus the curried
 * positional / named arguments (still lazy — literal-or-thunk, see the
 * compiler's `buildNativeArg`). The value is consumed by the host managers
 * (`$_MANAGERS.component` through `$_c` / `$_dc`, `$_MANAGERS.helper` through
 * `$_maybeHelper`, `$_MANAGERS.modifier` through `$_maybeModifier`), which
 * resolve it with Glimmer's rules (`resolveCurried`):
 *
 *   - positional: inner-most curried first, then each outer layer, then the
 *     invocation's own positional arguments;
 *   - named: every layer's named arguments in order inner → outer; a later
 *     layer (and finally the invocation) overrides an earlier one.
 *
 * It is a FUNCTION (not a plain object) so that every gxt path that treats a
 * non-function value as "already rendered" (e.g. `$_dc`) still hands it to
 * the component machinery, and it has a `prototype` so the compat
 * arrow-getter unwrap heuristic never calls it. Calling it is an error.
 */

import { $_MANAGERS } from './manager-integration';

const CURRIED: unique symbol = Symbol.for('gxt.curried') as never;

export const CURRIED_COMPONENT = 0;
export const CURRIED_HELPER = 1;
export const CURRIED_MODIFIER = 2;
export type CurriedKind =
  | typeof CURRIED_COMPONENT
  | typeof CURRIED_HELPER
  | typeof CURRIED_MODIFIER;

export interface CurriedState {
  readonly kind: CurriedKind;
  /** The definition — itself possibly another curried value. */
  readonly definition: unknown;
  /** Curried positional arguments (literal-or-thunk). */
  readonly positional: readonly unknown[];
  /** Curried named arguments (literal-or-thunk values). */
  readonly named: Readonly<Record<string, unknown>>;
  /**
   * The render context the value was curried in (EMBER_NATIVE emission passes
   * it): what a curried helper rendered WITHOUT arguments hands the host helper
   * manager (its owner resolves a by-name definition).
   */
  readonly ctx?: unknown;
}

export interface ResolvedCurried {
  /** The inner-most, non-curried definition. */
  definition: unknown;
  /** All curried positional arguments, inner-most first. */
  positional: unknown[];
  /** Each layer's named arguments, inner-most first (later wins). */
  named: Array<Readonly<Record<string, unknown>>>;
}

const KIND_NAMES = ['component', 'helper', 'modifier'];

/** Unwrap one literal-or-thunk argument (EMBER_NATIVE argument convention). */
function argValue(value: unknown): unknown {
  return typeof value === 'function' ? (value as () => unknown)() : value;
}

/**
 * Build a curried value from the compiled `[definition, ...positional]` /
 * `{named}` arguments. The definition (literal-or-thunk) is read NOW — like a
 * Glimmer curry reference, the enclosing formula tracks it, so a changed
 * definition produces a new curried value. A nullish definition curries to
 * itself (Glimmer: `(component null)` renders nothing).
 */
export function $_curry(
  kind: CurriedKind,
  params: readonly unknown[],
  named: Readonly<Record<string, unknown>>,
  ctx?: unknown,
): unknown {
  const definition = argValue(params[0]);
  if (definition === null || definition === undefined) {
    return definition;
  }
  const state: CurriedState = {
    kind,
    definition,
    positional: params.slice(1),
    named,
    ctx,
  };
  const curried = function curriedValue() {
    // gxt renders a function value by calling it: `{{H}}` — a curried HELPER
    // rendered without arguments is invoked (Glimmer: dynamic content that is
    // a curried helper invokes it), through the host helper manager.
    // eslint-disable-next-line prefer-rest-params
    if (kind === CURRIED_HELPER && arguments.length === 0) {
      return $_MANAGERS.helper.handle(curried, [], {}, state.ctx);
    }
    throw new Error(
      `A curried ${KIND_NAMES[kind]} cannot be called directly; invoke it in a template.`,
    );
  };
  (curried as unknown as Record<symbol, CurriedState>)[CURRIED] = state;
  return curried;
}

/** The curried state of `value`, or `undefined` when it is not curried. */
export function getCurried(value: unknown): CurriedState | undefined {
  if (typeof value !== 'function') return undefined;
  return (value as unknown as Record<symbol, CurriedState | undefined>)[CURRIED];
}

/** True when `value` is a curried value (optionally of the given kind). */
export function isCurried(value: unknown, kind?: CurriedKind): boolean {
  const state = getCurried(value);
  return state !== undefined && (kind === undefined || state.kind === kind);
}

/**
 * Flatten a (possibly nested) curried value: the inner-most definition plus
 * every layer's arguments in Glimmer order (see the module comment). The
 * invocation's own arguments are applied by the consumer on top.
 */
export function resolveCurried(value: unknown): ResolvedCurried {
  let positional: unknown[] = [];
  const named: Array<Readonly<Record<string, unknown>>> = [];
  let current: unknown = value;
  let state = getCurried(current);
  while (state !== undefined) {
    // Outer layers are visited first: their positional arguments go AFTER the
    // inner ones, their named arguments win over the inner ones.
    positional = (state.positional as unknown[]).concat(positional);
    named.unshift(state.named);
    current = state.definition;
    state = getCurried(current);
  }
  return { definition: current, positional, named };
}
