/**
 * @vitest-environment happy-dom
 *
 * Mixed static + dynamic text as ONE text binding (COLLAPSE_MIXED_TEXT,
 * `optimizeTextChild` in plugins/compiler/visitors/element.ts, runtime
 * `$_txt` in src/core/helpers/text-concat.ts).
 *
 * Each case renders the same template with the collapse on and off (the AOT
 * defaults: no Ember integration) and checks that the text is the same at
 * every step while the collapsed element holds one text node.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from './component';
import { $template } from './shared';
import { cell, cellFor } from './reactive';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { settle, mountRoot, setupRuntimeTemplateGlobals } from './__test-utils__/list-harness';
import { template } from '../../plugins/runtime-compiler';
import { compile } from '../../plugins/compiler/compile';
import { $_txt } from './helpers/text-concat';

const ON = { WITH_EMBER_INTEGRATION: false, COLLAPSE_MIXED_TEXT: true };
const OFF = { WITH_EMBER_INTEGRATION: false, COLLAPSE_MIXED_TEXT: false };

describe('$_txt part coercion', () => {
  test('like a text node of its own: nullish is empty, cells are read, getters called', () => {
    const c = cell(3);
    expect($_txt(['a', null, 'b', undefined, 'c'])).toBe('abc');
    expect($_txt(['n=', 0, ' f=', false, ' t=', true])).toBe('n=0 f=false t=true');
    expect($_txt(['cell ', c])).toBe('cell 3');
    expect($_txt(['getter ', () => c])).toBe('getter 3');
    expect($_txt(['nil cell ', cell(null)])).toBe('nil cell ');
  });
});

describe('mixed text renders as one text node', () => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  class State extends Component {
    count = 1;
    total = 2;
    name: string | null = 'Ann';
    flag = false;
    boxed = cell('boxed');
    constructor(args: any) {
      super(args);
      for (const key of ['count', 'total', 'name', 'flag']) cellFor(this as any, key);
    }
  }

  async function render(source: string, flags: Record<string, boolean>) {
    const compiled = template(source, { flags });
    class Root extends State {
      [$template] = compiled;
    }
    const root = mountRoot(fixture, Root as any) as unknown as State;
    await settle();
    return root;
  }

  const el = () => fixture.container.querySelector('#t')!;
  const textNodes = () =>
    Array.from(el().childNodes).filter((n) => n.nodeType === 3).length;

  // [name, template, expected text nodes when collapsed, steps]
  const cases: Array<[string, string, number, Array<(s: State) => void>]> = [
    [
      'two values between static text',
      '<span id="t">Count: {{this.count}} of {{this.total}}!</span>',
      1,
      [(s) => (s.count = 5), (s) => (s.total = 9)],
    ],
    [
      'null / undefined parts render empty',
      '<span id="t">Hi {{this.name}}{{this.missing}}!</span>',
      1,
      [(s) => (s.name = null), (s) => (s.name = 'Bob')],
    ],
    [
      'booleans and numbers',
      '<span id="t">{{this.flag}} / {{this.count}}</span>',
      1,
      [(s) => (s.flag = true), (s) => (s.count = 0)],
    ],
    [
      'a cell value is read',
      '<span id="t">value: {{this.boxed}}</span>',
      1,
      [(s) => s.boxed.update('changed')],
    ],
    [
      'whitespace is kept exactly',
      '<p id="t">  a {{this.count}}  b  </p>',
      1,
      [(s) => (s.count = 7)],
    ],
    [
      'helpers',
      '<p id="t">{{if this.flag "yes" "no"}}: {{this.count}}</p>',
      1,
      [(s) => (s.flag = true)],
    ],
  ];

  for (const [name, source, collapsedNodes, steps] of cases) {
    test(name, async () => {
      const off = await render(source, OFF);
      const offTexts = [el().textContent];
      const offNodes = textNodes();
      for (const step of steps) {
        step(off);
        await settle();
        offTexts.push(el().textContent);
      }
      fixture.container.innerHTML = '';

      const on = await render(source, ON);
      const onTexts = [el().textContent];
      expect(textNodes()).toBe(collapsedNodes);
      for (const step of steps) {
        step(on);
        await settle();
        onTexts.push(el().textContent);
        expect(textNodes()).toBeLessThanOrEqual(collapsedNodes);
      }
      expect(onTexts).toEqual(offTexts);
      // the uncollapsed element had a text node per non-empty part
      expect(offNodes).toBeGreaterThan(collapsedNodes);
    });
  }

  test('an element child keeps the per-part rendering', async () => {
    await render('<p id="t">a <b>b</b> {{this.count}}</p>', ON);
    expect(el().querySelector('b')).not.toBeNull();
    expect(el().textContent).toBe('a b 1');
  });
});

describe('mixed text collapse: compile-time gates', () => {
  const code = (source: string, flags: Record<string, boolean> = {}) =>
    compile(source, { flags }).code;

  test('emits one $_txt text binding', () => {
    expect(code('<span>Count: {{this.count}}!</span>')).toContain(
      '["1", () => $_txt(["Count: ", this.count, "!"])]',
    );
  });

  test('off: with the flag off, under Ember integration, under EMBER_NATIVE', () => {
    const source = '<span>Count: {{this.count}}!</span>';
    expect(code(source, { COLLAPSE_MIXED_TEXT: false })).not.toContain('$_txt');
    expect(code(source, { WITH_EMBER_INTEGRATION: true })).not.toContain('$_txt');
    expect(code(source, { EMBER_NATIVE: true })).not.toContain('$_txt');
  });

  test('not for children that are not text and values', () => {
    expect(code('<p>a <b>b</b> {{this.x}}</p>')).not.toContain('$_txt');
    expect(code('<p>a {{yield}}</p>')).not.toContain('$_txt');
    expect(code('<p>a {{log this.x}}</p>')).not.toContain('$_txt');
    expect(code('<p>a {{#if this.x}}y{{/if}}</p>')).not.toContain('$_txt');
    // static text only: nothing to bind
    expect(code('<p>just text</p>')).not.toContain('$_txt');
  });
});
