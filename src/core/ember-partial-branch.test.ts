/**
 * Ember compat: an `{{#if}}` branch that throws while it renders keeps the
 * elements it rendered before the error.
 *
 * Glimmer appends a block's nodes as it renders them, so when a component of
 * a new branch throws in its constructor, the nodes rendered before it stay
 * in the DOM in front of the block's placeholder, and they are removed with
 * the block. `IfCondition.renderState` built the whole branch first and
 * inserted it only after it returned: a throw left only the placeholder.
 *
 * Gated to Ember compat (WITH_EMBER_INTEGRATION without EMBER_NATIVE). Errors
 * propagate there (TRY_CATCH_ERROR_HANDLING is off).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';
import { cell } from './reactive';
import { syncDom, takeRenderingControl } from './runtime';

type RuntimeConstants = { TRY_CATCH_ERROR_HANDLING: boolean };
const runtime = globalThis as unknown as RuntimeConstants;

function Foo() {
  throw new Error('something went wrong!');
}

async function syncError(): Promise<unknown> {
  try {
    await syncDom();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('Ember compat: a branch that throws keeps what it rendered before the error', () => {
  const compat = useEmberCompatRuntime();
  let release: () => void;
  let saved: boolean;
  beforeEach(() => {
    saved = runtime.TRY_CATCH_ERROR_HANDLING;
    runtime.TRY_CATCH_ERROR_HANDLING = false;
    release = takeRenderingControl();
  });
  afterEach(() => {
    release();
    runtime.TRY_CATCH_ERROR_HANDLING = saved;
  });
  // The vitest DOM marks each element with a `data-node-id` attribute.
  const html = () => compat.fixture.container.innerHTML.replace(/ data-node-id="\d+"/g, '');

  test('the elements before a component that throws stay, in front of the placeholder', async () => {
    const show = cell(false);
    compat.render(
      compileCompat('{{#if this.show.value}}<div class="first"></div><div class="second"></div><Foo/>{{/if}}', { Foo }),
      { show },
    );
    const placeholder = html();
    show.update(true);
    expect(String(await syncError())).toContain('something went wrong!');
    expect(html()).toBe(`<div class="first"></div><div class="second"></div>${placeholder}`);
  });

  test("a nested component's elements before the error stay", async () => {
    const Bar = compileCompat('<div class="second"><span>x</span></div><Foo/>', { Foo });
    const show = cell(false);
    compat.render(compileCompat('{{#if this.show.value}}<div class="first"></div><Bar/>{{/if}}', { Bar }), { show });
    const placeholder = html();
    show.update(true);
    expect(String(await syncError())).toContain('something went wrong!');
    expect(html()).toBe(`<div class="first"></div><div class="second"><span>x</span></div>${placeholder}`);
  });

  test('the kept elements are removed with the branch', async () => {
    const show = cell(false);
    compat.render(compileCompat('{{#if this.show.value}}<div class="first"></div><Foo/>{{/if}}', { Foo }), { show });
    const placeholder = html();
    show.update(true);
    await syncError();
    expect(html()).toBe(`<div class="first"></div>${placeholder}`);
    show.update(false);
    expect(await syncError()).toBe(undefined);
    expect(html()).toBe(placeholder);
  });

  test('a branch that renders is unchanged (guard)', async () => {
    const show = cell(false);
    compat.render(compileCompat('{{#if this.show.value}}<div class="first"></div><p>ok</p>{{/if}}'), { show });
    const placeholder = html();
    show.update(true);
    expect(await syncError()).toBe(undefined);
    expect(html()).toBe(`<div class="first"></div><p>ok</p>${placeholder}`);
    show.update(false);
    expect(await syncError()).toBe(undefined);
    expect(html()).toBe(placeholder);
  });
});
