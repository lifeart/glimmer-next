/**
 * R10 (ember.js#21340 C36, N20): the compiler no longer rewrites a
 * `{{#each key="@index"}}` key to `@identity` (with warning W003). `@index` is a
 * positional key the runtime (control-flow/list.ts) now honours, so it must be
 * emitted verbatim into the `$_each(…)` key argument.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

describe('{{#each key="@index"}} compiles to a positional key (R10)', () => {
  test('@index is emitted verbatim (not rewritten to @identity) and warns nothing', () => {
    const result = compile(
      '{{#each this.items key="@index" as |item index|}}<li>{{index}}</li>{{/each}}',
    );
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('"@index"');
    expect(result.code).not.toContain('"@identity"');
    // W003 (the old "@index identity is not supported" fallback) is gone.
    expect(result.warnings.some((w) => w.code === 'W003')).toBe(false);
  });

  test('@identity still passes through unchanged', () => {
    const result = compile(
      '{{#each this.items key="@identity" as |item|}}<li>{{item}}</li>{{/each}}',
    );
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('"@identity"');
  });

  test('a property-name key still passes through unchanged', () => {
    const result = compile(
      '{{#each this.items key="id" as |item|}}<li>{{item.id}}</li>{{/each}}',
    );
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('"id"');
  });
});
