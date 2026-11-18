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

async function compile(gts: string): Promise<string> {
  const pre = preprocessor.process(gts, { filename: 'test.gts' }).code;
  const result = (await transform(pre, 'test.gts', 'development', false, flags)) as TransformResult;
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

  test('a module without one does not', async () => {
    const code = await compile(
      `<template>{{#each this.items key="id" as |x|}}{{x}}{{/each}}<p>{{this.a}}</p></template>`,
    );
    expect(code).not.toContain(ENTRY);
    expect(code).not.toContain('$_itemRefKey');
  });
});
