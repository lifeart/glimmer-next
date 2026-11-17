/**
 * @vitest-environment happy-dom
 *
 * The manual test scheduler (installManualScheduler in src/tests/utils.ts).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '@/core/component';
import { $template } from '@/core/shared';
import { cellFor } from '@/core/reactive';
import { HOST_HOOKS } from '@/core/host-hooks';
import { createDOMFixture, type DOMFixture } from '@/core/__test-utils__';
import { mountRoot, setupRuntimeTemplateGlobals, settle } from '@/core/__test-utils__/list-harness';
import { template } from '../../plugins/runtime-compiler';
import { installManualScheduler, settled, type ManualScheduler } from './utils';

describe('manual test scheduler', () => {
  let fixture: DOMFixture;
  let scheduler: ManualScheduler | null;

  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
    scheduler = null;
  });

  afterEach(() => {
    scheduler?.uninstall();
    fixture.cleanup();
  });

  function mount(source: string) {
    class Root extends Component {
      label = 'a';
      show = true;
      items: { id: number }[] = [{ id: 1 }, { id: 2 }];
      constructor(args: any) {
        super(args);
        cellFor(this as any, 'label');
        cellFor(this as any, 'show');
        cellFor(this as any, 'items');
      }
      [$template] = template(source);
    }
    return mountRoot(fixture, Root as any) as unknown as {
      label: string;
      show: boolean;
      items: { id: number }[];
    };
  }
  const html = () => fixture.container.innerHTML.replace(/<!--.*?-->/g, '');

  test('a write is applied on flush(), synchronously', () => {
    scheduler = installManualScheduler();
    const root = mount('<p>{{this.label}}</p>');
    root.label = 'b';
    expect(scheduler.pending).toBe(true);
    expect(html()).toBe('<p>a</p>');
    scheduler.flush();
    expect(scheduler.pending).toBe(false);
    expect(html()).toBe('<p>b</p>');
  });

  test('settled() also waits for async teardown ({{#if}} swap, async list removal)', async () => {
    scheduler = installManualScheduler();
    const root = mount(
      '{{#if this.show}}<ul>{{#each this.items key="id" as |item|}}<li>{{item.id}}</li>{{/each}}</ul>{{else}}<p>hidden</p>{{/if}}',
    );
    await settled();
    expect(html()).toBe('<ul><li>1</li><li>2</li></ul>');
    root.items = [{ id: 2 }];
    await settled();
    expect(html()).toBe('<ul><li>2</li></ul>');
    root.show = false;
    await settled();
    expect(html()).toBe('<p>hidden</p>');
  });

  test('uninstall restores the default scheduling and flushes what is queued', async () => {
    const before = HOST_HOOKS.scheduleRevalidate;
    scheduler = installManualScheduler();
    const root = mount('<p>{{this.label}}</p>');
    root.label = 'queued';
    scheduler.uninstall();
    expect(HOST_HOOKS.scheduleRevalidate).toBe(before);
    expect(html()).toBe('<p>queued</p>');
    root.label = 'default';
    await settle();
    expect(html()).toBe('<p>default</p>');
  });

  test('one scheduler at a time', () => {
    scheduler = installManualScheduler();
    expect(() => installManualScheduler()).toThrow(/already installed/);
  });
});
