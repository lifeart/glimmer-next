/**
 * Glimmer compat mode: the Ember compat manager renders some components on the
 * spot (Ember's template-only components) and its handle() returns their DOM,
 * a node or an array of nodes, instead of a rendering closure. `$_c` (and
 * `$_outlet`, through the same component path) takes that DOM as the
 * component's output; constructing it threw `… is not a function`.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
// The compat test runtime (and with it the main entry) first: vite-node
// populates `export *` namespaces in import order (see
// plugins/__tests__/template-source.test.ts).
import { compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';
import { $_MANAGERS } from './manager-integration';

describe('compat: a component the manager rendered on the spot', () => {
  const compat = useEmberCompatRuntime();
  const Fragment = { kind: 'renders a fragment' };
  const Nodes = { kind: 'renders an array of nodes' };
  let saved: typeof $_MANAGERS.component;

  beforeEach(() => {
    saved = { ...$_MANAGERS.component };
    $_MANAGERS.component.canHandle = (value: unknown) => value === Fragment || value === Nodes;
    $_MANAGERS.component.handle = ((value: unknown) => {
      // The fixture's document (its own window): a node is told by its
      // `nodeType`, not by a global `Node`.
      const document = compat.fixture.document;
      const p = document.createElement('p');
      p.textContent = 'rendered';
      if (value === Nodes) return [p, document.createTextNode('!')];
      const fragment = document.createDocumentFragment();
      fragment.appendChild(p);
      return fragment;
    }) as unknown as typeof $_MANAGERS.component.handle;
  });

  afterEach(() => {
    $_MANAGERS.component.canHandle = saved.canHandle;
    $_MANAGERS.component.handle = saved.handle;
  });

  test('a fragment is the output, inside an element', () => {
    compat.render(compileCompat('<div><Wrapped /></div>', { Wrapped: Fragment }));
    expect(compat.fixture.container.querySelector('div')!.innerHTML).toBe('<p>rendered</p>');
  });

  test('a fragment is the output, at the top level of a template', () => {
    compat.render(compileCompat('[<Wrapped />]', { Wrapped: Fragment }));
    expect(compat.fixture.container.textContent).toBe('[rendered]');
  });

  test('an array of nodes is the output', () => {
    compat.render(compileCompat('<div><Wrapped /></div>', { Wrapped: Nodes }));
    expect(compat.fixture.container.querySelector('div')!.textContent).toBe('rendered!');
  });
});
