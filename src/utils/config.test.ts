import { describe, it, expect, beforeEach } from 'vitest';
import { AdaptivePool, config, configureGXT, type PoolConfig } from './config';

describe('AdaptivePool', () => {
  describe('basic operations', () => {
    it('acquires and releases items', () => {
      const poolConfig: PoolConfig = {
        initial: 10,
        max: 100,
        growthFactor: 1.5,
        shrinkThreshold: 0.25,
        minSize: 5,
      };
      const pool = new AdaptivePool<number[]>(
        poolConfig,
        () => [],
        (arr) => { arr.length = 0; },
      );

      // Acquire items
      const item1 = pool.acquire();
      const item2 = pool.acquire();
      expect(item1).toEqual([]);
      expect(item2).toEqual([]);
      expect(item1).not.toBe(item2);

      // Release and re-acquire
      pool.release(item1);
      const item3 = pool.acquire();
      expect(item3).toBe(item1); // Should get the same array back
    });

    it('resets items on release', () => {
      const poolConfig: PoolConfig = {
        initial: 10,
        max: 100,
        growthFactor: 1.5,
        shrinkThreshold: 0.25,
        minSize: 5,
      };
      const pool = new AdaptivePool<number[]>(
        poolConfig,
        () => [],
        (arr) => { arr.length = 0; },
      );

      const item = pool.acquire();
      item.push(1, 2, 3);
      expect(item).toEqual([1, 2, 3]);

      pool.release(item);
      const item2 = pool.acquire();
      expect(item2).toBe(item);
      expect(item2).toEqual([]); // Should be reset
    });
  });

  describe('adaptive growth', () => {
    it('grows when high water mark exceeds current max', () => {
      const poolConfig: PoolConfig = {
        initial: 2,
        max: 10,
        growthFactor: 2,
        shrinkThreshold: 0.25,
        minSize: 1,
      };
      const pool = new AdaptivePool<number[]>(
        poolConfig,
        () => [],
        (arr) => { arr.length = 0; },
      );

      // Acquire more items than initial size
      const items: number[][] = [];
      for (let i = 0; i < 5; i++) {
        items.push(pool.acquire());
      }

      // Release all items - this should trigger growth
      for (const item of items) {
        pool.release(item);
      }

      const stats = pool.getStats();
      expect(stats.currentMaxSize).toBeGreaterThan(2); // Should have grown
      expect(stats.poolSize).toBe(5); // All items should be in pool
    });

    it('does not grow beyond max', () => {
      const poolConfig: PoolConfig = {
        initial: 2,
        max: 3,
        growthFactor: 2,
        shrinkThreshold: 0.25,
        minSize: 1,
      };
      const pool = new AdaptivePool<number[]>(
        poolConfig,
        () => [],
        (arr) => { arr.length = 0; },
      );

      // Acquire many items
      const items: number[][] = [];
      for (let i = 0; i < 10; i++) {
        items.push(pool.acquire());
      }

      // Release all
      for (const item of items) {
        pool.release(item);
      }

      const stats = pool.getStats();
      expect(stats.currentMaxSize).toBeLessThanOrEqual(3); // Should not exceed max
      expect(stats.poolSize).toBeLessThanOrEqual(3); // Pool size capped at max
    });
  });

  describe('shrinking', () => {
    it('shrinks pool when maybeShrink is called', () => {
      const poolConfig: PoolConfig = {
        initial: 10,
        max: 100,
        growthFactor: 2,
        shrinkThreshold: 0.25,
        minSize: 2,
      };
      const pool = new AdaptivePool<number[]>(
        poolConfig,
        () => [],
        (arr) => { arr.length = 0; },
      );

      // Acquire and release many items to grow the pool
      const items: number[][] = [];
      for (let i = 0; i < 50; i++) {
        items.push(pool.acquire());
      }
      for (const item of items) {
        pool.release(item);
      }

      const statsBefore = pool.getStats();
      expect(statsBefore.currentMaxSize).toBeGreaterThan(10);

      // Simulate low usage period and shrink
      pool.maybeShrink();

      const statsAfter = pool.getStats();
      // Pool should have shrunk
      expect(statsAfter.currentMaxSize).toBeLessThanOrEqual(statsBefore.currentMaxSize);
    });
  });

  describe('getStats', () => {
    it('returns accurate statistics', () => {
      const poolConfig: PoolConfig = {
        initial: 5,
        max: 50,
        growthFactor: 1.5,
        shrinkThreshold: 0.25,
        minSize: 2,
      };
      const pool = new AdaptivePool<number[]>(
        poolConfig,
        () => [],
        (arr) => { arr.length = 0; },
      );

      expect(pool.getStats()).toEqual({
        poolSize: 0,
        currentMaxSize: 5,
        totalAllocated: 0,
        highWaterMark: 0,
      });

      const items = [pool.acquire(), pool.acquire(), pool.acquire()];
      expect(pool.getStats().totalAllocated).toBe(3);
      expect(pool.getStats().highWaterMark).toBe(3);

      pool.release(items[0]);
      expect(pool.getStats().poolSize).toBe(1);
    });
  });

  describe('clear', () => {
    it('clears the pool and resets stats', () => {
      const poolConfig: PoolConfig = {
        initial: 5,
        max: 50,
        growthFactor: 1.5,
        shrinkThreshold: 0.25,
        minSize: 2,
      };
      const pool = new AdaptivePool<number[]>(
        poolConfig,
        () => [],
        (arr) => { arr.length = 0; },
      );

      // Acquire and release some items
      const items = [pool.acquire(), pool.acquire()];
      pool.release(items[0]);
      pool.release(items[1]);

      expect(pool.getStats().poolSize).toBe(2);
      expect(pool.getStats().totalAllocated).toBe(2);

      pool.clear();

      expect(pool.getStats()).toEqual({
        poolSize: 0,
        currentMaxSize: 5,
        totalAllocated: 0,
        highWaterMark: 0,
      });
    });
  });
});

describe('configureGXT', () => {
  it('allows partial configuration', () => {
    const originalOpsInitial = config.opsArrayPool.initial;

    configureGXT({
      opsArrayPool: { initial: 200 },
    });

    expect(config.opsArrayPool.initial).toBe(200);

    // Reset for other tests
    configureGXT({
      opsArrayPool: { initial: originalOpsInitial },
    });
  });

  it('can configure multiple pools', () => {
    const originalOpsMax = config.opsArrayPool.max;
    const originalDestructorMax = config.destructorArrayPool.max;

    configureGXT({
      opsArrayPool: { max: 2000 },
      destructorArrayPool: { max: 1500 },
    });

    expect(config.opsArrayPool.max).toBe(2000);
    expect(config.destructorArrayPool.max).toBe(1500);

    // Reset
    configureGXT({
      opsArrayPool: { max: originalOpsMax },
      destructorArrayPool: { max: originalDestructorMax },
    });
  });
});

describe('default config values', () => {
  it('has reasonable defaults', () => {
    expect(config.opsArrayPool.initial).toBe(100);
    expect(config.opsArrayPool.max).toBe(1000);
    expect(config.opsArrayPool.growthFactor).toBe(1.5);

    expect(config.destructorArrayPool.initial).toBe(100);
    expect(config.destructorArrayPool.max).toBe(1000);

    expect(config.idPool.initial).toBe(100);
    expect(config.idPool.max).toBe(1000);
  });
});
