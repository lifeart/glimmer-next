import { expect, test, describe } from 'vitest';
import { Component } from './component';
import { render } from './ssr/ssr';
import { cell } from './reactive';
import { opcodeFor } from './vm';
import { registerDestructor } from './glimmer/destroyable';
import {
  RENDERED_NODES_PROPERTY,
} from './shared';

describe('SSR destruction does not hang', () => {
  test('reactive revalidation is suppressed during SSR destruction', async () => {
    // This test verifies that takeRenderingControl() prevents
    // scheduleRevalidate() from triggering syncDomSync/Async
    // during destruction.
    //
    // The real-world bug: during SSR destruction, cell.update() calls
    // scheduleRevalidate() which queues syncDomSync/Async as a microtask.
    // That microtask processes opcodes, which can trigger more cell updates,
    // creating a cascade that starves the event loop and prevents I/O-based
    // promises (like dynamic import()) from resolving — causing an infinite hang.
    //
    // The fix (takeRenderingControl) suppresses scheduleRevalidate during
    // destruction. This test detects if the fix is removed by checking
    // whether opcodes are re-evaluated after the destructor runs.

    let opcodeCallCount = 0;
    const state = cell(0, 'ssr-test-cell');

    // Register an opcode for the cell. opcodeFor calls the opcode once
    // immediately during registration, so opcodeCallCount starts at 1.
    // Intentionally NOT cleaning up the opcode — we want it to remain
    // registered so we can detect if syncDomSync re-evaluates it.
    opcodeFor(state, () => {
      opcodeCallCount++;
    });

    expect(opcodeCallCount).toBe(1); // Initial evaluation by opcodeFor

    class TestApp extends Component {
      constructor(args: Record<string, unknown>) {
        super(args);
        // Destructor updates the cell, which would trigger
        // scheduleRevalidate → syncDomSync → opcode re-execution
        // if takeRenderingControl() is not in effect.
        registerDestructor(this, () => {
          state.update(42);
          return Promise.resolve();
        });
      }
      [RENDERED_NODES_PROPERTY] = [];
    }

    const result = await render(TestApp, {}, { url: 'http://localhost/' });

    // Flush any remaining microtasks to ensure syncDomSync would have
    // run if it was scheduled
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(typeof result).toBe('string');
    // With the takeRenderingControl() fix, the opcode should NOT be
    // re-evaluated during destruction. Without the fix,
    // scheduleRevalidate would queue syncDomSync which would run the
    // opcode again, incrementing opcodeCallCount beyond 1.
    expect(opcodeCallCount).toBe(1);
  }, 10_000);
});
