/**
 * A positional `{{#each key="@index"}}` row stays while another item comes to
 * stand at it, and reads its item through a reference. The constructs that
 * read a value once, when they render, follow the reference too, as they
 * follow theirs in Glimmer — with the row's own DOM kept:
 *   - `{{yield item}}`: the yielded block is rendered again for an object that
 *     replaces the yielded one (dom.ts `renderSlot`);
 *   - `<Item />` with the item a component: the invocation swaps components
 *     (a dynamic `$_dc` invocation);
 *   - `{{#in-element item.target}}`: the block moves to the new destination.
 * Component arguments, `{{#let}}` and `(hash)` read the item through getters
 * and follow it in place.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { settle, mountRoot, setupRuntimeTemplateGlobals } from './__test-utils__/list-harness';
import { Component } from './component';
import { $template } from './shared';
import { cellFor } from './reactive';
import { template } from '../../plugins/runtime-compiler';

function defineRoot(tpl: string, scope: Record<string, unknown> = {}) {
  class Root extends Component {
    _items: unknown[] = [];
    constructor(args: any) {
      super(args);
      cellFor(this as any, '_items');
    }
    get items() {
      return this._items;
    }
    [$template] = template(tpl, { scope });
  }
  return Root as unknown as new (args: any) => Component<any> & { _items: unknown[] };
}

describe('a kept positional row follows its item where its body reads it once', () => {
  let fixture: DOMFixture;
  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
  });
  afterEach(() => {
    fixture.cleanup();
  });

  const lis = () => Array.from(fixture.container.querySelectorAll('li'));
  const texts = () => lis().map((li) => li.textContent);

  test('{{yield item}}: the yielded block shows the item now at the row, in the same row', async () => {
    const List = template(
      '<ul>{{#each @items key="@index" as |item|}}<li>{{yield item}}</li>{{/each}}</ul>',
    );
    const root = mountRoot(
      fixture,
      defineRoot('<List @items={{this.items}} as |x|><b>{{x.name}}</b></List>', { List }),
    );
    const a = { name: 'a' };
    const b = { name: 'b' };
    root._items = [a, b];
    await settle();
    const before = lis();
    expect(texts()).toEqual(['a', 'b']);

    root._items = [b, a];
    await settle();
    expect(texts()).toEqual(['b', 'a']);
    expect(lis()).toEqual(before);

    root._items = [{ name: 'c' }];
    await settle();
    expect(texts()).toEqual(['c']);
    expect(lis()[0]).toBe(before[0]);
  });

  test('<Item />: the row invokes the component now at it, in the same row', async () => {
    const A = template('<i>A</i>');
    const B = template('<i>B</i>');
    const root = mountRoot(
      fixture,
      defineRoot('<ul>{{#each this.items key="@index" as |Item|}}<li><Item /></li>{{/each}}</ul>'),
    );
    root._items = [A, B];
    await settle();
    const before = lis();
    expect(texts()).toEqual(['A', 'B']);

    root._items = [B, A];
    await settle();
    expect(texts()).toEqual(['B', 'A']);
    expect(lis()).toEqual(before);

    root._items = [B];
    await settle();
    expect(texts()).toEqual(['B']);
    expect(lis()[0]).toBe(before[0]);
  });

  test('component arguments, {{#let}} and (hash) follow the item in place', async () => {
    const Show = template('<b>{{@value.name}}</b>');
    const root = mountRoot(
      fixture,
      defineRoot(
        '<ul>{{#each this.items key="@index" as |item|}}<li><Show @value={{item}} />|{{#let item as |x|}}{{x.name}}{{/let}}|{{#let (hash v=item) as |h|}}{{h.v.name}}{{/let}}</li>{{/each}}</ul>',
        { Show },
      ),
    );
    const a = { name: 'a' };
    const b = { name: 'b' };
    root._items = [a, b];
    await settle();
    const before = lis();
    expect(texts()).toEqual(['a|a|a', 'b|b|b']);

    root._items = [b, a];
    await settle();
    expect(texts()).toEqual(['b|b|b', 'a|a|a']);
    expect(lis()).toEqual(before);
  });

  test('{{#in-element item.target}}: the block moves to the destination of the item now at the row', async () => {
    const doc = fixture.container.ownerDocument;
    const one = doc.createElement('div');
    const two = doc.createElement('div');
    fixture.container.append(one, two);
    const root = mountRoot(
      fixture,
      defineRoot(
        '{{#each this.items key="@index" as |item|}}{{#in-element item.target}}<i>{{item.name}}</i>{{/in-element}}{{/each}}',
      ),
    );
    root._items = [{ target: one, name: 'a' }];
    await settle();
    expect(one.textContent).toBe('a');
    expect(two.textContent).toBe('');

    root._items = [{ target: two, name: 'b' }];
    await settle();
    expect(one.textContent).toBe('');
    expect(two.textContent).toBe('b');

    root._items = [];
    await settle();
    expect(two.textContent).toBe('');
  });
});
