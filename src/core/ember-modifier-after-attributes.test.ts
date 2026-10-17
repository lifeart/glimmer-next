/**
 * Ember (compat and native): an element's modifiers are installed after its
 * attributes, properties and classes are set.
 *
 * Glimmer applies an element's attributes (static and dynamic, `...attributes`
 * included, `type` last) before it installs the element's modifiers, so a
 * modifier sees the element as the template describes it, and a modifier's own
 * write to an attribute the template also sets is the one that stays. gxt's
 * `_DOM` ran the element's events (its modifiers among them) before its
 * attributes: a modifier saw no `class` and no `data-*` attribute, and a static
 * attribute overwrote what the modifier wrote. Standalone gxt keeps its order.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
// The compat test runtime (and with it the main entry) first: vite-node
// populates `export *` namespaces in import order (see
// plugins/__tests__/template-source.test.ts).
import { compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';
import { cell } from './reactive';
import { $_MANAGERS } from './manager-integration';

// The Ember compat modifier manager installs a modifier while gxt creates the
// element (from the element's ON_CREATED entry); here a modifier is a function
// of the element, installed the same way.
const MODIFIERS = new WeakSet<object>();
function modifier<T extends (element: HTMLElement) => void>(install: T): T {
  MODIFIERS.add(install);
  return install;
}

interface Seen {
  className: string;
  ok: string | null;
  value?: string;
}

function recorder() {
  const seen: Seen[] = [];
  const mod = modifier((element: HTMLElement) => {
    seen.push({
      className: element.className,
      ok: element.getAttribute('data-ok'),
      value: (element as HTMLInputElement).value,
    });
  });
  return { seen, mod };
}

let saved: typeof $_MANAGERS.modifier;

function installModifierManager() {
  saved = { ...$_MANAGERS.modifier };
  $_MANAGERS.modifier.canHandle = (value: unknown) =>
    typeof value === 'function' && MODIFIERS.has(value);
  $_MANAGERS.modifier.handle = ((install: (element: HTMLElement) => void, element: HTMLElement) => {
    install(element);
    return undefined;
  }) as unknown as typeof $_MANAGERS.modifier.handle;
}

function restoreModifierManager() {
  $_MANAGERS.modifier.canHandle = saved.canHandle;
  $_MANAGERS.modifier.handle = saved.handle;
}

describe('Ember compat: modifiers are installed after the element attributes', () => {
  const compat = useEmberCompatRuntime();
  beforeEach(installModifierManager);
  afterEach(restoreModifierManager);

  test('a modifier sees a static attribute and a bound class', () => {
    const { seen, mod } = recorder();
    const cls = cell('foo-bar');
    compat.render(
      compileCompat('<div class={{cls.value}} data-ok="true" {{mod}}></div>', { cls, mod }),
    );
    expect(seen).toEqual([{ className: 'foo-bar', ok: 'true', value: undefined }]);
  });

  test('a modifier sees a bound attribute', () => {
    const { seen, mod } = recorder();
    const ok = cell('yes');
    compat.render(compileCompat('<div data-ok={{ok.value}} {{mod}}></div>', { ok, mod }));
    expect(seen).toEqual([{ className: '', ok: 'yes', value: undefined }]);
  });

  test('a modifier sees the value of an input whose type is set last', () => {
    const { seen, mod } = recorder();
    compat.render(
      compileCompat('<input type="range" min="0" max="1000" value="500" {{mod}}>', { mod }),
    );
    expect(seen.map((entry) => entry.value)).toEqual(['500']);
  });

  test('what a modifier writes to an attribute the template sets stays', () => {
    const title = modifier((element: HTMLElement) => {
      element.setAttribute('title', 'from the modifier');
    });
    compat.render(compileCompat('<div title="from the template" {{title}}></div>', { title }));
    expect(compat.fixture.container.querySelector('div')!.getAttribute('title')).toBe(
      'from the modifier',
    );
  });
});

describe('standalone gxt: an element runs its modifiers before its attributes', () => {
  const runtime = globalThis as unknown as { WITH_EMBER_INTEGRATION: boolean };
  const compat = useEmberCompatRuntime();
  // After the compat runtime's own `beforeEach` (registered first), which
  // restores the constant after the test.
  beforeEach(() => {
    runtime.WITH_EMBER_INTEGRATION = false;
  });

  test('the historic order is kept', () => {
    const { seen, mod } = recorder();
    // Without WITH_MODIFIER_MANAGER a modifier is called with the element.
    compat.render(
      compileCompat(
        '<div class="foo-bar" data-ok="true" {{mod}}></div>',
        { mod },
        { WITH_EMBER_INTEGRATION: false, WITH_MODIFIER_MANAGER: false },
      ),
    );
    expect(seen).toEqual([{ className: '', ok: null, value: undefined }]);
  });
});
