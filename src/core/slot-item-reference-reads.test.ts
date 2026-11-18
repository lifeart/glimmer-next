// @vitest-environment happy-dom
/**
 * A slot whose params read a list row's item reference passes them to its
 * block as references (the Ember dialect): a computation the slot is built in
 * must not depend on the item reference through the params — nor through the
 * block's reads of them — or another item coming to stand at the row would
 * render the block again. Only those item reference reads are kept from the
 * computation: one the block's content makes for a reason of its own, or one
 * the computation made before, stays.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { $_slot, $__bpv } from './dom';
import { Component } from './component';
import { RENDERED_NODES_PROPERTY, addToTree } from './shared';
import { getTracker, setTracker, type Cell } from './reactive';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { createItemReference, registerItemReferenceRuntime } from './item-references';

type RuntimeConstants = { WITH_EMBER_INTEGRATION: boolean };
const runtime = globalThis as unknown as RuntimeConstants;

describe('a slot built inside a tracked computation (Ember dialect)', () => {
  let fixture: DOMFixture;
  let saved: boolean;
  beforeEach(() => {
    saved = runtime.WITH_EMBER_INTEGRATION;
    runtime.WITH_EMBER_INTEGRATION = true;
    // rows keyed by position get item references from the follow runtime
    registerItemReferenceRuntime();
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
        // the block reads its param (through the param reference: a read
        // that belongs to the params) and, for a reason of its own, another
        // row's item
        expect($__bpv(p)).toEqual({ name: 'yielded' });
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

  test('keeps an item reference the computation read before the slot, also when the params read it', () => {
    const parent = new Component({});
    (parent as any)[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, parent as any);
    const row = createItemReference({ name: 'row' });
    const slots = {
      default: (_ctx: unknown, p: unknown) => {
        void $__bpv(p);
        return [];
      },
    };
    const frame: Set<Cell> = new Set();
    const outer = getTracker();
    setTracker(frame);
    try {
      // the computation reads the row's item itself, then yields it
      void row.value;
      $_slot('default', () => [row.value], slots as never, parent);
    } finally {
      setTracker(outer);
    }
    expect(frame.has(row as Cell)).toBe(true);
  });
});
