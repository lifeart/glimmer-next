// @vitest-environment happy-dom
/**
 * A slot whose params read a list row's item reference passes them to its
 * block as references (the Ember dialect): a computation the slot is built in
 * must not depend on the item reference through the params, or another item
 * coming to stand at the row would render the block again. Only the item
 * reference reads the params make are kept from the computation — a read the
 * block's own content makes, or one the computation made before, stays.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { $_slot } from './dom';
import { Component } from './component';
import { RENDERED_NODES_PROPERTY, addToTree } from './shared';
import { getTracker, setTracker, type Cell } from './reactive';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { createItemReference } from './item-references';

type RuntimeConstants = { WITH_EMBER_INTEGRATION: boolean };
const runtime = globalThis as unknown as RuntimeConstants;

describe('a slot built inside a tracked computation (Ember dialect)', () => {
  let fixture: DOMFixture;
  let saved: boolean;
  beforeEach(() => {
    saved = runtime.WITH_EMBER_INTEGRATION;
    runtime.WITH_EMBER_INTEGRATION = true;
    fixture = createDOMFixture();
  });
  afterEach(() => {
    runtime.WITH_EMBER_INTEGRATION = saved;
    fixture.cleanup();
  });

  test('drops only the item references its params read', () => {
    const parent = new Component({});
    (parent as any)[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, parent as any);
    const yielded = createItemReference({ name: 'yielded' });
    const unrelated = createItemReference({ name: 'unrelated' });
    const before = createItemReference({ name: 'before' });
    let param: unknown;
    const slots = {
      default: (_ctx: unknown, p: unknown) => {
        param = p;
        // the block's own content reads another row's item
        void unrelated.value;
        return [];
      },
    };
    const frame: Set<Cell> = new Set();
    const outer = getTracker();
    setTracker(frame);
    try {
      void before.value;
      $_slot('default', () => [yielded.value], slots as never, parent);
    } finally {
      setTracker(outer);
    }
    expect(param).not.toBe(undefined);
    expect(frame.has(before as Cell)).toBe(true);
    expect(frame.has(unrelated as Cell)).toBe(true);
    expect(frame.has(yielded as Cell)).toBe(false);
  });
});
