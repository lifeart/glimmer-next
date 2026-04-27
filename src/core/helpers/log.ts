import { unwrap } from './-private';

// Track previously-logged site signatures so re-renders of the same
// `{{log ...}}` site with identical (unwrapped) values don't spam the
// console. The compile-time transform prepends a stable `__logSite:N`
// id as the first arg in IS_GLIMMER_COMPAT_MODE — see
// plugins/compiler/serializers/value.ts (~line 80). The id is consumed
// here and MUST NOT leak through to `console.log`.
const __logSiteSignatures = new Map<string, string>();

export function $__log(...args: unknown[]) {
  // Unwrap all args (they may be getters in compat mode)
  const unwrapped = args.map(unwrap);
  let siteId: string | undefined;
  if (
    unwrapped.length > 0 &&
    typeof unwrapped[0] === 'string' &&
    (unwrapped[0] as string).startsWith('__logSite:')
  ) {
    siteId = unwrapped.shift() as string;
  }
  // De-dupe identical re-evaluations of the same compile-time site.
  // Falls back to logging unconditionally when no site id is present
  // (non-compat mode, or programmatic callers).
  if (siteId !== undefined) {
    let signature: string;
    try {
      signature = JSON.stringify(unwrapped, (_k, v) =>
        // Best-effort: structures with cycles or non-JSON values fall
        // back to a coarse string identity below.
        typeof v === 'function' ? `[Function:${(v as Function).name || 'anonymous'}]` : v,
      );
    } catch {
      signature = String(unwrapped);
    }
    if (__logSiteSignatures.get(siteId) === signature) {
      return '';
    }
    __logSiteSignatures.set(siteId, signature);
  }
  console.log(...unwrapped);
  return '';
}
