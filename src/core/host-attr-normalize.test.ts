import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { HTMLBrowserDOMApi } from './dom-api';
import { SVGBrowserDOMApi } from './svg-api';
import { $attr, $prop } from './dom';
import { cell, flushCellOpcodes, setIsRendering } from './reactive';
import { registerHostHooks, HOST_HOOKS } from './host-hooks';

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

describe('normalizeAttrValue host hook', () => {
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

  describe('(a) unregistered: byte-identical behavior', () => {
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

  describe('(b) registered hook sees (name, value, element) — static AND reactive', () => {
    test('static attr passes (name, value, element, isProp=false)', () => {
      const calls: Array<[string, unknown, Element, boolean]> = [];
      registerHostHooks({
        normalizeAttrValue(name, value, element, isProp) {
          calls.push([name, value, element, isProp]);
          return value;
        },
      });
      const div = api.element('div') as HTMLElement;
      $attr(api, div, 'title', 'X', []);
      expect(calls).toEqual([['title', 'X', div, false]]);
      expect(div.getAttribute('title')).toBe('X');
    });

    test('reactive attr renormalizes on EVERY update', () => {
      const calls: Array<[string, unknown]> = [];
      registerHostHooks({
        normalizeAttrValue(name, value) {
          calls.push([name, value]);
          // uppercase so we prove the returned value is what gets written
          return typeof value === 'string' ? value.toUpperCase() : value;
        },
      });
      const c = cell('r1');
      const div = api.element('div') as HTMLElement;
      $attr(api, div, 'data-y', c, []);
      // initial reactive apply
      expect(calls[calls.length - 1]).toEqual(['data-y', 'r1']);
      expect(div.getAttribute('data-y')).toBe('R1');
      // update -> hook must be consulted again with the new value
      c.update('r2');
      drain(c);
      expect(calls[calls.length - 1]).toEqual(['data-y', 'r2']);
      expect(div.getAttribute('data-y')).toBe('R2');
    });
  });

  describe('(c) remove sentinel (undefined) removes the attribute', () => {
    test('static: sentinel removes a pre-existing attribute', () => {
      registerHostHooks({
        // ember boolean-attr semantics: false / undefined => remove
        normalizeAttrValue(_name, value) {
          return value === false || value === undefined ? undefined : value;
        },
      });
      const div = api.element('div') as HTMLElement;
      div.setAttribute('disabled', ''); // pre-existing
      $attr(api, div, 'disabled', false as unknown, []);
      expect(div.hasAttribute('disabled')).toBe(false);
    });

    test('reactive: transition to sentinel removes, back to value re-adds', () => {
      registerHostHooks({
        normalizeAttrValue(_name, value) {
          return value === false ? undefined : value;
        },
      });
      const c = cell<unknown>('yes');
      const div = api.element('div') as HTMLElement;
      $attr(api, div, 'data-flag', c, []);
      expect(div.getAttribute('data-flag')).toBe('yes');
      // false -> remove sentinel
      c.update(false);
      drain(c);
      expect(div.hasAttribute('data-flag')).toBe(false);
      // back to a real value -> re-added
      c.update('again');
      drain(c);
      expect(div.getAttribute('data-flag')).toBe('again');
    });
  });

  describe('(d) applies in SVG / namespace providers', () => {
    let svgApi: SVGBrowserDOMApi;
    beforeEach(() => {
      svgApi = new SVGBrowserDOMApi(document);
    });

    test('hook is consulted and the returned value is written via the SVG api', () => {
      const seen: Array<[string, Element]> = [];
      registerHostHooks({
        normalizeAttrValue(name, value, element) {
          seen.push([name, element]);
          return value === 'BAD' ? 'good' : value;
        },
      });
      const rect = svgApi.element('rect');
      $attr(svgApi, rect as unknown as HTMLElement, 'width', 'BAD', []);
      expect(rect.getAttribute('width')).toBe('good');
      expect(seen[0][0]).toBe('width');
      expect(seen[0][1]).toBe(rect);
    });

    test('namespaced (xlink:href) attr still routes through the SVG api after normalize', () => {
      registerHostHooks({
        normalizeAttrValue(_name, value) {
          return value; // pass-through, but proves the seam runs pre-write
        },
      });
      const use = svgApi.element('use');
      $attr(svgApi, use as unknown as HTMLElement, 'xlink:href', '#icon', []);
      expect(
        use.getAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href') ||
          use.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
          use.getAttribute('xlink:href'),
      ).toBe('#icon');
    });
  });

  describe('(e) prop-side coverage (isProp=true, SafeString-style coercion)', () => {
    test('static prop: hook receives isProp=true and its return value is assigned', () => {
      const calls: Array<[string, unknown, boolean]> = [];
      registerHostHooks({
        normalizeAttrValue(name, value, _element, isProp) {
          calls.push([name, value, isProp]);
          // SafeString -> string coercion (the main prop-side ember fixup)
          if (isProp && value && typeof value === 'object' && 'toString' in value) {
            return String(value);
          }
          return value;
        },
      });
      const input = api.element('input') as HTMLInputElement;
      const safe = { toString: () => 'SAFE' };
      $prop(api, input, 'value', safe as unknown, []);
      expect(input.value).toBe('SAFE');
      expect(calls).toEqual([['value', safe, true]]);
    });

    test('reactive prop: renormalizes on update with isProp=true', () => {
      const flags: boolean[] = [];
      registerHostHooks({
        normalizeAttrValue(_name, value, _element, isProp) {
          flags.push(isProp);
          return typeof value === 'string' ? value.toUpperCase() : value;
        },
      });
      const c = cell('p1');
      const input = api.element('input') as HTMLInputElement;
      $prop(api, input, 'title', c, []);
      expect(input.title).toBe('P1');
      c.update('p2');
      drain(c);
      expect(input.title).toBe('P2');
      expect(flags.every((f) => f === true)).toBe(true);
    });
  });
});
