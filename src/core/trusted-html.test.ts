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
