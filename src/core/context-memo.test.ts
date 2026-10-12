/**
 * EMBER_NATIVE memoized context lookups (context.ts `memoizedContext`): a
 * lookup memoizes its result on every ancestor it walked past, valid for one
 * (context epoch, tree epoch). These tests pin the invalidation: re-providing a
 * context (on the provider, or closer to the reader), tearing a provider or a
 * subtree down, and a node re-added under a different parent after teardown.
 *
 * The runtime reads the EMBER_NATIVE build constant, which vitest exposes as a
 * global: it is turned on per test (as the Ember native build defines it).
 */
import { expect, test, describe, beforeEach, afterEach, vi } from 'vitest';
import { getContext, provideContext, cleanupFastContext } from './context';
import {
  COMPONENT_ID_PROPERTY,
  RENDERED_NODES_PROPERTY,
  TREE,
  PARENT,
  CHILD,
  addToTree,
} from './shared';
import { cId } from './tree';
import { destroySync } from './glimmer/destroyable';
import type { ComponentLike } from './types';

const KEY = Symbol('memo-test-key');
const OTHER = Symbol('memo-test-other');

type Runtime = { EMBER_NATIVE: boolean };
const runtime = globalThis as unknown as Runtime;

function node(): ComponentLike {
  return { [COMPONENT_ID_PROPERTY]: cId(), [RENDERED_NODES_PROPERTY]: [] } as unknown as ComponentLike;
}

/** root → a → b → list, and `rows` children of list. */
function buildTree(rows = 2) {
  const root = node();
  PARENT.set(root[COMPONENT_ID_PROPERTY], null as never);
  TREE.set(root[COMPONENT_ID_PROPERTY], root);
  const a = node();
  const b = node();
  const list = node();
  addToTree(root, a);
  addToTree(a, b);
  addToTree(b, list);
  const rowCtxs = Array.from({ length: rows }, () => {
    const row = node();
    addToTree(list, row);
    return row;
  });
  return { root, a, b, list, rows: rowCtxs };
}

describe('EMBER_NATIVE memoized getContext', () => {
  let saved: boolean;

  beforeEach(() => {
    saved = runtime.EMBER_NATIVE;
    runtime.EMBER_NATIVE = true;
    cleanupFastContext();
  });

  afterEach(() => {
    runtime.EMBER_NATIVE = saved;
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
  });

  test('a lookup is answered from the ancestors memo after the first walk', () => {
    const { root, list, rows } = buildTree(3);
    provideContext(root, KEY, 'owner');
    expect(getContext(rows[0]!, KEY, false)).toBe('owner');
    // Break the chain ABOVE the list: a fresh walk would now stop at `b` and
    // find nothing, so a correct answer for the next rows comes from the memo
    // left on the list. (Test-only surgery: no epoch is bumped.)
    const listParent = PARENT.get(list[COMPONENT_ID_PROPERTY]);
    PARENT.delete(list[COMPONENT_ID_PROPERTY]);
    expect(getContext(rows[1]!, KEY, false)).toBe('owner');
    expect(getContext(rows[2]!, KEY, false)).toBe('owner');
    PARENT.set(list[COMPONENT_ID_PROPERTY], listParent!);
  });

  test('re-providing on the provider invalidates the memo', () => {
    const { root, rows } = buildTree();
    provideContext(root, KEY, 'first');
    expect(getContext(rows[0]!, KEY, false)).toBe('first');
    provideContext(root, KEY, 'second');
    expect(getContext(rows[1]!, KEY, false)).toBe('second');
    expect(getContext(rows[0]!, KEY, false)).toBe('second');
  });

  test('providing closer to the reader shadows the memoized value', () => {
    const { root, a, b, rows } = buildTree();
    provideContext(root, KEY, 'root');
    expect(getContext(rows[0]!, KEY, false)).toBe('root');
    provideContext(b, KEY, 'b');
    expect(getContext(rows[0]!, KEY, false)).toBe('b');
    // a sibling reader above `b` still sees the root's value
    const aside = node();
    addToTree(a, aside);
    expect(getContext(aside, KEY, false)).toBe('root');
  });

  test('a key that is not found is memoized as missing until it is provided', () => {
    const { root, rows } = buildTree();
    expect(getContext(rows[0]!, KEY, false)).toBe(null);
    expect(getContext(rows[1]!, KEY, false)).toBe(null);
    provideContext(root, KEY, 'late');
    expect(getContext(rows[0]!, KEY, false)).toBe('late');
  });

  test('tearing a provider down invalidates the memo below it', () => {
    const { root, b, rows } = buildTree();
    provideContext(root, KEY, 'root');
    provideContext(b, KEY, 'b');
    expect(getContext(rows[0]!, KEY, false)).toBe('b'); // memoized on `list`
    destroySync(b); // b's contexts and tree entry go; `list` is left orphaned
    // the plain walk stops at the missing parent: so must the memoized one
    expect(getContext(rows[1]!, KEY, false)).toBe(null);
    const fresh = node();
    addToTree(root, fresh);
    const reader = node();
    addToTree(fresh, reader);
    expect(getContext(reader, KEY, false)).toBe('root');
  });

  test('a node torn down and re-added under another parent is not answered from a stale memo', () => {
    const { root, a, b, list, rows } = buildTree();
    provideContext(b, KEY, 'under-b');
    provideContext(root, KEY, 'root');
    expect(getContext(rows[0]!, KEY, false)).toBe('under-b'); // memo on `list`
    // tear `list` out of the tree (its id is released) and re-add it under `a`
    destroySync(list);
    // (its released id may be handed out again: re-add it with a fresh one)
    (list as Record<symbol, unknown>)[COMPONENT_ID_PROPERTY] = cId();
    addToTree(a, list);
    const reader = node();
    addToTree(list, reader);
    expect(getContext(reader, KEY, false)).toBe('root');
  });

  test('keys are memoized independently; undefined and function values', () => {
    const { root, rows } = buildTree();
    let calls = 0;
    provideContext(root, KEY, undefined);
    provideContext(root, OTHER, () => ++calls);
    expect(getContext(rows[0]!, KEY, false)).toBe(undefined);
    expect(getContext(rows[1]!, KEY, false)).toBe(undefined);
    // a lazy (function) value is evaluated per lookup, never memoized
    expect(getContext(rows[0]!, OTHER, false)).toBe(1);
    expect(getContext(rows[1]!, OTHER, false)).toBe(2);
  });

  test('a required context that is missing still warns in development', () => {
    const { rows } = buildTree();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(getContext(rows[0]!, KEY)).toBe(null);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test('without the native runtime nothing is memoized', () => {
    runtime.EMBER_NATIVE = false;
    const { root, list, rows } = buildTree();
    provideContext(root, KEY, 'owner');
    expect(getContext(rows[0]!, KEY, false)).toBe('owner');
    PARENT.delete(list[COMPONENT_ID_PROPERTY]);
    expect(getContext(rows[1]!, KEY, false)).toBe(null);
  });
});
