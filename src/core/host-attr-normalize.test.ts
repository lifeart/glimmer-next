import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { HTMLBrowserDOMApi } from './dom-api';
import { $attr, $prop } from './dom';
import { cell, flushCellOpcodes, setIsRendering } from './reactive';
import { registerHostHooks, HOST_HOOKS, hostNormalizeAttrValue } from './host-hooks';

/**
 * normalizeAttrValue host hook — standalone-build coverage.
 *
 * The dom.ts consult sites are gated on the WITH_EMBER_INTEGRATION compile
 * flag (`const hook = WITH_EMBER_INTEGRATION ? hostNormalizeAttrValue : null`):
 * only host-integration builds carry the seam and the removeAttribute
 * sentinel branch; standalone builds fold the whole consult away at the
 * consumer's define step. Vitest runs with the standalone flags
 * (WITH_EMBER_INTEGRATION = false), so — exactly like the $_MANAGERS suite
 * (managers.test.ts) — these tests cover:
 *   (a) the standalone write path is byte-identical (doubles as the DCE pin:
 *       a REGISTERED hook is still never consulted under standalone flags);
 *   (b) the registry wiring (registerHostHooks ↔ the hot-path cache binding).
 * The flag-ON behavior (consult contract, remove sentinel, renormalize on
 * reactive re-apply, SVG routing, isProp side) is exercised end-to-end by the
 * Ember integration suite — the only consumer that compiles with
 * WITH_EMBER_INTEGRATION = true.
 */

// Clear the merged slot table AND re-sync the hot-path cache
// (`hostNormalizeAttrValue`) back to null. registerHostHooks({}) refreshes the
// cache from the (now empty) HOST_HOOKS table — see host-hooks.ts.
function resetHooks() {
  for (const key of Object.keys(HOST_HOOKS)) {
    delete (HOST_HOOKS as Record<string, unknown>)[key];
  }
  registerHostHooks({});
}

// Synchronously re-run a cell's opcodes (the reactive attr/prop effect),
// mirroring the drain pattern used by cached.test.ts.
function drain(c: unknown) {
  setIsRendering(true);
  try {
    flushCellOpcodes(c as Parameters<typeof flushCellOpcodes>[0]);
  } finally {
    setIsRendering(false);
  }
}

describe('normalizeAttrValue host hook (standalone flags)', () => {
  let window: Window;
  let document: Document;
  let api: HTMLBrowserDOMApi;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    api = new HTMLBrowserDOMApi(document);
  });

  afterEach(() => {
    resetHooks();
    window.close();
  });

  describe('(a) standalone write path is byte-identical', () => {
    test('static attr write is unchanged', () => {
      const div = api.element('div') as HTMLElement;
      $attr(api, div, 'title', 'hello', []);
      expect(div.getAttribute('title')).toBe('hello');
    });

    test('reactive attr write + update is unchanged', () => {
      const c = cell('a');
      const div = api.element('div') as HTMLElement;
      $attr(api, div, 'data-x', c, []);
      expect(div.getAttribute('data-x')).toBe('a');
      c.update('b');
      drain(c);
      expect(div.getAttribute('data-x')).toBe('b');
    });

    test('static prop write is unchanged', () => {
      const input = api.element('input') as HTMLInputElement;
      $prop(api, input, 'value', 'v', []);
      expect(input.value).toBe('v');
    });

    test('reactive prop write + update is unchanged', () => {
      const c = cell('v1');
      const input = api.element('input') as HTMLInputElement;
      $prop(api, input, 'value', c, []);
      expect(input.value).toBe('v1');
      c.update('v2');
      drain(c);
      expect(input.value).toBe('v2');
    });
  });

  describe('(b) WITH_EMBER_INTEGRATION gate pin: standalone builds never consult the hook', () => {
    test('a REGISTERED hook is not called by $attr/$prop and cannot remove attributes', () => {
      const calls: unknown[] = [];
      registerHostHooks({
        normalizeAttrValue(name, value) {
          calls.push([name, value]);
          // would be the remove sentinel / a rewrite if it were consulted
          return undefined;
        },
      });

      const div = api.element('div') as HTMLElement;
      // static attr: written verbatim, NOT removed (the sentinel would remove)
      $attr(api, div, 'title', 'kept', []);
      expect(div.getAttribute('title')).toBe('kept');

      // reactive attr: initial + update both bypass the hook
      const c = cell('r1');
      $attr(api, div, 'data-x', c, []);
      expect(div.getAttribute('data-x')).toBe('r1');
      c.update('r2');
      drain(c);
      expect(div.getAttribute('data-x')).toBe('r2');

      // prop side too
      const input = api.element('input') as HTMLInputElement;
      $prop(api, input, 'value', 'direct', []);
      expect(input.value).toBe('direct');

      expect(calls).toEqual([]);
    });
  });

  describe('(c) registry wiring (flag-independent)', () => {
    test('registerHostHooks sets the hot-path cache binding; reset clears it', () => {
      expect(hostNormalizeAttrValue).toBe(null);
      const fn = (_n: string, v: unknown) => v;
      registerHostHooks({ normalizeAttrValue: fn });
      expect(hostNormalizeAttrValue).toBe(fn);
      // merge-per-key: registering an unrelated hook keeps ours
      registerHostHooks({});
      expect(hostNormalizeAttrValue).toBe(fn);
      resetHooks();
      expect(hostNormalizeAttrValue).toBe(null);
    });
  });
});
