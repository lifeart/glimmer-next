export async function measureRender(
  name: string,
  startMark: string,
  endMark: string,
  render: () => Promise<void> | void,
) {
  // Set up observer before any marks are created
  let observerResolved = false;
  const endObserved = new Promise<void>((resolve) => {
    const observer = new PerformanceObserver((entries) => {
      if (entries.getEntriesByName(endMark, 'mark').length > 0) {
        observerResolved = true;
        resolve();
        observer.disconnect();
      }
    });
    observer.observe({ type: 'mark', buffered: true });
  });

  performance.mark(startMark);

  try {
    await render();
  } finally {
    // Always create endMark even if render throws
    performance.mark(endMark);
  }

  // Wait for observer with timeout fallback
  // If observer already resolved synchronously (buffered marks), skip waiting
  if (!observerResolved) {
    await Promise.race([
      endObserved,
      new Promise<void>((resolve) => setTimeout(resolve, 100)),
    ]);
  }

  performance.measure(name, startMark, endMark);
}
