/**
 * Trusted-HTML node helper (`$_html`) — the first-class runtime behind a
 * compat-mode trusting mustache (`{{{expr}}}`) under the EMBER_TRUSTED_HTML flag.
 *
 * Exercises the observable contract the Ember bridge's `<EmberHtmlRaw>` machinery
 * used to provide (see ember content-test.js "Dynamic content tests (trusted)"):
 *   - raw (unescaped) innerHTML rendering,
 *   - reactive updates when the bound cell changes,
 *   - SafeString (`.toHTML()`) / null / undefined value handling,
 *   - contextual survival of `<tr>`/`<td>`/`<option>` inside table/select parents,
 *   - clean teardown of the rendered range.
 *
 * Rendered end-to-end through the runtime compiler (`template()`), so it also
 * covers the compat compile shape (`{{{expr}}}` → `$_html(() => expr, this)`).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from './component';
import { RENDERED_NODES_PROPERTY, addToTree, $template } from './shared';
import { $_c, $_args, $_edp } from './dom';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { cell } from './reactive';
import { renderElement } from './render-core';
import { destroyElement } from './destroy';
import {
  compileTemplate,
  template,
  setupGlobalScope,
  GXT_RUNTIME_SYMBOLS,
  type TemplateOptions,
} from '../../plugins/runtime-compiler';

// SafeString-like value (mirrors Ember's htmlSafe(...) result: a `.toHTML()`
// carrier that trusted content unwraps to raw HTML).
function htmlSafe(str: string) {
  return {
    toHTML() {
      return str;
    },
    toString() {
      return str;
    },
  };
}

const TRUSTED_FLAGS: TemplateOptions = {
  flags: { EMBER_TRUSTED_HTML: true },
};

describe('$_html trusted-HTML node helper', () => {
  let fixture: DOMFixture;

  function render<T = any>(
    componentOrTemplate: T | string,
    componentArgs: Record<string, unknown> = {},
    options: TemplateOptions = TRUSTED_FLAGS
  ) {
    const component =
      typeof componentOrTemplate === 'string'
        ? template(componentOrTemplate, options)
        : componentOrTemplate;

    const parentComponent = new Component({});
    parentComponent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, parentComponent);

    const args = $_args(componentArgs, false, $_edp as any);
    const instance = $_c(component as any, args, parentComponent);
    renderElement(fixture.api, parentComponent, fixture.container, instance);
    return { instance, parentComponent };
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

  beforeEach(() => {
    fixture = createDOMFixture();
    setupGlobalScope();
    const g = globalThis as any;
    Object.entries(GXT_RUNTIME_SYMBOLS).forEach(([name, value]) => {
      g[name] = value;
    });
  });

  afterEach(() => {
    fixture.cleanup();
  });

  // ---- compile shape ---------------------------------------------------------

  test('compat compile: {{{expr}}} emits $_html(() => expr, this) under the flag', () => {
    const result = compileTemplate('<div>{{{this.html}}}</div>', TRUSTED_FLAGS);
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('$_html(');
    expect(result.code).toMatch(/\$_html\(\s*\(\)\s*=>/);
    // Ground-truth emission report surfaces the symbol (no host-side regex).
    expect(Array.from(result.emittedSymbols)).toContain('$_html');
  });

  test('without the flag {{{expr}}} does NOT emit $_html (historic escaped path)', () => {
    const result = compileTemplate('<div>{{{this.html}}}</div>');
    expect(result.errors).toHaveLength(0);
    expect(result.code).not.toContain('$_html');
  });

  // ---- rendering -------------------------------------------------------------

  test('renders raw, unescaped HTML', () => {
    class C extends Component {
      html = '<b>Max</b>';
      [$template] = template('<div id="host">{{{this.html}}}</div>', TRUSTED_FLAGS);
    }
    render(C);
    const host = fixture.container.querySelector('#host')!;
    expect(host.querySelector('b')?.textContent).toBe('Max');
    expect(host.textContent).toBe('Max');
  });

  test('reactive innerHTML update on cell change', async () => {
    class C extends Component {
      htmlCell = cell('<b>Max</b>');
      get html() {
        return this.htmlCell.value;
      }
      [$template] = template('<div id="host">{{{this.html}}}</div>', TRUSTED_FLAGS);
    }
    const { instance } = render(C);
    const host = fixture.container.querySelector('#host')!;
    expect(host.querySelector('b')?.textContent).toBe('Max');

    (instance as any).htmlCell.update('<i>M</i><u>a</u><s>x</s>');
    await flush();

    expect(host.querySelector('b')).toBeNull();
    expect(host.querySelector('i')?.textContent).toBe('M');
    expect(host.querySelector('s')?.textContent).toBe('x');
    expect(host.textContent).toBe('Max');
  });

  test('SafeString value uses toHTML()', () => {
    class C extends Component {
      html = htmlSafe('<span class="safe">hi</span>');
      [$template] = template('<div id="host">{{{this.html}}}</div>', TRUSTED_FLAGS);
    }
    render(C);
    const host = fixture.container.querySelector('#host')!;
    expect(host.querySelector('span.safe')?.textContent).toBe('hi');
  });

  test('null / undefined / empty SafeString render an empty range', async () => {
    class C extends Component {
      valueCell = cell<unknown>('hello');
      get value() {
        return this.valueCell.value;
      }
      [$template] = template('<div id="host">before {{{this.value}}} after</div>', TRUSTED_FLAGS);
    }
    const { instance } = render(C);
    const host = fixture.container.querySelector('#host')!;
    expect(host.textContent).toBe('before hello after');

    for (const empty of [undefined, null, '', htmlSafe('')]) {
      (instance as any).valueCell.update(empty);
      await flush();
      // No content between the anchors — just the surrounding text nodes.
      expect(host.textContent).toBe('before  after');
      expect(host.querySelector('*')).toBeNull();

      (instance as any).valueCell.update('hello');
      await flush();
      expect(host.textContent).toBe('before hello after');
    }
  });

  // ---- contextual reparse ----------------------------------------------------

  test('<table>{{{trHtml}}} keeps <tr>/<td> alive', () => {
    class C extends Component {
      rowHtml = '<tr><td class="cell">data</td></tr>';
      [$template] = template('<table id="host">{{{this.rowHtml}}}</table>', TRUSTED_FLAGS);
    }
    render(C);
    const table = fixture.container.querySelector('#host')!;
    const td = table.querySelector('tr td.cell');
    expect(td).not.toBeNull();
    expect(td?.textContent).toBe('data');
  });

  test('<select>{{{optHtml}}} keeps <option> alive', () => {
    class C extends Component {
      optHtml = '<option value="a">A</option><option value="b">B</option>';
      [$template] = template('<select id="host">{{{this.optHtml}}}</select>', TRUSTED_FLAGS);
    }
    render(C);
    const select = fixture.container.querySelector('#host')!;
    const options = select.querySelectorAll('option');
    expect(options.length).toBe(2);
    expect(options[0].textContent).toBe('A');
    expect(options[1].getAttribute('value')).toBe('b');
  });

  // ---- mount-time contextual parse context -----------------------------------
  //
  // The real correctness of table/select foster-parenting (a `<tr>` parsed
  // in-`<table>` gets an implicit `<tbody>`; a bare `<td>` survives) is a
  // property of the browser's HTML parser and is applied ONLY when the innerHTML
  // is parsed against a real `<table>`/`<select>` context element — NOT against
  // the neutral `<template>` the initial mount would otherwise use (which yields
  // a bare `<tr>` with no `<tbody>`). happy-dom (this vitest harness) does not
  // implement foster-parenting, so we cannot assert the `<tbody>` structure
  // here; instead we assert the runtime SELECTS the correct parse-context scratch
  // element (the real parent's tag) at mount. In a real browser (and jsdom, which
  // the Ember integration's rehydration tests run under) that scratch is what
  // makes `<tbody>` appear. Ember's 14 unescaped-tr/td tests verify the DOM
  // structure end-to-end.

  // Records every element tag the runtime creates so a test can see which scratch
  // context `$_html` parses against. Restores the original method after `fn`.
  function recordTags(fn: () => void): string[] {
    const tags: string[] = [];
    const orig = fixture.api.element.bind(fixture.api);
    (fixture.api as any).element = (tag: string) => {
      tags.push(tag);
      return orig(tag);
    };
    try {
      fn();
    } finally {
      (fixture.api as any).element = orig;
    }
    return tags;
  }

  test('initial mount into a <table> re-parses against a <table> context (foster-parenting)', () => {
    class C extends Component {
      rowHtml = '<tr><td class="cell">data</td></tr>';
      [$template] = template('<table id="host">{{{this.rowHtml}}}</table>', TRUSTED_FLAGS);
    }
    const tags = recordTags(() => render(C));
    // One `<table>` for the real host element PLUS one `<table>` scratch created
    // by the mount-reparse hook (proving the parse targets the real parent
    // context, not the neutral `<template>`).
    expect(tags.filter((t) => t === 'table').length).toBe(2);
    // The initial (pre-mount) parse still uses the neutral `<template>`.
    expect(tags).toContain('template');
    // The row still renders.
    const table = fixture.container.querySelector('#host')!;
    expect(table.querySelector('tr td.cell')?.textContent).toBe('data');
  });

  test('initial mount into a <select> re-parses against a <select> context', () => {
    class C extends Component {
      optHtml = '<option value="a">A</option>';
      [$template] = template('<select id="host">{{{this.optHtml}}}</select>', TRUSTED_FLAGS);
    }
    const tags = recordTags(() => render(C));
    // real <select> + scratch <select> from the mount reparse.
    expect(tags.filter((t) => t === 'select').length).toBe(2);
  });

  test('initial mount into a NON-context parent (<div>) does NOT reparse', () => {
    class C extends Component {
      html = '<b class="x">Max</b>';
      [$template] = template('<div id="host">{{{this.html}}}</div>', TRUSTED_FLAGS);
    }
    const tags = recordTags(() => render(C));
    // Only the real <div> is created (no context scratch). The pre-mount parse
    // uses the neutral <template>, which already matches a <div> context — so no
    // second <div> scratch and no extra <template> reparse.
    expect(tags.filter((t) => t === 'div').length).toBe(1);
    expect(tags.filter((t) => t === 'template').length).toBe(1);
    // Content still renders.
    expect(fixture.container.querySelector('#host .x')?.textContent).toBe('Max');
  });

  test('reactive update inside a <table> keeps re-parsing against the <table> context', async () => {
    class C extends Component {
      rowCell = cell('<tr><td class="a">A</td></tr>');
      get rowHtml() {
        return this.rowCell.value;
      }
      [$template] = template('<table id="host">{{{this.rowHtml}}}</table>', TRUSTED_FLAGS);
    }
    const { instance } = render(C);
    const table = fixture.container.querySelector('#host')!;
    expect(table.querySelector('tr td.a')?.textContent).toBe('A');

    // The reactive reparse is async (scheduleRevalidate), so keep the recorder
    // active across the flush rather than using the synchronous recordTags().
    const tags: string[] = [];
    const orig = fixture.api.element.bind(fixture.api);
    (fixture.api as any).element = (tag: string) => {
      tags.push(tag);
      return orig(tag);
    };
    (instance as any).rowCell.update('<tr><td class="b">B</td></tr>');
    await flush();
    (fixture.api as any).element = orig;

    // The reactive reparse targets the real <table> parent (a <table> scratch),
    // not a neutral <template>.
    expect(tags).toContain('table');
    expect(tags).not.toContain('template');
    expect(table.querySelector('tr td.a')).toBeNull();
    expect(table.querySelector('tr td.b')?.textContent).toBe('B');
  });

  // ---- teardown --------------------------------------------------------------

  test('teardown removes the rendered range', async () => {
    class C extends Component {
      html = '<b class="live">Max</b>';
      [$template] = template('<div id="host">{{{this.html}}}</div>', TRUSTED_FLAGS);
    }
    const { parentComponent } = render(C);
    expect(fixture.container.querySelector('.live')).not.toBeNull();

    await destroyElement(parentComponent as any);

    expect(fixture.container.querySelector('.live')).toBeNull();
    expect(fixture.container.querySelector('#host')).toBeNull();
  });

  test('empty-branch clear: {{{value}}} that becomes empty leaves no stale nodes', async () => {
    class C extends Component {
      htmlCell = cell('<b class="a">A</b><b class="b">B</b>');
      get html() {
        return this.htmlCell.value;
      }
      [$template] = template('<div id="host">{{{this.html}}}</div>', TRUSTED_FLAGS);
    }
    const { instance } = render(C);
    const host = fixture.container.querySelector('#host')!;
    expect(host.querySelectorAll('b').length).toBe(2);

    (instance as any).htmlCell.update('');
    await flush();
    expect(host.querySelectorAll('b').length).toBe(0);

    (instance as any).htmlCell.update('<i class="c">C</i>');
    await flush();
    expect(host.querySelectorAll('b').length).toBe(0);
    expect(host.querySelector('i.c')?.textContent).toBe('C');
  });
});
