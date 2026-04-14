import { describe, test, expect, vi } from 'vitest';
import { render } from './ssr';
import {
  defaultHappyDomProvider,
  type SsrDomProvider,
} from './dom-provider';
import { Component } from '../component';
import { RENDERED_NODES_PROPERTY } from '../shared';

/**
 * Minimal component that renders a single <div>Hello</div>.
 * Using a bare `Component` subclass keeps this test independent of
 * the .gts template compiler pipeline.
 */
class HelloApp extends Component {
  [RENDERED_NODES_PROPERTY] = [];
}

describe('ssr dom-provider factory', () => {
  test('default provider path — render() without domProvider works and returns a string', async () => {
    // Render without supplying a provider — should fall back to
    // happy-dom exactly as before.
    const html = await render(HelloApp, {}, { url: 'http://localhost/' });
    expect(typeof html).toBe('string');
  });

  test('custom provider path — render() uses the injected provider', async () => {
    // Wrap happy-dom in a spy so we can confirm the injected provider
    // is actually the one used (rather than the default path).
    const base = await defaultHappyDomProvider();
    const createDocument = vi.fn((opts: { url: string }) => {
      const inst = base.createDocument(opts);
      // Wrap dispose so we can observe it below if needed.
      return inst;
    });
    const customProvider: SsrDomProvider = { createDocument };

    const html = await render(
      HelloApp,
      {},
      { url: 'http://localhost/custom', domProvider: customProvider },
    );

    expect(typeof html).toBe('string');
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(createDocument).toHaveBeenCalledWith({
      url: 'http://localhost/custom',
    });
  });

  test('dispose() is called exactly once on render completion', async () => {
    const base = await defaultHappyDomProvider();
    const dispose = vi.fn();
    const customProvider: SsrDomProvider = {
      createDocument(opts) {
        const inst = base.createDocument(opts);
        const originalDispose = inst.dispose.bind(inst);
        return {
          ...inst,
          dispose: () => {
            dispose();
            originalDispose();
          },
        };
      },
    };

    await render(
      HelloApp,
      {},
      { url: 'http://localhost/dispose', domProvider: customProvider },
    );

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
