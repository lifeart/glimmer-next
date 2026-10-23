/**
 * @vitest-environment happy-dom
 *
 * `{{on}}` in frame-mode {{#each}} rows (list-frames.ts, "Events"): handlers
 * are row data, bubbling events go through one capture listener per list on
 * the list's parent, other events through a direct listener per node. These
 * tests pin the observable `{{on}}` contract a direct listener had:
 * arguments and currentTarget, inner-to-outer order, stopPropagation, order
 * against listeners above the list, non-bubbling events, a handler that
 * changes, a rebound row, teardown, and lists that mount through a fragment.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '../component';
import { $template, TREE } from '../shared';
import { cellFor } from '../reactive';
import { createDOMFixture, type DOMFixture } from '../__test-utils__';
import { settle, mountRoot, setupRuntimeTemplateGlobals } from '../__test-utils__/list-harness';
import { template } from '../../../plugins/runtime-compiler';
import { SyncListComponent, AsyncListComponent, type BasicListComponent } from './list';

interface Row {
  id: number;
  label: string;
}

const rowsOf = (...ids: number[]): Row[] =>
  ids.map((id) => {
    const row = { id, label: `r${id}` };
    cellFor(row, 'label');
    return row;
  });

describe('frame-mode {{#each}} rows with {{on}}', () => {
  let fixture: DOMFixture;
  let log: string[];

  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
    log = [];
  });

  afterEach(() => {
    fixture.cleanup();
  });

  function mount(body: string, outer = '<ul>{{EACH}}</ul>') {
    const each = `{{#each this.items key="id" as |item|}}${body}{{/each}}`;
    class Root extends Component {
      _items: Row[] = [];
      show = true;
      constructor(args: any) {
        super(args);
        cellFor(this as any, '_items');
        cellFor(this as any, 'show');
      }
      get items() {
        return this._items;
      }
      // `{{on}}` calls its handler as `($e, $n)` with `$n` undefined, so the
      // event is not the last argument `fn` passes on
      hit = (name: string, ...rest: unknown[]) => {
        const event = rest.find((x) => x instanceof (fixture.window as any).Event) as Event;
        const id = rest[0] instanceof (fixture.window as any).Event ? '-' : (rest[0] as Row).id;
        const current = event.currentTarget as Element;
        log.push(`${name}:${id}:${event.type}:${current?.getAttribute?.('data-k') ?? current?.nodeName}`);
      };
      stop = (event: Event) => {
        log.push('stop');
        event.stopPropagation();
      };
      outerHit = (event: Event) => {
        log.push(`outer:${event.type}`);
      };
      handler = (event: Event) => {
        log.push(`first:${event.type}`);
      };
      callHandler = (event: Event) => this.handler(event);
      [$template] = template(outer.replace('{{EACH}}', each));
    }
    return mountRoot(fixture, Root as any) as unknown as InstanceType<typeof Root>;
  }

  const list = () =>
    [...TREE.values()].find(
      (c) => c instanceof SyncListComponent || c instanceof AsyncListComponent,
    ) as BasicListComponent<Row>;
  const q = (selector: string) => fixture.container.querySelector(selector) as HTMLElement;
  const all = (selector: string) =>
    Array.from(fixture.container.querySelectorAll(selector)) as HTMLElement[];

  test('runs in frame mode and calls the handler with the event, currentTarget = the {{on}} element', async () => {
    const root = mount('<li data-k="li"><a data-k="a" {{on "click" (fn this.hit "a" item)}}>{{item.label}}</a></li>');
    root._items = rowsOf(1, 2);
    await settle();
    expect(list().frameMode).toBe(true);
    all('a')[1].click();
    expect(log).toEqual(['a:2:click:a']);
  });

  test('inner handler first, then outer, then a listener above the list', async () => {
    const root = mount(
      '<li data-k="li" {{on "click" (fn this.hit "li" item)}}><b data-k="b" {{on "click" (fn this.hit "b" item)}}><i>x</i></b></li>',
      '<div {{on "click" this.outerHit}}><ul>{{EACH}}</ul></div>',
    );
    root._items = rowsOf(1);
    await settle();
    q('i').click();
    expect(log).toEqual(['b:1:click:b', 'li:1:click:li', 'outer:click']);
  });

  test('stopPropagation in the inner handler stops the outer one and everything above', async () => {
    const root = mount(
      '<li data-k="li" {{on "click" (fn this.hit "li" item)}}><b {{on "click" this.stop}}>x</b></li>',
      '<div {{on "click" this.outerHit}}><ul>{{EACH}}</ul></div>',
    );
    root._items = rowsOf(1);
    await settle();
    q('b').click();
    expect(log).toEqual(['stop']);
  });

  test('preventDefault reaches the native event', async () => {
    const root = mount('<li><a {{on "click" this.prevent}}>x</a></li>');
    (root as any).prevent = (event: Event) => event.preventDefault();
    root._items = rowsOf(1);
    await settle();
    const event = new (fixture.window as any).MouseEvent('click', { bubbles: true, cancelable: true });
    q('a').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  test('non-bubbling events use direct listeners and do not bubble to the row', async () => {
    const root = mount(
      '<li data-k="li" {{on "mouseenter" (fn this.hit "li" item)}}><b data-k="b" {{on "mouseenter" (fn this.hit "b" item)}}>x</b></li>',
    );
    root._items = rowsOf(1);
    await settle();
    // the dispatcher does not listen for it at all
    expect(list().frameEvents).toBeNull();
    q('b').dispatchEvent(new (fixture.window as any).MouseEvent('mouseenter', { bubbles: false }));
    expect(log).toEqual(['b:1:mouseenter:b']);
    q('li').dispatchEvent(new (fixture.window as any).MouseEvent('mouseenter', { bubbles: false }));
    expect(log).toEqual(['b:1:mouseenter:b', 'li:1:mouseenter:li']);
  });

  test('a handler that changes is the one called', async () => {
    const root = mount('<li><a {{on "click" this.callHandler}}>x</a></li>');
    root._items = rowsOf(1);
    await settle();
    q('a').click();
    (root as any).handler = (event: Event) => log.push(`second:${event.type}`);
    q('a').click();
    expect(log).toEqual(['first:click', 'second:click']);
  });

  test('a rebound row (new object, same key) passes the new item', async () => {
    const root = mount('<li><a {{on "click" (fn this.pick item)}}>{{item.label}}</a></li>');
    (root as any).pick = (item: Row) => log.push(item.label);
    root._items = rowsOf(1);
    await settle();
    const a = q('a');
    a.click();
    const replacement = { id: 1, label: 'new' };
    cellFor(replacement, 'label');
    root._items = [replacement];
    await settle();
    // same key: same element, rebound to the new object
    expect(q('a')).toBe(a);
    a.click();
    expect(log).toEqual(['r1', 'new']);
  });

  test('two lists in one parent each handle only their rows', async () => {
    class Two extends Component {
      a: Row[] = rowsOf(1);
      b: Row[] = rowsOf(2);
      hit = (name: string, item: Row) => log.push(`${name}:${item.id}`);
      [$template] = template(
        '<ul>{{#each this.a key="id" as |item|}}<li class="a" {{on "click" (fn this.hit "a" item)}}></li>{{/each}}{{#each this.b key="id" as |item|}}<li class="b" {{on "click" (fn this.hit "b" item)}}></li>{{/each}}</ul>',
      );
    }
    mountRoot(fixture, Two as any);
    await settle();
    q('li.a').click();
    q('li.b').click();
    expect(log).toEqual(['a:1', 'b:2']);
  });

  test('a list mounted through a fragment (inside {{#if}}) still gets its listener', async () => {
    const root = mount(
      '<li {{on "click" (fn this.hit "li" item)}}></li>',
      '<div>{{#if this.show}}{{EACH}}{{/if}}</div>',
    );
    root._items = rowsOf(1, 2);
    await settle();
    root.show = false;
    await settle();
    root.show = true;
    await settle();
    await settle();
    all('li')[0].click();
    expect(log).toEqual(['li:1:click:LI']);
  });

  test('teardown removes the delegated listener', async () => {
    const root = mount('<li {{on "click" (fn this.hit "li" item)}}></li>');
    root._items = rowsOf(1);
    await settle();
    const l = list();
    const parent = q('ul');
    const events = l.frameEvents!;
    expect(events.root).toBe(parent);
    const removed: string[] = [];
    const original = parent.removeEventListener.bind(parent);
    parent.removeEventListener = ((type: string, fn: any, opts: any) => {
      removed.push(type);
      return original(type, fn, opts);
    }) as typeof parent.removeEventListener;
    root.show = false;
    (root as any)._items = [];
    await settle();
    // clearing keeps the listener (the list lives on) …
    expect(removed).toEqual([]);
    // … destroying the list removes it
    const { destroyElementSync } = await import('../destroy');
    destroyElementSync(l as any, false, fixture.api);
    expect(removed).toEqual(['click']);
    expect(l.frameEvents).toBeNull();
  });
});
