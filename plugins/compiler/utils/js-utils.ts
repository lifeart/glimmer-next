/**
 * Shared JavaScript utility functions for the compiler.
 */

/**
 * Check if a string is a safe JavaScript key (doesn't need quoting).
 * Safe keys are valid JS identifiers: start with letter/underscore/$, followed by alphanumerics/underscore/$
 */
export function isSafeKey(key: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key);
}

/**
 * Quote a key if it's not a safe JavaScript identifier.
 * Handles hyphenated keys like "my-component" -> '"my-component"'
 */
export function quoteKey(key: string): string {
  return isSafeKey(key) ? key : JSON.stringify(key);
}

/**
 * JavaScript reserved words that cannot be used as a `let`/arrow-parameter
 * binding name. A template may legally declare any of these as a block param
 * (`{{#each x as |if|}}`) or `{{#let}}` binding, but emitting `let if = …` or
 * `(if) => …` is a SyntaxError. Includes ES keywords, the `null`/`true`/`false`
 * literals, and the strict-mode / future-reserved words (`let`, `static`,
 * `await`, `enum`, `arguments`, `eval`, …) so the compiled output is valid in
 * both sloppy and strict/module contexts.
 */
export const JS_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'return', 'super',
  'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with',
  'yield',
  // literals
  'null', 'true', 'false',
  // strict-mode / future-reserved
  'let', 'static', 'implements', 'interface', 'package', 'private',
  'protected', 'public', 'enum', 'await', 'arguments', 'eval',
]);

/** True when `name` cannot be emitted as a `let`/parameter binding identifier. */
export function isReservedWord(name: string): boolean {
  return JS_RESERVED_WORDS.has(name);
}

/**
 * Map a block-param / let-binding name to a safe JS identifier. Reserved words
 * (`if`, `class`, `return`, …) are prefixed with `__bp_` so both the
 * declaration site (`let __bp_if = …` / `(__bp_if) => …`) and every reference
 * are valid JS. Non-reserved names pass through unchanged, so existing output
 * stays byte-identical. The mapping is pure/deterministic, so the declaration
 * and reference sites derive the same identifier independently.
 */
export function escapeReservedBindingName(name: string): string {
  return isReservedWord(name) ? `__bp_${name}` : name;
}

// A JS IdentifierName without escapes: what a `let` / parameter binding can be
// named (reserved words aside).
const JS_IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u;
const JS_IDENTIFIER_PART = /^[\p{ID_Continue}]$/u;

/**
 * The JS identifier a block-param / let-binding name is declared and
 * referenced under. Reserved words are escaped as by
 * {@link escapeReservedBindingName}. Under the Ember native layer
 * (`nativeNames`, the EMBER_NATIVE flag) a name that is not a JS identifier at
 * all is escaped too: Glimmer accepts any block-param name its parser reads
 * (`{{#let x as |-in-element|}}`, `as |foo-bar|`), which would otherwise be
 * emitted verbatim (`let -in-element = …`, a SyntaxError). Every character that
 * cannot continue a JS identifier becomes `$<hex code point>$` after the
 * `__bp_` prefix (`-in-element` → `__bp_$2d$in$2d$element`), so distinct names
 * stay distinct. Pure and deterministic like the reserved-word escape: the
 * declaration and reference sites derive the same identifier independently.
 */
export function escapeBindingName(name: string, nativeNames?: boolean): string {
  if (nativeNames === true && !JS_IDENTIFIER.test(name)) {
    let escaped = '__bp_';
    for (const char of name) {
      escaped += JS_IDENTIFIER_PART.test(char) ? char : `$${char.codePointAt(0)!.toString(16)}$`;
    }
    return escaped;
  }
  return escapeReservedBindingName(name);
}
