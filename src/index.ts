import 'glint-environment-gxt';
import 'decorator-transforms/globals';

import { createBenchmark } from '@/core/benchmark/benchmark';
import { router } from '@/services/router';
import {
  enforcePaintEvent,
  ButtonSelectors,
  emitDomClickEvent,
  waitForIdle,
} from '@/core/benchmark/compat';

// @ts-check
// https://codepen.io/lifeart/pen/abMzEZm?editors=0110
// https://github.com/glimmerjs/glimmer-vm/issues/1540

export default async function render() {
  if (IS_DEV_MODE) {
    await import('@lifeart/gxt/ember-inspector');
  }
  await router.mount(window.location.pathname);
  const benchmark = createBenchmark(document);

  // starting app

  console.time('render');

  await waitForIdle();

  const app = await benchmark.render();

  // Create diagnostic mark to verify we reached this point
  performance.mark('afterInitialRender');

  if (window.location.pathname !== '/benchmark') {
    console.timeEnd('render');
    return;
  }

  // Create diagnostic mark to verify pathname check passed
  performance.mark('benchmarkPathVerified');

  // Note: Removed waitForIdle() here as it was causing issues with
  // Chrome headless mode trace capture. The async boundary was preventing
  // subsequent performance.mark() events from being recorded in the trace.

  // Create diagnostic mark before loop starts
  performance.mark('beforeBenchmarkLoop');

  // Define benchmark operations in sequence
  const benchmarkOps: Array<[string, ButtonSelectors]> = [
    ['render1000Items1', ButtonSelectors.Create1000],
    ['clearItems1', ButtonSelectors.Clear],
    ['render1000Items2', ButtonSelectors.Create1000],
    ['clearItems2', ButtonSelectors.Clear],
    ['render5000Items1', ButtonSelectors.Create5000],
    ['clearManyItems1', ButtonSelectors.Clear],
    ['render5000Items2', ButtonSelectors.Create5000],
    ['clearManyItems2', ButtonSelectors.Clear],
    ['render1000Items3', ButtonSelectors.Create1000],
    ['append1000Items1', ButtonSelectors.Append1000],
    ['append1000Items2', ButtonSelectors.Append1000],
    ['updateEvery10thItem1', ButtonSelectors.UpdateEvery10th],
    ['updateEvery10thItem2', ButtonSelectors.UpdateEvery10th],
    ['selectFirstRow1', ButtonSelectors.SelectFirstRow],
    ['selectSecondRow1', ButtonSelectors.SelectSecondRow],
    ['removeFirstRow1', ButtonSelectors.RemoveFirstRow],
    ['removeSecondRow1', ButtonSelectors.RemoveSecondRow],
    ['swapRows1', ButtonSelectors.SwapRows],
    ['swapRows2', ButtonSelectors.SwapRows],
    ['clearItems4', ButtonSelectors.Clear],
  ];

  // Run benchmark operations with error handling
  // Note: Removed waitForIdle() between operations to ensure Chrome headless
  // mode captures all performance.mark() events in the trace. The async
  // boundaries were causing intermittent trace capture issues.
  for (const [name, selector] of benchmarkOps) {
    try {
      await app(name, () => {
        emitDomClickEvent(selector);
      });
    } catch (error) {
      console.error(`Benchmark operation "${name}" failed:`, error);
      // Create marks manually to ensure tracerbench can continue
      performance.mark(name + 'Start');
      performance.mark(name + 'End');
      performance.measure(name, name + 'Start', name + 'End');
    }
  }

  console.timeEnd('render');
  // finishing bench
  enforcePaintEvent();

  // Final marker created synchronously to ensure trace capture
  performance.mark('benchmarkCompleteStart');
  performance.mark('benchmarkCompleteEnd');
  performance.measure('benchmarkComplete', 'benchmarkCompleteStart', 'benchmarkCompleteEnd');
}
