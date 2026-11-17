/**
 * A component invoked through a binding whose value can change follows the
 * value, as Glimmer's invocation of a local reference does: a `{{#let}}`
 * binding used as a component (`{{#let this.comp as |C|}}<C />{{/let}}`)
 * renders the component the binding holds now (`$_dc`). And a `$_dc` swap
 * leaves no stray placeholder comment behind, in every build.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { settle, mountRoot, setupRuntimeTemplateGlobals } from './__test-utils__/list-harness';
import { Component } from './component';
import { $template } from './shared';
import { cellFor } from './reactive';
import { template } from '../../plugins/runtime-compiler';

const STANDALONE = { WITH_EMBER_INTEGRATION: false };

function defineRoot(tpl: string, initial: unknown, flags: Record<string, boolean>) {
  class Root extends Component {
    _comp: unknown = initial;
    constructor(args: any) {
      super(args);
      cellFor(this as any, '_comp');
    }
    get comp() {
      return this._comp;
    }
    [$template] = template(tpl, { flags });
  }
  return Root as unknown as new (args: any) => Component<any> & { _comp: unknown };
}

describe('a component invoked through a binding follows its value', () => {
  let fixture: DOMFixture;
  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
  });
  afterEach(() => {
    fixture.cleanup();
  });

  const comments = () => {
    const walker = fixture.container.ownerDocument.createTreeWalker(
      fixture.container,
      128 /* SHOW_COMMENT */,
    );
    let count = 0;
    while (walker.nextNode()) count++;
    return count;
  };

  for (const [mode, flags] of [
    ['Ember dialect', {}],
    ['standalone', STANDALONE],
  ] as const) {
    test(`${mode}: {{#let}} binding used as a component`, async () => {
      const A = template('<i>A</i>', { flags });
      const B = template('<i>B</i>', { flags });
      const root = mountRoot(
        fixture,
        defineRoot('<p>{{#let this.comp as |C|}}<C />{{/let}}</p>', A, flags),
      );
      await settle();
      expect(fixture.container.querySelector('p')!.textContent).toBe('A');

      root._comp = B;
      await settle();
      expect(fixture.container.querySelector('p')!.textContent).toBe('B');

      root._comp = A;
      await settle();
      expect(fixture.container.querySelector('p')!.textContent).toBe('A');
    });

    test(`${mode}: a $_dc swap leaves no stray placeholder`, async () => {
      const A = template('<i>A</i>', { flags });
      const B = template('<i>B</i>', { flags });
      const root = mountRoot(fixture, defineRoot('<p><this.comp /></p>', A, flags));
      await settle();
      const initial = comments();
      expect(fixture.container.querySelector('p')!.textContent).toBe('A');

      root._comp = B;
      await settle();
      root._comp = A;
      await settle();
      root._comp = B;
      await settle();
      expect(fixture.container.querySelector('p')!.textContent).toBe('B');
      expect(comments()).toBe(initial);
    });
  }
});
