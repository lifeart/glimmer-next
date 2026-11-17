/**
 * The item reference follow runtime (`ItemReference`, a yielded block and an
 * `{{#in-element}}` that follow a kept row's item) is not part of the main
 * runtime: a build reaches it only through `@lifeart/gxt/item-references`,
 * which the compiler makes a module import when a template keys a list by
 * position, and which the runtime compiler (the Ember host's) installs.
 */
import { describe, test, expect } from 'vitest';
import { createRowRefs } from './item-reference-runtime';
import { compile } from '../../plugins/compiler/compile';

const LIST = '{{#each this.items key="@index" as |x|}}{{x}}{{/each}}';

describe('the item reference follow runtime is opt-in', () => {
  test('the core runtime has none until the entry installs it', async () => {
    expect(createRowRefs).toBe(null);
    const entry = await import('./item-references');
    entry.registerItemReferenceRuntime();
    expect(createRowRefs).not.toBe(null);
  });

  test('a standalone template keyed by position reaches it through the entry', () => {
    const standalone = compile(LIST, { flags: { IS_GLIMMER_COMPAT_MODE: true } as never });
    expect(standalone.code).toContain('$_itemRefKey("@index")');
    expect(standalone.usedItemRefs).toBe(true);
    const other = compile('{{#each this.items key="id" as |x|}}{{x}}{{/each}}', {
      flags: { IS_GLIMMER_COMPAT_MODE: true } as never,
    });
    expect(other.code).not.toContain('$_itemRefKey');
    expect(other.usedItemRefs).toBe(false);
  });

  test('the Ember dialect does not (its runtime compiler installs it)', () => {
    const ember = compile(LIST, {
      flags: { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true } as never,
    });
    expect(ember.code).not.toContain('$_itemRefKey');
    expect(ember.usedItemRefs).toBe(false);
  });
});
