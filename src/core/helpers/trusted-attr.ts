import { HOST_HOOKS } from '../host-hooks';

/**
 * Ember native layer (EMBER_NATIVE): a TRUSTING attribute value.
 *
 * Glimmer writes `style={{{value}}}` (a trusting mustache, its
 * TrustingDynamicAttribute) like `style={{value}}`, except that in development
 * only the non-trusting binding warns that binding `style` to a value that is
 * not an `htmlSafe` string may introduce XSS (Glimmer's
 * DebugStyleAttributeManager). The host emits that warning from its
 * `normalizeAttrValue` hook, which sees only the value; the compiler marks the
 * trusting value with `$_trustAttr(value)` and the host's `trustedAttrValue`
 * hook may turn it into a value it recognizes there. Without the hook (a
 * production host) the value is returned as is.
 */
export function $_trustAttr(value: unknown): unknown {
  const hook = HOST_HOOKS.trustedAttrValue;
  return hook === undefined ? value : hook(value);
}
