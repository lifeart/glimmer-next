/**
 * Ember compat (WITH_EMBER_INTEGRATION without EMBER_NATIVE): an element's
 * `class` is a Glimmer attribute in gxt's own `_DOM`.
 *
 * Glimmer never maps `class` to a property: one value is a dynamic attribute
 * (normalizeValue: `false` / `null` / `undefined` remove it, `true` is
 * `class=""`), and several (the element's own and the forwarded ones) merge
 * like createClassListRef. gxt's compat element builder set classes through
 * the `className` property, so a build-time (.gjs) template of an Ember
 * consumer, whose `$_tag` is gxt's own, rendered `class={{false}}` as
 * `class="false"`, `null` as `class=""` and joined empty parts into stray
 * spaces. The `{{#each}}` row fast path (static blocks) did the same.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { cell } from './reactive';
import { syncDom } from './runtime';
import { registerHostHooks, HOST_HOOKS } from './host-hooks';
import { compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';

/** Glimmer's normalizeValue for an attribute write (`undefined` = remove). */
function glimmerAttrValue(_name: string, value: unknown, _el: Element, isProp: boolean) {
  if (isProp) return value;
  if (
    value === false ||
    value === undefined ||
    value === null ||
    typeof value === 'function' ||
    typeof (value as { toString?: unknown }).toString !== 'function'
  ) {
    return undefined;
  }
  return value === true ? '' : String(value);
}

describe('Ember compat: class is an attribute in gxt `_DOM`', () => {
  const compat = useEmberCompatRuntime();

  beforeEach(() => {
    registerHostHooks({ normalizeAttrValue: glimmerAttrValue });
  });

  afterEach(() => {
    (HOST_HOOKS as Record<string, unknown>).normalizeAttrValue = undefined;
    registerHostHooks({});
  });

  const render = (template: Parameters<typeof compat.render>[0], self: Record<string, unknown>) =>
    compat.render(template, self);

  test('one class value follows Glimmer normalizeValue', () => {
    const template = compileCompat('<div class={{this.c}}></div>');
    for (const [value, expected] of [
      ['x', 'x'],
      [false, null],
      [null, null],
      [undefined, null],
      ['', ''],
      [true, ''],
    ] as const) {
      render(template, { c: value });
      const divs = compat.fixture.container.querySelectorAll('div');
      expect(divs[divs.length - 1]!.getAttribute('class'), String(value)).toBe(expected);
    }
  });

  test('a reactive class is removed and restored', async () => {
    const c = cell<unknown>('on');
    render(compileCompat('<div class={{this.c.value}}></div>'), { c });
    const div = compat.fixture.container.querySelector('div')!;
    expect(div.getAttribute('class')).toBe('on');
    c.update(false);
    await syncDom();
    expect(div.hasAttribute('class')).toBe(false);
    c.update('again');
    await syncDom();
    expect(div.getAttribute('class')).toBe('again');
  });

  test('merged classes follow createClassListRef (empty parts skipped, no attribute when all are empty)', async () => {
    const own = cell<unknown>('own');
    const fw = cell<unknown>(null);
    const Inner = compileCompat('<div class={{@own}} ...attributes></div>');
    render(compileCompat('<Inner class={{this.fw.value}} @own={{this.own.value}} />', { Inner }), {
      own,
      fw,
    });
    const div = compat.fixture.container.querySelector('div')!;
    expect(div.getAttribute('class')).toBe('own');
    own.update(undefined);
    await syncDom();
    expect(div.hasAttribute('class')).toBe(false);
    fw.update('fw');
    own.update('a');
    await syncDom();
    expect(div.getAttribute('class')).toBe('a fw');
  });

  test('an {{#each}} row (static-block fast path) applies its class as an attribute', () => {
    const template = compileCompat(
      '<ul>{{#each this.items as |item|}}<li class={{item.c}}>x</li>{{/each}}</ul>',
    );
    render(template, { items: [{ c: false }, { c: 'y' }, { c: null }] });
    const lis = compat.fixture.container.querySelectorAll('li');
    expect(lis).toHaveLength(3);
    expect(lis[0]!.hasAttribute('class')).toBe(false);
    expect(lis[1]!.getAttribute('class')).toBe('y');
    expect(lis[2]!.hasAttribute('class')).toBe(false);
  });
});
