/**
 * Unit + integration tests for `$_dc`'s manager fw derivation.
 *
 * When a dynamic tag with DIRECT attributes (`<param.prop class="x" @arg={{y}}
 * {{on "click" z}} />`, compiled to `<this.$_bp0.prop ...>`) resolves to a
 * HOST-MANAGER-claimed component, the compiler dumps EVERY attribute — props,
 * attrs AND `@`-args — into the invocation's own props tuple `args[$PROPS_SYMBOL]`
 * (it treats the dynamic tag as an element). `$_dc` re-derives the split a static
 * invocation would have produced: `@`-entries become component args, class/attrs
 * become forwarded splat, ''/`class` props get the null/false → '' guard. The
 * split semantics replicate ember.js' `$_dc_splatfix` compile.ts wrapper exactly
 * so that wrapper can be retired.
 *
 * The dom.ts call site is gated on `WITH_EMBER_INTEGRATION`, which vitest defines
 * `false` (the branch is DCE'd here — see host-attr-normalize.test.ts /
 * managers.test.ts for the same precedent). So the split is verified through the
 * EXPORTED pure functions, plus an integration test pinning that a standalone
 * (flag-off) build never consults the component manager from `$_dc`.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from './component';
import { RENDERED_NODES_PROPERTY, addToTree, $template } from './shared';
import {
  $_dc,
  $_args,
  $PROPS_SYMBOL,
  hasDynamicSplatProps,
  deriveManagerFwFromPropsTuple,
  applyDynamicManagerFwSplit,
} from './dom';
import { $_MANAGERS } from './manager-integration';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { cell } from './reactive';
import { renderElement } from './render-core';
import {
  template,
  setupGlobalScope,
  GXT_RUNTIME_SYMBOLS,
} from '../../plugins/runtime-compiler';

describe('$_dc manager fw derivation', () => {
  // ---------------------------------------------------------------------------
  // (a) hasDynamicSplatProps — the ember `hasSplatProps` predicate
  // ---------------------------------------------------------------------------
  describe('(a) hasDynamicSplatProps predicate', () => {
    test('true when tuple[0] props are present', () => {
      expect(hasDynamicSplatProps([[['class', 'x']], [], []])).toBe(true);
    });
    test('true when tuple[1] has a NON-@ attr', () => {
      expect(hasDynamicSplatProps([[], [['id', 'y']], []])).toBe(true);
    });
    test('false when tuple[1] carries only @-args (matches ember: no intervention)', () => {
      expect(hasDynamicSplatProps([[], [['@name', () => 'n']], []])).toBe(false);
    });
    test('false for events-only tuples (events pass through the base path unchanged)', () => {
      expect(hasDynamicSplatProps([[], [], [['click', () => {}]]])).toBe(false);
    });
    test('false for empty / non-array tuples', () => {
      expect(hasDynamicSplatProps([[], [], []])).toBe(false);
      expect(hasDynamicSplatProps(undefined)).toBe(false);
      expect(hasDynamicSplatProps(null)).toBe(false);
      expect(hasDynamicSplatProps('nope')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // (b) deriveManagerFwFromPropsTuple — the split
  // ---------------------------------------------------------------------------
  describe('(b) deriveManagerFwFromPropsTuple split', () => {
    test('produces a [props, attrs, events] fw + arg entries', () => {
      const onClick = () => {};
      const { fw, argEntries } = deriveManagerFwFromPropsTuple([
        [['id', 'x']],
        [
          ['data-foo', 'bar'],
          ['@name', () => 'Nina'],
        ],
        [['click', onClick]],
      ]);
      // props: passed through (id is neither '' nor class)
      expect(fw[0]).toEqual([['id', 'x']]);
      // attrs: @-entry filtered out, data-foo kept
      expect(fw[1]).toEqual([['data-foo', 'bar']]);
      // events: unchanged
      expect(fw[2]).toEqual([['click', onClick]]);
      // @-entry became an arg getter (unwrapped)
      expect(argEntries.length).toBe(1);
      expect(argEntries[0][0]).toBe('name');
      expect(argEntries[0][1]()).toBe('Nina');
    });

    test("''/class props get the null/false → '' nullish guard (function values)", () => {
      const clsCell = cell<string | null | false>('c1');
      const { fw } = deriveManagerFwFromPropsTuple([
        [['class', () => clsCell.value]],
        [],
        [],
      ]);
      const wrapped = fw[0][0][1] as () => unknown;
      expect(typeof wrapped).toBe('function');
      expect(wrapped()).toBe('c1');
      // reactivity preserved: the wrapper reads the live cell by reference
      clsCell.update('c2');
      expect(wrapped()).toBe('c2');
      // null / false collapse to ''
      clsCell.update(null);
      expect(wrapped()).toBe('');
      clsCell.update(false);
      expect(wrapped()).toBe('');
    });

    test("''/class props get the guard for raw (non-function) values too", () => {
      const { fw } = deriveManagerFwFromPropsTuple([
        [
          ['class', null as any],
          ['', false as any],
          ['', 'keep'],
        ],
        [],
        [],
      ]);
      expect(fw[0]).toEqual([
        ['class', ''],
        ['', ''],
        ['', 'keep'],
      ]);
    });

    test('@-arg getter unwraps function values but passes raw values through', () => {
      const { argEntries } = deriveManagerFwFromPropsTuple([
        [],
        [
          ['@fnArg', () => 42],
          ['@rawArg', 'plain'],
        ],
        [],
      ]);
      const byName = Object.fromEntries(argEntries);
      expect(byName['fnArg']()).toBe(42);
      expect(byName['rawArg']()).toBe('plain');
    });

    test('preserves enclosing-first ordering when fed a merged tuple (#241 + own)', () => {
      // mergeForwardedProps (unchanged) prepends the enclosing component's fw:
      // `[...$fw[0], ...ownProps]`. The split must preserve that order.
      const enclosing = [['data-enclosing', 'e']];
      const own = [['data-own', 'o']];
      const { fw } = deriveManagerFwFromPropsTuple([
        [],
        [...enclosing, ...own] as any,
        [],
      ]);
      expect(fw[1]).toEqual([
        ['data-enclosing', 'e'],
        ['data-own', 'o'],
      ]);
    });

    test('tolerates empty / malformed tuples', () => {
      expect(deriveManagerFwFromPropsTuple(undefined).fw).toEqual([[], [], []]);
      expect(deriveManagerFwFromPropsTuple(null).fw).toEqual([[], [], []]);
      const { fw, argEntries } = deriveManagerFwFromPropsTuple([
        ['not-an-entry' as any],
        [null as any],
        ['x' as any],
      ]);
      expect(fw).toEqual([[], [], []]);
      expect(argEntries).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // (c) applyDynamicManagerFwSplit — mutation of the live args object
  // ---------------------------------------------------------------------------
  describe('(c) applyDynamicManagerFwSplit', () => {
    test('exposes @-args as enumerable getters and rethreads $PROPS_SYMBOL to the split fw', () => {
      const nameCell = cell('Nina');
      const args: Record<string, unknown> = {};
      Object.defineProperty(args, $PROPS_SYMBOL, {
        value: [
          [['class', 'c']],
          [
            ['id', 'the-id'],
            ['@name', () => nameCell.value],
          ],
          [],
        ],
        enumerable: false,
        configurable: true,
        writable: true,
      });

      const fw = applyDynamicManagerFwSplit(
        args,
        (args as any)[$PROPS_SYMBOL],
      );

      // @-arg landed as an enumerable getter, unwrapped + reactive
      expect(Object.keys(args)).toContain('name');
      expect((args as any).name).toBe('Nina');
      nameCell.update('Max');
      expect((args as any).name).toBe('Max');

      // $PROPS_SYMBOL now holds the split fw: @-entry stripped from attrs
      const stored = (args as any)[$PROPS_SYMBOL];
      expect(stored).toBe(fw);
      expect(stored[0]).toEqual([['class', 'c']]);
      expect(stored[1]).toEqual([['id', 'the-id']]);
    });

    test('is idempotent enough to re-run without corrupting the args (swap safety)', () => {
      const args: Record<string, unknown> = {};
      const tuple = [[['class', 'c']], [['@name', () => 'n']], []];
      Object.defineProperty(args, $PROPS_SYMBOL, {
        value: tuple,
        enumerable: false,
        configurable: true,
        writable: true,
      });
      const fw1 = applyDynamicManagerFwSplit(args, (args as any)[$PROPS_SYMBOL]);
      // A second application over the already-split tuple keeps `name` and does
      // not resurrect the @-entry as an attr.
      const fw2 = applyDynamicManagerFwSplit(args, (args as any)[$PROPS_SYMBOL]);
      expect((args as any).name).toBe('n');
      expect(fw1[1]).toEqual([]);
      expect(fw2[1]).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // (d) WITH_EMBER_INTEGRATION gate pin: standalone builds never consult the
  //     component manager from $_dc (the split branch is DCE'd; the base path
  //     applies the raw props tuple exactly as before).
  // ---------------------------------------------------------------------------
  describe('(d) WITH_EMBER_INTEGRATION gate pin', () => {
    let fixture: DOMFixture;
    let savedCanHandle: typeof $_MANAGERS.component.canHandle;
    let savedHandle: typeof $_MANAGERS.component.handle;

    beforeEach(() => {
      fixture = createDOMFixture();
      setupGlobalScope();
      const g = globalThis as any;
      Object.entries(GXT_RUNTIME_SYMBOLS).forEach(([name, value]) => {
        g[name] = value;
      });
      savedCanHandle = $_MANAGERS.component.canHandle;
      savedHandle = $_MANAGERS.component.handle;
    });

    afterEach(() => {
      $_MANAGERS.component.canHandle = savedCanHandle;
      $_MANAGERS.component.handle = savedHandle;
      fixture.cleanup();
    });

    test('a registered component manager is NOT consulted by $_dc; the raw props tuple still applies via the base path', () => {
      let canHandleCalls = 0;
      let handleCalls = 0;
      // A manager that WOULD claim everything (so if the gate were open it would
      // intercept and the split would run).
      $_MANAGERS.component.canHandle = () => {
        canHandleCalls++;
        return true;
      };
      $_MANAGERS.component.handle = () => {
        handleCalls++;
        return undefined;
      };

      class Inner extends Component {
        [$template] = template('<div ...attributes>inner</div>');
      }

      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, parent);

      // Direct-attr props tuple that hasDynamicSplatProps() would flag (a non-@
      // attr present) — the split would fire IF WITH_EMBER_INTEGRATION were on.
      const propsTuple = [[], [['data-foo', 'bar']], []];
      const args = $_args({}, false, propsTuple as any);
      const instance = $_dc((() => Inner) as any, args, parent);
      renderElement(fixture.api, parent, fixture.container, instance as any);

      // Flag is off → the component manager was never consulted from $_dc.
      expect(canHandleCalls).toBe(0);
      expect(handleCalls).toBe(0);

      // ...and the base path still forwarded the raw tuple attr to the element.
      const div = fixture.container.querySelector('div')!;
      expect(div).toBeTruthy();
      expect(div.getAttribute('data-foo')).toBe('bar');
      expect(div.textContent).toBe('inner');
    });
  });

  // ---------------------------------------------------------------------------
  // (e) Yielded-contextual "splattributes" MERGE contract.
  //
  // This pins the DOM-level behavior the ember bridge's manager path relies on
  // when it forwards the derived split `fw` to a resolved (tagless) component's
  // `...attributes` — the `<x.foo class="…" title="…" />` yielded-contextual
  // case (ember `AngleBracket Invocation` "…in yielded contextual component"
  // tests). The split MUST keep `class` under the empty-string className-modifier
  // key so it MERGES with the child element's own default class (rather than
  // overwriting it), and non-`@` attrs must trump the child's defaults.
  //
  // We drive the split exactly as $_dc's WITH_EMBER_INTEGRATION branch does
  // (applyDynamicManagerFwSplit over the invocation's own props tuple), then
  // render a child whose template carries a default class + `...attributes`, via
  // the base $_dc path (WITH_EMBER_INTEGRATION is off in vitest, so the base path
  // applies args[$PROPS_SYMBOL] — the split fw — as the child's splat, which is
  // structurally identical to what the ember manager threads to the child).
  // ---------------------------------------------------------------------------
  describe('(e) yielded-contextual splattributes MERGE contract', () => {
    let fixture: DOMFixture;
    beforeEach(() => {
      fixture = createDOMFixture();
      setupGlobalScope();
      const g = globalThis as any;
      Object.entries(GXT_RUNTIME_SYMBOLS).forEach(([name, value]) => {
        g[name] = value;
      });
    });
    afterEach(() => fixture.cleanup());

    function renderThroughSplit(childTpl: string, ownTuple: any) {
      class Inner extends Component {
        [$template] = template(childTpl);
      }
      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, parent);
      const args = $_args({}, {} as any, ownTuple as any);
      // The split $_dc runs the first time it resolves to a manager-claimed value.
      applyDynamicManagerFwSplit(args, (args as any)[$PROPS_SYMBOL]);
      const instance = $_dc((() => Inner) as any, args, parent);
      renderElement(fixture.api, parent, fixture.container, instance as any);
      return fixture.container.querySelector('div')!;
    }

    // Note: gxt compiles a component-tag `class="…"` into the props tuple under
    // the empty-string className-modifier key `['', value]` (see
    // serializers/element.ts), NOT the literal `'class'` key — that is what lets
    // it MERGE on the child's `...attributes` rather than overwrite.
    const CLASS: any = [[['', 'custom-class']], [['title', 'foo']], []];

    test('leading default class: `<div class="default" ...attributes>` merges custom + default', () => {
      const div = renderThroughSplit(
        '<div class="default-class" ...attributes>hello</div>',
        CLASS,
      );
      const cls = (div.getAttribute('class') || '').split(/\s+/).filter(Boolean).sort();
      expect(cls).toEqual(['custom-class', 'default-class']);
      expect(div.getAttribute('title')).toBe('foo');
      expect(div.textContent).toBe('hello');
    });

    test('trailing default class: `<div ...attributes class="default">` merges custom + default', () => {
      const div = renderThroughSplit(
        '<div ...attributes class="default-class">hello</div>',
        CLASS,
      );
      const cls = (div.getAttribute('class') || '').split(/\s+/).filter(Boolean).sort();
      expect(cls).toEqual(['custom-class', 'default-class']);
    });

    test('invocation attribute trumps the element default (`title`)', () => {
      const div = renderThroughSplit('<div title="bar" ...attributes>hello</div>', [
        [],
        [['title', 'foo']],
        [],
      ]);
      expect(div.getAttribute('title')).toBe('foo');
    });
  });
});
