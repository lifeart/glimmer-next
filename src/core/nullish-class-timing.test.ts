/**
 * @vitest-environment happy-dom
 *
 * `class={{this.nothing}}` / `data-x={{this.nothing}}` (null) render no
 * attribute however the binding was created.
 *
 * A binding is const-collapsed only when its formula computes `isConst`,
 * which a formula does only when read inside a render pass. Outside one —
 * an `{{#if}}` branch rendered after the async teardown of the previous
 * branch, a component's block rendered under an outer tracker — it is
 * treated as reactive, and the reactive `$prop` wrote `className = ''` for
 * a null first value where the const path writes nothing: the same template
 * and state rendered `class=""` or no attribute depending on timing (and, in
 * the differential tests, on whether a sibling list ran in frame mode,
 * src/core/__fuzz__ seeds 410 and 1454 — `$attr` wrote `data-x=""` the same
 * way). A reactive binding's first value is now applied like a const one; a
 * later null still clears the class.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from './component';
import { $template } from './shared';
import { cellFor } from './reactive';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { settle, mountRoot, setupRuntimeTemplateGlobals } from './__test-utils__/list-harness';
import { template } from '../../plugins/runtime-compiler';

const Wrap = template('<span class="wrap">{{yield}}</span>');

describe('null class binding: no attribute, independent of timing', () => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  function mount(source: string) {
    class Root extends Component {
      flag = false;
      nothing: string | null = null;
      klass: string | null = null;
      constructor(args: any) {
        super(args);
        cellFor(this as any, 'flag');
        cellFor(this as any, 'klass');
      }
      [$template] = template(source, { scope: { Wrap } });
    }
    return mountRoot(fixture, Root as any) as unknown as Root;
  }
  const section = () => fixture.container.querySelector('section')!;

  test('inside a component block', async () => {
    mount('<Wrap><section class={{this.nothing}}></section></Wrap>');
    await settle();
    expect(section().hasAttribute('class')).toBe(false);
  });

  test('in an {{#if}} branch rendered after the previous branch is torn down', async () => {
    const root = mount(
      '{{#if this.flag}}<section class={{this.nothing}}></section>{{else}}<p>off</p>{{/if}}',
    );
    await settle();
    root.flag = true;
    await settle();
    await settle();
    expect(section().hasAttribute('class')).toBe(false);
  });

  test('attributes: data-x={{null}} in a late {{#if}} branch writes no attribute', async () => {
    const root = mount(
      '{{#if this.flag}}<section data-x={{this.nothing}} data-y={{this.klass}}></section>{{else}}<p>off</p>{{/if}}',
    );
    await settle();
    root.flag = true;
    await settle();
    await settle();
    expect(section().hasAttribute('data-x')).toBe(false);
    expect(section().hasAttribute('data-y')).toBe(false);
    root.klass = 'on';
    await settle();
    expect(section().getAttribute('data-y')).toBe('on');
  });

  test('a reactive class that starts null, gets a value, then goes back to null', async () => {
    const root = mount('<Wrap><section class={{this.klass}}></section></Wrap>');
    await settle();
    expect(section().hasAttribute('class')).toBe(false);
    root.klass = 'on';
    await settle();
    expect(section().className).toBe('on');
    root.klass = null;
    await settle();
    expect(section().className).toBe('');
  });
});
