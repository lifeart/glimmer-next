/**
 * Runtime behaviour of `$_inElement`'s insertBefore mode argument.
 *
 * Exercises the render engine directly (a `Root` as the render context, like
 * list.test.ts) so the clear-vs-append + precise-teardown contract is covered
 * without a browser. Emission of the mode argument is pinned separately in
 * plugins/compiler/__tests__/in-element-insertbefore.test.ts.
 *
 * NOTE: IS_DEV_MODE compiles to `false` under vitest, so the dev-only
 * `insertBefore=<non-null>` assertion throw is NOT exercised here — the string
 * mode instead follows its production fallback (degrade to clear/replace). The
 * throw is a trivial `if (IS_DEV_MODE) throw` guard over that same branch.
 */
import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { HTMLBrowserDOMApi, DOMApi } from './dom-api';
import { Root, $_inElement, IN_ELEMENT_APPEND, IN_ELEMENT_CLEAR } from './dom';
import { runDestructors } from './destroy';
import { cleanupFastContext, provideContext, RENDERING_CONTEXT } from './context';
import { TREE, PARENT, CHILD } from './shared';

describe('$_inElement insertBefore modes', () => {
  let window: Window;
  let document: Document;
  let api: DOMApi;
  let root: Root;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    api = new HTMLBrowserDOMApi(document);
    cleanupFastContext();
    root = new Root(document);
    provideContext(root, RENDERING_CONTEXT, api);
  });

  afterEach(() => {
    // The teardown-specific tests destroy `root` themselves; module maps are
    // reset here so each test starts from a clean tree (no double-destroy).
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    window.close();
  });

  /** A target div pre-seeded with the text "foo ". */
  function seededTarget(): HTMLElement {
    const el = document.createElement('div') as unknown as HTMLElement;
    el.appendChild(document.createTextNode('foo '));
    return el;
  }

  /** Block body producing a single <span>bar</span>. */
  const barBody = () => {
    const span = document.createElement('span');
    span.textContent = 'bar';
    return [span as unknown as Node];
  };

  test('IN_ELEMENT_CLEAR replaces the target content (Ember default)', () => {
    const target = seededTarget();
    $_inElement(target, barBody, root, IN_ELEMENT_CLEAR);
    expect(target.textContent).toBe('bar');
  });

  test('IN_ELEMENT_APPEND keeps pre-existing content (insertBefore=null)', () => {
    const target = seededTarget();
    $_inElement(target, barBody, root, IN_ELEMENT_APPEND);
    expect(target.textContent).toBe('foo bar');
  });

  test('legacy 3-arg call appends (backwards compatible)', () => {
    const target = seededTarget();
    $_inElement(target, barBody, root);
    expect(target.textContent).toBe('foo bar');
  });

  test('string mode degrades to clear in production (IS_DEV_MODE false)', () => {
    // In a dev build this throws "Can only pass null to insertBefore …"; under
    // vitest (IS_DEV_MODE=false) it falls back to the default clear/replace.
    const target = seededTarget();
    $_inElement(target, barBody, root, '.foo');
    expect(target.textContent).toBe('bar');
  });

  describe('teardown restores the target', () => {
    test('CLEAR mode → target ends empty', async () => {
      const target = seededTarget();
      $_inElement(target, barBody, root, IN_ELEMENT_CLEAR);
      expect(target.textContent).toBe('bar');
      await Promise.all(runDestructors(root));
      expect(target.textContent).toBe('');
      expect(target.childNodes.length).toBe(0);
    });

    test('APPEND mode → only the rendered nodes are removed, pre-existing kept', async () => {
      const target = seededTarget();
      $_inElement(target, barBody, root, IN_ELEMENT_APPEND);
      expect(target.textContent).toBe('foo bar');
      await Promise.all(runDestructors(root));
      expect(target.textContent).toBe('foo ');
      expect(target.querySelector('span')).toBe(null);
    });
  });

  test('exported mode codes match the compiler contract', () => {
    // The compiler emits these numeric literals as the 4th $_inElement arg.
    expect(IN_ELEMENT_APPEND).toBe(0);
    expect(IN_ELEMENT_CLEAR).toBe(1);
  });
});
