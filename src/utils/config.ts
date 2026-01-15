/**
 * Runtime configuration for GXT memory pools.
 * These settings control pool sizes and adaptive growth behavior.
 */

export interface PoolConfig {
  /** Initial pool size */
  initial: number;
  /** Maximum pool size (hard cap) */
  max: number;
  /** Growth factor when pool is exhausted (e.g., 1.5 = 50% growth) */
  growthFactor: number;
  /** Shrink threshold - shrink when usage drops below this ratio of current size */
  shrinkThreshold: number;
  /** Minimum size to shrink to (won't go below initial) */
  minSize: number;
}

export interface GXTConfig {
  /** Pool for ops arrays in reactive system */
  opsArrayPool: PoolConfig;
  /** Pool for destructor arrays */
  destructorArrayPool: PoolConfig;
  /** Pool for component IDs */
  idPool: PoolConfig;
}

/** Partial config type for configureGXT - allows partial pool configs */
export type GXTConfigInput = {
  opsArrayPool?: Partial<PoolConfig>;
  destructorArrayPool?: Partial<PoolConfig>;
  idPool?: Partial<PoolConfig>;
};

const defaultPoolConfig: PoolConfig = {
  initial: 50,
  max: 500,
  growthFactor: 1.5,
  shrinkThreshold: 0.25,
  minSize: 10,
};

export const config: GXTConfig = {
  opsArrayPool: { ...defaultPoolConfig, initial: 100, max: 1000 },
  destructorArrayPool: { ...defaultPoolConfig, initial: 100, max: 1000 },
  idPool: { ...defaultPoolConfig, initial: 100, max: 1000 },
};

/**
 * Configure GXT runtime settings.
 * Call this before rendering to customize pool behavior.
 */
export function configureGXT(userConfig: GXTConfigInput) {
  if (userConfig.opsArrayPool) {
    Object.assign(config.opsArrayPool, userConfig.opsArrayPool);
  }
  if (userConfig.destructorArrayPool) {
    Object.assign(config.destructorArrayPool, userConfig.destructorArrayPool);
  }
  if (userConfig.idPool) {
    Object.assign(config.idPool, userConfig.idPool);
  }
}

/**
 * Adaptive pool manager that handles growth and shrinking.
 */
export class AdaptivePool<T> {
  private pool: T[] = [];
  private currentMaxSize: number;
  private config: PoolConfig;
  private createFn: () => T;
  private resetFn: (item: T) => void;
  private totalAllocated = 0;
  private highWaterMark = 0;

  constructor(
    config: PoolConfig,
    createFn: () => T,
    resetFn: (item: T) => void = () => {},
  ) {
    this.config = config;
    this.currentMaxSize = config.initial;
    this.createFn = createFn;
    this.resetFn = resetFn;
  }

  /**
   * Get an item from the pool or create a new one.
   */
  acquire(): T {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }
    // Pool exhausted, create new item
    this.totalAllocated++;
    this.highWaterMark = Math.max(this.highWaterMark, this.totalAllocated);
    return this.createFn();
  }

  /**
   * Return an item to the pool.
   */
  release(item: T): void {
    // Check if we should grow the pool capacity
    if (this.pool.length >= this.currentMaxSize) {
      // Pool is full, check if we should grow
      if (this.highWaterMark > this.currentMaxSize && this.currentMaxSize < this.config.max) {
        // Grow the pool
        this.currentMaxSize = Math.min(
          Math.ceil(this.currentMaxSize * this.config.growthFactor),
          this.config.max,
        );
      } else {
        // Pool is at capacity, discard item (let GC handle it)
        return;
      }
    }

    // Reset and add to pool
    this.resetFn(item);
    this.pool.push(item);
  }

  /**
   * Shrink the pool if it's significantly underutilized.
   * Call this periodically (e.g., on idle) to reclaim memory.
   */
  maybeShrink(): void {
    const usage = this.pool.length / this.currentMaxSize;
    if (usage > this.config.shrinkThreshold) {
      // Pool is being utilized, check if we can shrink capacity
      const targetSize = Math.max(
        Math.ceil(this.highWaterMark * this.config.growthFactor),
        this.config.minSize,
        this.config.initial,
      );
      if (targetSize < this.currentMaxSize) {
        this.currentMaxSize = targetSize;
        // Trim pool to new size
        while (this.pool.length > this.currentMaxSize) {
          this.pool.pop();
        }
      }
    }
    // Reset high water mark for next period
    this.highWaterMark = this.totalAllocated - this.pool.length;
  }

  /**
   * Get current pool statistics.
   */
  getStats() {
    return {
      poolSize: this.pool.length,
      currentMaxSize: this.currentMaxSize,
      totalAllocated: this.totalAllocated,
      highWaterMark: this.highWaterMark,
    };
  }

  /**
   * Clear the pool entirely.
   */
  clear(): void {
    this.pool.length = 0;
    this.totalAllocated = 0;
    this.highWaterMark = 0;
    this.currentMaxSize = this.config.initial;
  }
}
