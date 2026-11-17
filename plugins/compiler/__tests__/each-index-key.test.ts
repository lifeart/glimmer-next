/**
 * Positional each keys (emberjs/ember.js#21340: the `@index`-key Updating test
 * and native "@key keys items by position"): the compiler no longer rewrites a
 * `{{#each key="@index"}}` key to `@identity` (with warning W003). `@index` is a
 * positional key the runtime (control-flow/list.ts) now honours, so it must be
 * emitted verbatim into the `$_each(…)` key argument.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

describe('{{#each key="@index"}} compiles to a positional key (no @identity rewrite)', () => {
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

  test('@key is the iteration key of an {{#each}} item, its position: emitted as @index', () => {
    const result = compile(
      '{{#each this.items key="@key" as |item|}}<li>{{item.name}}</li>{{/each}}',
    );
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('"@index"');
    expect(result.code).not.toContain('"@key"');
  });

  test('a positional row reads its item through the reference it is built with', () => {
    const result = compile(
      '{{#each this.items key="@index" as |item index|}}<li title={{item.title}}>{{item.name}} {{index}} {{item}}</li>{{/each}}',
    );
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('item.value.title');
    expect(result.code).toContain('item.value.name');
    expect(result.code).toContain('() => item.value');
    expect(result.code).toContain('index.value');
    expect(result.code).not.toMatch(/[^.\w$]item\.(title|name)/);
    // no static-block fast path for a positional row (its values would read
    // the reference)
    expect(result.code).not.toContain('$_blk');
  });

  test('a nested block param of the same name shadows the positional item', () => {
    const result = compile(
      '{{#each this.rows key="@index" as |item|}}{{#each item.cells as |item|}}<b>{{item.v}}</b>{{/each}}{{/each}}',
    );
    expect(result.errors).toHaveLength(0);
    // the outer item, read for the inner list's source
    expect(result.code).toContain('item.value.cells');
    // the inner item is the inner row's own item
    expect(result.code).toContain('item.v');
    expect(result.code).not.toContain('item.value.v');
  });

  test('other keys read the item itself', () => {
    const result = compile(
      '{{#each this.items key="id" as |item|}}<li>{{item.name}}</li>{{/each}}',
    );
    expect(result.errors).toHaveLength(0);
    expect(result.code).not.toContain('item.value');
  });

  test('a property-name key still passes through unchanged', () => {
    const result = compile(
      '{{#each this.items key="id" as |item|}}<li>{{item.id}}</li>{{/each}}',
    );
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('"id"');
  });
});
