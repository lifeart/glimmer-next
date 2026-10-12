/**
 * Ember semantics of the keyword helpers gxt compiles natively (G-kw).
 *
 * In an Ember NATIVE build (the EMBER_NATIVE build flag) `$__and`, `$__or`,
 * `$__not`, `$__eq` and the inline `$__if` delegate here instead of using
 * JavaScript truthiness / n-ary comparison:
 *
 *   - truthiness is Ember's `toBool` (the host's `toBool` hook: `[]` and
 *     empty array-likes are falsy, a SafeString of `''` is truthy, …);
 *   - `and` / `or` short-circuit and return the deciding VALUE (not a
 *     boolean), exactly like `@ember/helper`'s `and` / `or`;
 *   - arity is asserted in development with Glimmer's messages
 *     (`and` / `or` ≥ 2, `not` = 1, `eq` = 2).
 *
 * Arguments arrive as the compiler emits them for reactive helpers (getters /
 * literals); `unwrap` reads them lazily, so `and` / `or` never evaluate an
 * argument after the deciding one.
 */
import { HOST_HOOKS } from '../host-hooks';
import { unwrap } from './-private';

function toBool(value: unknown): boolean {
  const hook = HOST_HOOKS.toBool;
  return hook !== undefined ? hook(value) : !!value;
}

/** DEV arity check of `and` / `or` (exported for tests). */
export function expectAtLeastTwo(name: string, args: readonly unknown[]) {
  if (args.length < 2) {
    throw new Error(`\`${name}\` expects at least two arguments, but received ${args.length}.`);
  }
}

/** DEV arity check of `not` / `eq` (exported for tests). */
export function expectExactly(name: string, args: readonly unknown[], count: number) {
  if (args.length !== count) {
    throw new Error(
      `\`${name}\` expects exactly ${count === 1 ? 'one argument' : 'two arguments'}, but received ${args.length}.`,
    );
  }
}

export function emberAnd(args: readonly unknown[]): unknown {
  if (IS_DEV_MODE) expectAtLeastTwo('and', args);
  let last: unknown;
  for (let i = 0; i < args.length; i++) {
    last = unwrap(args[i]);
    if (!toBool(last)) return last;
  }
  return last;
}

export function emberOr(args: readonly unknown[]): unknown {
  if (IS_DEV_MODE) expectAtLeastTwo('or', args);
  let last: unknown;
  for (let i = 0; i < args.length; i++) {
    last = unwrap(args[i]);
    if (toBool(last)) return last;
  }
  return last;
}

export function emberNot(args: readonly unknown[]): boolean {
  if (IS_DEV_MODE) expectExactly('not', args, 1);
  return !toBool(unwrap(args[0]));
}

export function emberEq(args: readonly unknown[]): boolean {
  if (IS_DEV_MODE) expectExactly('eq', args, 2);
  return unwrap(args[0]) === unwrap(args[1]);
}

/** Inline `{{if cond a b}}` (and `unless`, compiled with swapped branches). */
export function emberIf(condition: unknown, ifTrue: unknown, ifFalse: unknown): unknown {
  return toBool(unwrap(condition)) ? unwrap(ifTrue) : unwrap(ifFalse);
}
