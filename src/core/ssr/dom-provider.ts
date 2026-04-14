/**
 * DOM provider factory for SSR.
 *
 * GXT's SSR entry historically bound itself to happy-dom via a hard dynamic
 * import. That makes it impossible for a host environment — e.g. Ember's
 * FastBoot, which uses SimpleDOM — to reuse GXT's SSR pipeline with a
 * different DOM implementation.
 *
 * This module introduces a small factory interface so the host can inject
 * their own DOM. When no provider is supplied, `defaultHappyDomProvider`
 * is used and behavior is identical to before.
 */

export interface SsrDomInstance {
  /** The DOM window object (or window-like). */
  window: any;
  /** The document created by the provider. */
  document: any;
  /**
   * An `XMLSerializer` constructor compatible with the provider's nodes.
   * `ssr.ts` uses this to serialize rendered children to HTML.
   */
  XMLSerializer: { new (): { serializeToString(node: any): string } };
  /**
   * Release any resources held by the provider (e.g. happy-dom's
   * `cancelAsync` + `close`). Called unconditionally after render.
   */
  dispose(): void;
}

export interface SsrDomProvider {
  createDocument(options: { url: string }): SsrDomInstance;
}

/**
 * Default provider — lazily imports happy-dom and preserves the exact
 * shutdown semantics of the previous inline implementation
 * (`win.happyDOM.cancelAsync(); win.close();`).
 */
export async function defaultHappyDomProvider(): Promise<SsrDomProvider> {
  const { Window, XMLSerializer } = await import('happy-dom');
  return {
    createDocument({ url }: { url: string }): SsrDomInstance {
      const win = new Window({ url });
      return {
        window: win,
        document: win.document,
        XMLSerializer: XMLSerializer as unknown as SsrDomInstance['XMLSerializer'],
        dispose() {
          // Match prior behavior exactly: cancel pending async work
          // then close the window. Errors propagate so upgrade-time
          // breakage is visible rather than silently swallowed.
          win.happyDOM.cancelAsync();
          win.close();
        },
      };
    },
  };
}
