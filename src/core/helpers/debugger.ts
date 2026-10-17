import { unwrap } from './-private';
import { HOST_HOOKS } from '../host-hooks';
import { inNewTrackingFrame } from '../reactive';
import { isTagLike } from '../shared';

/**
 * The scope an Ember-dialect `{{debugger}}` passes (the compiler's
 * `buildDebuggerScope`): the template's self, the block params and `{{#let}}`
 * bindings visible at the statement, and the component's named arguments, all
 * read lazily.
 */
interface DebuggerScope {
  self: () => unknown;
  locals: Record<string, () => unknown>;
  args: () => Record<string, unknown> | null | undefined;
}

function isDebuggerScope(value: unknown): value is DebuggerScope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as DebuggerScope).self === 'function' &&
    typeof (value as DebuggerScope).locals === 'object' &&
    typeof (value as DebuggerScope).args === 'function'
  );
}

const hasOwn = Object.prototype.hasOwnProperty;

// A gxt cell (e.g. a reactive index) reads as its value.
function valueOf(value: unknown): unknown {
  return typeof value === 'object' && value !== null && isTagLike(value)
    ? (value as { value: unknown }).value
    : value;
}

/**
 * Glimmer's debugger `get(path)`: `this` is the self, `@name` a named
 * argument, a block param or `{{#let}}` binding that local, anything else a
 * path on the self; the rest of the path is read member by member.
 */
function debuggerGet(self: unknown, scope: DebuggerScope | null, path: string): unknown {
  const [head, ...tail] = path.split('.') as [string, ...string[]];
  let value: unknown;
  if (head === 'this') {
    value = self;
  } else if (head.startsWith('@')) {
    const args = scope === null ? undefined : scope.args();
    value = args === null || args === undefined ? undefined : args[head.slice(1)];
  } else if (scope !== null && hasOwn.call(scope.locals, head)) {
    value = scope.locals[head]();
  } else {
    value = self === null || self === undefined ? undefined : (self as Record<string, unknown>)[head];
  }
  for (const part of tail) {
    value = valueOf(value);
    if (value === null || value === undefined) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return valueOf(value);
}

/**
 * `{{debugger}}`. In an Ember build with a `debugger` host hook (Glimmer's
 * debugger callback), the hook gets the template's self and a `get(path)`
 * over the scope the compiler passed, once each time the statement renders:
 * it runs untracked, so what it reads never renders the statement again.
 * Otherwise it logs its context and arguments and hits a breakpoint.
 */
export function $__debugger(this: any, ...args: unknown[]) {
  if (WITH_EMBER_INTEGRATION) {
    const hook = HOST_HOOKS.debugger;
    if (hook !== undefined) {
      const scope = args.length === 1 && isDebuggerScope(args[0]) ? args[0] : null;
      inNewTrackingFrame(() => {
        const self = scope === null ? this : scope.self();
        hook(self, (path: string) => debuggerGet(self, scope, path));
      });
      return '';
    }
  }
  // Unwrap all args (they may be getters in compat mode)
  console.info(this, ...args.map(unwrap));
  debugger;
  return '';
}
