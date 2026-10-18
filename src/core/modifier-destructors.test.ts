/**
 * What an element modifier (`$ev` with the ON_CREATED event) leaves in its
 * owner's destructor list.
 *
 * A modifier that reads no cell (every Ember native modifier: its arguments
 * are thunks) runs once and never again, so its owner keeps only the
 * destructor the modifier returned, not a wrapper around it: a wrapper closure
 * keeps the whole binding alive (the modifier, its formula, its opcode and the
 * element) for as long as the row lives.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { $ev, EVENT_TYPE } from './dom';
import { HTMLBrowserDOMApi } from './dom-api';
import { cell, opsForTag, relatedTags, tagsToRevalidate } from './reactive';
import { syncDom } from './runtime';
import type { DestructorFn } from './glimmer/destroyable';

describe('element modifier destructors', () => {
  let window: Window;
  let api: HTMLBrowserDOMApi;
  let element: HTMLElement;

  beforeEach(() => {
    window = new Window();
    const document = window.document as unknown as Document;
    api = new HTMLBrowserDOMApi(document);
    element = document.createElement('div');
    tagsToRevalidate.clear();
  });

  afterEach(() => {
    tagsToRevalidate.clear();
    window.close();
  });

  function install(modifier: (element: HTMLElement) => unknown) {
    const destructors: DestructorFn[] = [];
    $ev(api, element, EVENT_TYPE.ON_CREATED, modifier as never, destructors);
    return destructors;
  }

  test('a modifier that reads no cell leaves exactly its own destructor', () => {
    const calls: string[] = [];
    const teardown = () => {
      calls.push('teardown');
    };
    const destructors = install((el) => {
      calls.push(`install:${el.tagName}`);
      return teardown;
    });
    expect(calls).toEqual(['install:DIV']);
    expect(destructors).toHaveLength(1);
    expect(destructors[0]).toBe(teardown);
    destructors[0]();
    expect(calls).toEqual(['install:DIV', 'teardown']);
  });

  test('a modifier that reads no cell and returns nothing leaves no destructor', () => {
    let installs = 0;
    const destructors = install(() => {
      installs++;
      return undefined;
    });
    expect(installs).toBe(1);
    expect(destructors).toEqual([]);
  });

  test('a modifier that reads no cell keeps no opcode or subscription', () => {
    const opsBefore = opsForTag.size;
    const relatedBefore = relatedTags.size;
    install(() => () => {});
    expect(opsForTag.size).toBe(opsBefore);
    expect(relatedTags.size).toBe(relatedBefore);
  });

  test("an async modifier destructor's promise is returned to the caller", async () => {
    const done = Promise.resolve();
    const teardown = () => done;
    const destructors = install(() => teardown);
    expect(destructors[0]()).toBe(done);
    await done;
  });

  test('a modifier that reads a cell re-runs on change and tears down its last run', () => {
    const value = cell(1, 'value');
    const calls: string[] = [];
    const destructors = install(() => {
      const v = value.value;
      calls.push(`install:${v}`);
      return () => {
        calls.push(`teardown:${v}`);
      };
    });
    expect(calls).toEqual(['install:1']);
    value.update(2);
    syncDom();
    expect(calls).toEqual(['install:1', 'teardown:1', 'install:2']);
    for (const destructor of destructors) {
      destructor();
    }
    expect(calls).toEqual(['install:1', 'teardown:1', 'install:2', 'teardown:2']);
    // Torn down: a later change does not run it again.
    value.update(3);
    syncDom();
    expect(calls).toEqual(['install:1', 'teardown:1', 'install:2', 'teardown:2']);
  });
});
