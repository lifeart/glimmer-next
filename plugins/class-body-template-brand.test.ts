/**
 * Ember mode: a class that declares a class-body `<template>` is branded.
 *
 * A class-body template compiles to an instance field (`[$template] = …`), so
 * the class that DECLARED it is not known from the instance: Ember (compat and
 * native) could not tell `Base (class-body) <- Mid (setComponentTemplate) <-
 * Leaf` from `Base (registered) <- Mid (class-body) <- Leaf`, and rendered
 * Base's class-body template for Leaf where Glimmer renders the nearest
 * template (Mid's registration). Under WITH_EMBER_INTEGRATION the declaring
 * class gets an own static `Symbol.for('gxt-class-body-template')` property,
 * so the host can walk the prototype chain and pick the nearest of a
 * registration and a class-body template.
 */
import { describe, test, expect } from 'vitest';
import { transform, type TransformResult } from './test';
import { defaultFlags, type Flags } from './flags';
import { CLASS_BODY_TEMPLATE } from '../src/core/shared';

const SOURCE = `import Component from '@glimmer/component';
export class Base extends Component {
  <template>base</template>
}
export class Mid extends Base {}
export class Leaf extends Mid {
  get x() { return 1; }
}
export const Other = class extends Leaf {
  <template>other</template>
};
`;

const ember = (): Flags => ({
  ...defaultFlags(),
  ASYNC_COMPILE_TRANSFORMS: false,
  WITH_EMBER_INTEGRATION: true,
});

async function compile(flags: Flags) {
  return ((await transform(SOURCE, '/app/c.gjs', 'production', false, flags)) as TransformResult).code;
}

describe('class-body template brand', () => {
  test('the shared brand is the registry symbol', () => {
    expect(CLASS_BODY_TEMPLATE).toBe(Symbol.for('gxt-class-body-template'));
  });

  test('Ember mode: the declaring class, and only it, owns the brand', async () => {
    const code = await compile(ember());
    const matches = code.match(/static \[Symbol\.for\("gxt-class-body-template"\)\] = true/g) ?? [];
    expect(matches).toHaveLength(2);
    // evaluate the class hierarchy with the compiled class bodies
    const body = code.replace(/^import[^\n]*\n/gm, '').replace(/export (class|const) /g, '$1 ');
    // eslint-disable-next-line no-new-func
    const { Base, Mid, Leaf, Other } = new Function(
      'Component',
      '$template',
      `${body}; return { Base, Mid, Leaf, Other };`,
    )(class {}, 'template');
    const owns = (c: object) => Object.prototype.hasOwnProperty.call(c, CLASS_BODY_TEMPLATE);
    expect([owns(Base), owns(Mid), owns(Leaf), owns(Other)]).toEqual([true, false, false, true]);
  });

  test('standalone gxt: no brand', async () => {
    expect(await compile({ ...defaultFlags(), ASYNC_COMPILE_TRANSFORMS: false })).not.toContain(
      'gxt-class-body-template',
    );
  });
});
