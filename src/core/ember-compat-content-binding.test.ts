/**
 * Ember compat (WITH_EMBER_INTEGRATION without EMBER_NATIVE): a content
 * mustache gxt renders itself (the top level of a template or of a block)
 * reaches a dynamic-content binding the host registers (`contentBinding`).
 *
 * Glimmer renders a content-position `{{value}}` as what its value is (text, a
 * SafeString's HTML, a DOM node, a fragment's nodes) and re-decides on every
 * change. gxt's render-core consults a dynamic-content binding for every
 * reactive content value, but only the EMBER_NATIVE runtime could register
 * one, so in the compat build a content mustache outside an element stayed a
 * text binding: a SafeString rendered as escaped text, a value that started as
 * an object threw. A compat host now registers the binding with
 * `registerHostHooks({ contentBinding })` — gxt's own `bindNativeContent`, or
 * its own — without becoming the native runtime (`isNativeRuntime()` stays
 * false, so the native-only semantics keyed on it do not apply).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
// The compat test runtime (and with it the main entry) first: vite-node
// populates `export *` namespaces in import order (see
// plugins/__tests__/template-source.test.ts).
import { compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';
import { $template, COMPONENT_ID_PROPERTY } from './shared';
import { cId } from './tree';
import { cell } from './reactive';
import { syncDom } from './runtime';
import { isTagLike } from './shared';
import { bindNativeContent } from './dom';
import { HOST_HOOKS, registerHostHooks } from './host-hooks';
import { isNativeRuntime, type NativeContentBinding } from './native-content';

class SafeString {
  constructor(readonly html: string) {}
  toHTML() {
    return this.html;
  }
  toString() {
    return this.html;
  }
}

// The HTML of the nodes of `parent` without comments (gxt marks blocks with
// comments), text escaped.
function htmlOf(parent: Node): string {
  let html = '';
  parent.childNodes.forEach((node) => {
    if (node.nodeType === 3) {
      html += (node.nodeValue ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    } else if (node.nodeType === 1) {
      const element = node as Element;
      const tag = element.localName;
      html += `<${tag}>${htmlOf(element)}</${tag}>`;
    }
  });
  return html;
}

function clearHooks() {
  delete (HOST_HOOKS as Record<string, unknown>).contentBinding;
  delete (HOST_HOOKS as Record<string, unknown>).classifyContent;
}

// What the Ember compat host registers: gxt's dynamic-content binding, with
// SafeStrings classified as trusted HTML.
function registerCompatContent() {
  registerHostHooks({
    contentBinding: bindNativeContent,
    classifyContent: (value) => (value instanceof SafeString ? 'html' : undefined),
  });
}

describe('Ember compat: a host content binding renders content outside an element', () => {
  const compat = useEmberCompatRuntime();
  beforeEach(clearHooks);
  afterEach(clearHooks);

  function html() {
    return htmlOf(compat.fixture.container);
  }

  function em(text: string) {
    const element = compat.fixture.document.createElement('em');
    element.textContent = text;
    return element;
  }

  function fragmentOf(...nodes: Node[]) {
    const fragment = compat.fixture.document.createDocumentFragment();
    for (const node of nodes) fragment.appendChild(node);
    return fragment;
  }

  async function assertContentKinds(state: ReturnType<typeof cell<unknown>>) {
    expect(html()).toBe('plain &lt;b&gt;text&lt;/b&gt;');

    state.update(new SafeString('<b>bold</b>'));
    await syncDom();
    expect(html()).toBe('<b>bold</b>');

    const node = em('node');
    state.update(node);
    await syncDom();
    expect(html()).toBe('<em>node</em>');
    expect(node.isConnected).toBe(true);

    state.update(fragmentOf(em('one'), em('two')));
    await syncDom();
    expect(html()).toBe('<em>one</em><em>two</em>');
    expect(node.isConnected).toBe(false);

    state.update('back to <i>text</i>');
    await syncDom();
    expect(html()).toBe('back to &lt;i&gt;text&lt;/i&gt;');

    state.update(null);
    await syncDom();
    expect(html()).toBe('');
  }

  test('at the top level of a template', async () => {
    registerCompatContent();
    const state = cell<unknown>('plain <b>text</b>');
    compat.render(compileCompat('{{state.value}}', { state }));
    await assertContentKinds(state);
  });

  test('at the top level of an {{#if}} block', async () => {
    registerCompatContent();
    const state = cell<unknown>('plain <b>text</b>');
    const show = cell(true);
    compat.render(compileCompat('{{#if show.value}}{{state.value}}{{/if}}', { state, show }));
    await assertContentKinds(state);
  });

  test('a yielded block param at the top level of the block', async () => {
    registerCompatContent();
    const state = cell<unknown>('plain <b>text</b>');
    const inner = compileCompat('{{yield @value}}');
    const Yield = function Yield() {
      return { [COMPONENT_ID_PROPERTY]: cId(), [$template]: inner };
    };
    compat.render(
      compileCompat('<Yield @value={{state.value}} as |value|>{{value}}</Yield>', { state, Yield }),
    );
    await assertContentKinds(state);
  });

  test('a value that starts as trusted HTML or a node is bound too', async () => {
    registerCompatContent();
    const state = cell<unknown>(new SafeString('<b>first</b>'));
    const node = em('const');
    compat.render(compileCompat('{{state.value}}|{{node}}', { state, node }));
    expect(html()).toBe('<b>first</b>|<em>const</em>');
    state.update('text');
    await syncDom();
    expect(html()).toBe('text|<em>const</em>');
  });

  test('the binding gets the content formula and applies the value read on creation', async () => {
    const calls: string[] = [];
    const seen: unknown[] = [];
    const recording: NativeContentBinding = (api, treeParent, owner, textNode, f) => {
      seen.push(f);
      return bindNativeContent(api, treeParent, owner, textNode, f);
    };
    registerHostHooks({ contentBinding: recording });
    const state = cell('a');
    const hello = (value: string) => {
      calls.push(value);
      return `[${value}]`;
    };
    compat.render(compileCompat('{{(hello state.value)}}', { hello, state }));
    expect(seen).toHaveLength(1);
    expect(isTagLike(seen[0])).toBe(true);
    expect(html()).toBe('[a]');
    expect(calls).toEqual(['a']);
    state.update('b');
    await syncDom();
    expect(html()).toBe('[b]');
    expect(calls).toEqual(['a', 'b']);
  });

  test('a host content binding does not make the runtime the native one', () => {
    registerCompatContent();
    expect(isNativeRuntime()).toBe(false);
  });

  test('without a host binding a content mustache stays a text binding', async () => {
    const state = cell<unknown>('plain');
    compat.render(compileCompat('{{state.value}}', { state }));
    state.update(new SafeString('<b>bold</b>'));
    await syncDom();
    expect(html()).toBe('&lt;b&gt;bold&lt;/b&gt;');
  });
});

describe('standalone gxt: the host content binding is not consulted', () => {
  const runtime = globalThis as unknown as { WITH_EMBER_INTEGRATION: boolean };
  const compat = useEmberCompatRuntime();
  // After the compat runtime's own `beforeEach` (registered first), which
  // restores the constant after the test.
  beforeEach(() => {
    clearHooks();
    runtime.WITH_EMBER_INTEGRATION = false;
  });
  afterEach(clearHooks);

  test('a registered contentBinding is ignored', async () => {
    let called = false;
    registerHostHooks({
      contentBinding: (api, treeParent, owner, textNode, f) => {
        called = true;
        return bindNativeContent(api, treeParent, owner, textNode, f);
      },
    });
    const state = cell<unknown>('plain');
    compat.render(compileCompat('{{state.value}}', { state }));
    state.update(new SafeString('<b>bold</b>'));
    await syncDom();
    expect(called).toBe(false);
    expect(compat.fixture.container.textContent).toBe('<b>bold</b>');
  });
});
