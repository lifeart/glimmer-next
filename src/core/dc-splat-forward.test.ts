/**
 * Runtime tests: a dynamic component (`$_dc`) in splat context forwards the
 * enclosing component's `...attributes` (`$fw`) to the resolved component.
 *
 * The compiler emits `$fw` as a dedicated 4th `$_dc` argument for splat dynamic
 * components; `$_dc` threads it into the resolved component the same way a
 * statically-invoked component receives forwarded props. See
 * `plugins/compiler/serializers/element.ts` (emission) and `src/core/dom.ts`
 * (`$_dc` / `mergeForwardedProps`).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from './component';
import { RENDERED_NODES_PROPERTY, addToTree, $template } from './shared';
import { $_c, $_args, $_edp } from './dom';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { cell } from './reactive';
import { renderElement } from './render-core';
import {
  template,
  setupGlobalScope,
  GXT_RUNTIME_SYMBOLS,
  type TemplateOptions,
} from '../../plugins/runtime-compiler';

describe('Dynamic component splat forwarding ($_dc + $fw)', () => {
  let fixture: DOMFixture;

  function render<T = any>(
    componentOrTemplate: T | string,
    componentArgs: Record<string, unknown> = {},
    options?: TemplateOptions
  ) {
    const component =
      typeof componentOrTemplate === 'string'
        ? template(componentOrTemplate, options)
        : componentOrTemplate;
    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, parent);
    const args = $_args(componentArgs, false, $_edp as any);
    const instance = $_c(component as any, args, parent);
    renderElement(fixture.api, parent, fixture.container, instance);
    return instance;
  }

  beforeEach(() => {
    fixture = createDOMFixture();
    setupGlobalScope();
    const g = globalThis as any;
    Object.entries(GXT_RUNTIME_SYMBOLS).forEach(([name, value]) => {
      g[name] = value;
    });
  });

  afterEach(() => {
    fixture.cleanup();
  });

  // (a) `<this.X ...attributes />` forwards the parent's splat attrs onto the
  // resolved component's root element.
  test('forwards static splat attributes to the resolved component', () => {
    class Inner extends Component {
      [$template] = template('<div ...attributes>inner</div>');
    }
    class Wrapper extends Component {
      Inner = Inner;
      [$template] = template('<this.Inner ...attributes />');
    }

    render('<Wrapper data-test-x class="c1" />', {}, { scope: { Wrapper } });

    const div = fixture.container.querySelector('div')!;
    expect(div).toBeTruthy();
    expect(div.getAttribute('data-test-x')).toBe('');
    expect(div.getAttribute('class')).toBe('c1');
    expect(div.textContent).toBe('inner');
  });

  // (b) A reactive forwarded attribute updates propagate through the dynamic
  // component to the resolved component's element.
  test('reactive splat updates propagate through the dynamic component', async () => {
    const klass = cell('c1');
    class Inner extends Component {
      [$template] = template('<div ...attributes>inner</div>');
    }
    class Wrapper extends Component {
      Inner = Inner;
      [$template] = template('<this.Inner ...attributes />');
    }
    class App extends Component {
      Wrapper = Wrapper;
      get k() {
        return klass.value;
      }
      [$template] = template('<this.Wrapper class={{this.k}} />');
    }

    render(App);
    let div = fixture.container.querySelector('div')!;
    expect(div.getAttribute('class')).toBe('c1');

    klass.update('c2');
    await new Promise((resolve) => setTimeout(resolve, 50));

    div = fixture.container.querySelector('div')!;
    expect(div.getAttribute('class')).toBe('c2');
  });

  // (d) When the resolved component swaps (X changes), the forwarded attrs —
  // static and reactive — are reapplied to the new instance's root element.
  test('reapplies forwarded attributes across a component swap', async () => {
    const klass = cell('c1');
    const which = cell<any>(null);
    class InnerA extends Component {
      [$template] = template('<div ...attributes>a</div>');
    }
    class InnerB extends Component {
      [$template] = template('<section ...attributes>b</section>');
    }
    which.update(InnerA);
    class Wrapper extends Component {
      get Cmp() {
        return which.value;
      }
      [$template] = template('<this.Cmp ...attributes />');
    }
    class App extends Component {
      Wrapper = Wrapper;
      get k() {
        return klass.value;
      }
      [$template] = template('<this.Wrapper class={{this.k}} data-x="y" />');
    }

    render(App);
    let el = fixture.container.querySelector('div')!;
    expect(el.tagName.toLowerCase()).toBe('div');
    expect(el.getAttribute('data-x')).toBe('y');
    expect(el.getAttribute('class')).toBe('c1');

    // Update a reactive forwarded attr, then swap the resolved component.
    klass.update('c2');
    await new Promise((resolve) => setTimeout(resolve, 50));
    which.update(InnerB);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const section = fixture.container.querySelector('section')!;
    expect(section).toBeTruthy();
    // The new instance's root receives the static forwarded attr...
    expect(section.getAttribute('data-x')).toBe('y');
    // ...and the current value of the reactive forwarded attr.
    expect(section.getAttribute('class')).toBe('c2');
    expect(section.textContent).toBe('b');
  });
});
