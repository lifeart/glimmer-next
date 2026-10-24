/**
 * Compile-time SyntaxError passthrough (ember.js#21340 compile-error group).
 *
 * The compiler reduces a thrown parse error to a one-line `message`
 * (`parseError.message.split('\n')[0]` + token/expected hints) and used to
 * DISCARD the original. A host (the Ember integration) could then only re-wrap
 * the reduced message, losing the original `@glimmer/syntax` SyntaxError's
 * code-frame and position. Since both sides pin the same `@glimmer/syntax`, the
 * compiler now keeps the original error on `CompilerError.originalError`, so the
 * host can rethrow it unchanged when there is a single error.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

describe('compile-time SyntaxError passthrough (originalError)', () => {
  test('a parse error keeps the original thrown error', () => {
    const result = compile('<div>');
    expect(result.errors).toHaveLength(1);
    const err = result.errors[0];
    expect(err.originalError).toBeInstanceOf(Error);
    // The reduced `message` begins with the first line of the original error's
    // message, so a host that rethrows `originalError` gets the full multi-line
    // message + code-frame the single-line form threw away.
    const original = err.originalError as Error;
    const firstLine = original.message.split('\n')[0];
    expect(err.message.startsWith(firstLine)).toBe(true);
    // The original carries MORE than the reduced one (the code-frame lines).
    expect(original.message.length).toBeGreaterThanOrEqual(firstLine.length);
  });

  test('a tokenizer/lexical error also keeps the original', () => {
    const result = compile('{{foo');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].originalError).toBeInstanceOf(Error);
  });

  test('a valid template produces no errors (passthrough is error-only)', () => {
    const result = compile('<div>ok</div>');
    expect(result.errors).toHaveLength(0);
  });
});
