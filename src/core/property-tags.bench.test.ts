/**
 * G8 render-level cost probe (Ember native layer, design §7 risk 7): create and
 * update a 1000-row `{{#each}}` whose rows read two member paths, compiled with
 * EMBER_PROPERTY_TAGS (+ EMBER_SELF) vs without. Reports timings; asserts only
 * that both variants render the same DOM and that the tapped variant updates on
 * a tag dirty (the untapped one cannot — that is the feature).
 */
import { describe, test, expect } from 'vitest';
import * as main from './index';
import { Component } from './component';
import { RENDERED_NODES_PROPERTY, addToTree } from './shared';
import { $_c, $_args, $_edp } from './dom';
import { createDOMFixture } from './__test-utils__';
import { renderElement } from './render-core';
import { destroyElementSync } from './destroy';
import { compileTemplateSource } from '../../plugins/runtime-compiler';
import { tagFor, dirtyCell } from './tags';
import { syncDom } from './runtime';

const BASE = {
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
  FORCE_SYNC_LIST: true,
  EMBER_NATIVE: true,
};
// Every row reads a two-segment `this.*` path (the G8 taps: 2 per row binding)
// next to a block-param read (already tapped under EMBER_NATIVE alone).
const TPL = '{{#each this.rows as |row|}}<li>{{row.id}} {{this.prefix.text}}</li>{{/each}}';

function compileWith(flags: Record<string, boolean>) {
  const { source, scopeNames } = compileTemplateSource(TPL, { flags });
  const exported = main as unknown as Record<string, unknown>;
  // eslint-disable-next-line no-new-func
  return new Function(...scopeNames, `"use strict"; return ${source};`)(
    ...scopeNames.map((n) => exported[n]),
  ) as (...args: unknown[]) => unknown;
}

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: i }));
}

async function run(flags: Record<string, boolean>, reps: number) {
  const tpl = compileWith(flags);
  const createTimes: number[] = [];
  let html = '';
  let updated = '';
  for (let r = 0; r < reps; r++) {
    const fixture = createDOMFixture();
    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, parent);
    const self = { rows: rows(1000), prefix: { text: 'p' } };
    const Def = function () {
      return { [main.COMPONENT_ID_PROPERTY]: main.cId(), [main.$SELF]: self, [main.$template]: tpl };
    };
    const t0 = performance.now();
    const instance = $_c(Def as any, $_args({}, false, $_edp as any), parent);
    renderElement(fixture.api, parent, fixture.container, instance);
    createTimes.push(performance.now() - t0);
    html = fixture.container.innerHTML.replace(/<!--[^]*?-->/g, '').replace(/ data-node-id="\d+"/g, '');
    self.prefix.text = 'changed';
    dirtyCell(tagFor(self.prefix, 'text'));
    await syncDom();
    updated = fixture.container.querySelectorAll('li')[5]!.textContent!;
    destroyElementSync(parent, false, fixture.api);
    fixture.cleanup();
  }
  createTimes.sort((a, b) => a - b);
  return { median: createTimes[(reps / 2) | 0], html, updated };
}

describe('G8 property taps: 1000-row create cost (report)', () => {
  test('tapped vs plain emission', async () => {
    const PLAIN = { ...BASE, EMBER_SELF: true };
    const TAPPED = { ...BASE, EMBER_SELF: true, EMBER_PROPERTY_TAGS: true };
    await run(PLAIN, 3); // warm-up
    await run(TAPPED, 3);
    const plain = await run(PLAIN, 9);
    const tapped = await run(TAPPED, 9);
    // eslint-disable-next-line no-console
    console.log(
      `[G8 bench] 1000-row create median: plain ${plain.median.toFixed(2)} ms, tapped ${tapped.median.toFixed(2)} ms (${(((tapped.median - plain.median) / plain.median) * 100).toFixed(1)}%)`,
    );
    expect(tapped.html).toBe(plain.html);
    expect(tapped.updated).toBe('5 changed');
    expect(plain.updated).toBe('5 p');
  });
});
