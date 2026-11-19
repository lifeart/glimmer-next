import { describe, test, expect } from 'vitest';
import { Preprocessor } from 'content-tag';
import { transform, type TransformResult } from './test';
import { defaultFlags } from './flags';

/**
 * AOT: a module whose templates key a list by position imports the item
 * reference follow runtime from `@lifeart/gxt/item-references` (the compiler's
 * ground truth `CompileResult.usedItemRefs`); any other module does not, so
 * the follow runtime tree-shakes out of a build that never keys by position.
 */
const ENTRY = '@lifeart/gxt/item-references';
const preprocessor = new Preprocessor();
const flags = { ...defaultFlags(), ASYNC_COMPILE_TRANSFORMS: false };
// The Ember dialect, native layer: the same import, from the template that
// keys a list by position or renders `{{#each-in}}` (an Ember host used to
// install the runtime for every app).
const emberFlags = {
  ...flags,
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
  FORCE_SYNC_LIST: true,
  EMBER_NATIVE: true,
  EMBER_SELF: true,
  EMBER_PROPERTY_TAGS: true,
};

async function compile(gts: string, withFlags = flags): Promise<string> {
  const pre = preprocessor.process(gts, { filename: 'test.gts' }).code;
  const result = (await transform(pre, 'test.gts', 'development', false, withFlags)) as TransformResult;
  return result.code;
}

describe('AOT item reference detection', () => {
  test('a list keyed by position imports the entry and calls it', async () => {
    const code = await compile(
      `<template>{{#each this.items key="@index" as |x|}}{{x}}{{/each}}</template>`,
    );
    expect(code).toContain(ENTRY);
    expect(code).toContain('$_itemRefKey("@index")');
    const mainImport =
      code.match(/import\s*\{[^}]*\}\s*from\s*['"]@lifeart\/gxt['"]/)?.[0] ?? '';
    expect(mainImport).not.toContain('$_itemRefKey');
  });

  test('Ember dialect: a list keyed by position imports the entry too', async () => {
    const code = await compile(
      `<template>{{#each @items key="@index" as |x|}}{{x}}{{/each}}</template>`,
      emberFlags,
    );
    expect(code).toContain(ENTRY);
    expect(code).toContain('$_itemRefKey("@index")');
  });

  test('Ember dialect: a native each-in imports the entry', async () => {
    const code = await compile(
      `<template>{{#each-in @obj as |k v|}}{{k}}={{v}}{{/each-in}}</template>`,
      emberFlags,
    );
    expect(code).toContain(ENTRY);
    expect(code).toContain('$_itemRefKey("@each-in")');
  });

  test('Ember dialect: a plain keyed list and a template with no list do not', async () => {
    for (const tpl of [
      `<template>{{#each @items key="id" as |x|}}{{x}}{{/each}}</template>`,
      `<template>{{#each @items as |x|}}{{x}}{{/each}}</template>`,
      `<template><p>{{@title}}</p></template>`,
    ]) {
      const code = await compile(tpl, emberFlags);
      expect(code).not.toContain(ENTRY);
      expect(code).not.toContain('$_itemRefKey');
    }
  });

  test('a module without one does not', async () => {
    const code = await compile(
      `<template>{{#each this.items key="id" as |x|}}{{x}}{{/each}}<p>{{this.a}}</p></template>`,
    );
    expect(code).not.toContain(ENTRY);
    expect(code).not.toContain('$_itemRefKey');
  });
});
