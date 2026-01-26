import { describe, test, expect, beforeEach, vi } from 'vitest';
import { $_style, $_maybeModifier } from './dom';
import {
  cell,
  tagsToRevalidate,
  opsForTag,
  relatedTags,
  setTracker,
  setIsRendering,
} from './reactive';
import { effect } from './vm';
import { syncDom } from './runtime';
import { createTrackedGetter } from './__test-utils__';

beforeEach(() => {
  // Clear reactive state between tests
  tagsToRevalidate.clear();
  opsForTag.clear();
  relatedTags.clear();
  setTracker(null);
  setIsRendering(false);
});

describe('$_style', () => {
  test('unwraps helper args for direct call', () => {
    const setProperty = vi.fn();
    const element = { style: { setProperty } } as unknown as HTMLElement;
    const { getter, getAccessCount } = createTrackedGetter(() => 'red');

    $_style(element, 'color', getter);

    expect(getAccessCount()).toBe(1);
    expect(setProperty).toHaveBeenCalledWith('color', 'red');
  });

  test('accepts pre-unwrapped array args (modifier manager path)', () => {
    const setProperty = vi.fn();
    const element = { style: { setProperty } } as unknown as HTMLElement;

    $_style(element, ['color', 'blue']);

    expect(setProperty).toHaveBeenCalledWith('color', 'blue');
  });

  test('works via $_maybeModifier with unwrapped args', () => {
    const setProperty = vi.fn();
    const element = { style: { setProperty } } as unknown as HTMLElement;
    const { getter, getAccessCount } = createTrackedGetter(() => 'green');

    const modifier = $_maybeModifier(
      $_style,
      element,
      ['color', getter],
      () => ({})
    ) as (el: HTMLElement) => void;

    expect(typeof modifier).toBe('function');
    modifier(element);

    expect(getAccessCount()).toBe(1);
    expect(setProperty).toHaveBeenCalledWith('color', 'green');
  });

  test('re-runs when reactive value changes', async () => {
    const setProperty = vi.fn();
    const element = { style: { setProperty } } as unknown as HTMLElement;
    const color = cell('red');

    const destroy = effect(() => {
      $_style(element, 'color', color);
    });

    expect(setProperty).toHaveBeenLastCalledWith('color', 'red');

    color.update('blue');
    await syncDom();

    expect(setProperty).toHaveBeenLastCalledWith('color', 'blue');

    destroy();
  });
});
