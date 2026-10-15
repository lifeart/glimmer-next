import { describe, test, expect } from 'vitest';
import { splatLocalPlan, SPLAT_LOCAL_MARKER } from './splat-local';

// `_DOM` consumes the plan under the EMBER_NATIVE / WITH_EMBER_INTEGRATION runtime
// constants (ember-compat-splat.test.ts covers compat; folded to
// false in this suite); the Ember native layer's QUnit modules cover the wiring
// end to end (LinkTo `href` after `...attributes`, class order).
describe('splatLocalPlan (EMBER_NATIVE `...attributes` precedence)', () => {
  const href = () => '/about';

  test('no marker: no plan (forwarded attributes win, local classes first)', () => {
    expect(splatLocalPlan([['', 'x']], [['id', 'a']])).toBe(undefined);
    expect(splatLocalPlan([], [])).toBe(undefined);
  });

  test('a marker in the props tuple claims the listed LOCAL attributes', () => {
    const plan = splatLocalPlan(
      [
        ['', () => 'ember-view'],
        ['rel', 'nofollow'],
        [SPLAT_LOCAL_MARKER, 'href'],
      ],
      [
        ['id', 'x'],
        ['href', href],
      ],
    )!;
    expect(plan.attrs).toEqual([['href', href]]);
    expect(plan.props).toEqual([]);
    expect(plan.keys).toEqual([SPLAT_LOCAL_MARKER, 'href', 'href']);
    expect(plan.classAfterSplat).toBe(false);
  });

  test('a marker in the attrs tuple; several names; property keys match case-insensitively', () => {
    const plan = splatLocalPlan(
      [['tabIndex', '3']],
      [
        ['title', 't'],
        ['data-x', 'local'],
        [SPLAT_LOCAL_MARKER, 'data-x,tabindex'],
      ],
    )!;
    expect(plan.attrs).toEqual([['data-x', 'local']]);
    expect(plan.props).toEqual([['tabIndex', '3']]);
    // the source name AND the emitted key are claimed (a forwarded `tabindex`
    // attribute must not override the local `tabIndex` property)
    expect(plan.keys).toEqual([SPLAT_LOCAL_MARKER, 'data-x', 'data-x', 'tabindex', 'tabIndex']);
  });

  test('`__class__` marks a class after the splat; classes are never claimed', () => {
    const plan = splatLocalPlan([['', 'local']], [[SPLAT_LOCAL_MARKER, '__class__']])!;
    expect(plan.classAfterSplat).toBe(true);
    expect(plan.props).toEqual([]);
    expect(plan.attrs).toEqual([]);
    expect(plan.keys).toEqual([SPLAT_LOCAL_MARKER]);
  });

  test('a reactive marker value is read once', () => {
    let reads = 0;
    const plan = splatLocalPlan(
      [[SPLAT_LOCAL_MARKER, () => (reads++, 'role')]],
      [['role', 'menu']],
    )!;
    expect(reads).toBe(1);
    expect(plan.attrs).toEqual([['role', 'menu']]);
  });
});
