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
