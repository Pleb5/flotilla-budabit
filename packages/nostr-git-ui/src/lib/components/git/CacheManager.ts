import { type MergeAnalysisResult } from "@nostr-git/core/git";
import type { PullRequestEvent } from "@nostr-git/core/events";

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  metadata?: Record<string, any>;
}

export interface MergeAnalysisCacheEntry {
  result: MergeAnalysisResult;
  timestamp: number;
  prHash: string;
  targetBranch: string;
  repoId: string;
}

export enum CacheType {
  MEMORY = "memory",
  LOCAL_STORAGE = "localStorage",
  SESSION_STORAGE = "sessionStorage",
  INDEXED_DB = "indexedDB",
}

export interface CacheConfig {
  type: CacheType;
  keyPrefix: string;
  defaultTTL: number; // in milliseconds
  maxSize?: number; // for memory cache
  autoCleanup?: boolean;
  cleanupInterval?: number; // in milliseconds
}

/**
 * CacheManager provides a unified interface for different caching strategies.
 * Supports memory, localStorage, sessionStorage, and IndexedDB caching.
 */
export class CacheManager {
  private memoryCache = new Map<string, CacheEntry<any>>();
  private cleanupIntervals = new Map<string, number>();
  private configs = new Map<string, CacheConfig>();

  constructor() {
    // Set up default cleanup for memory cache
    this.setupAutoCleanup("memory", {
      type: CacheType.MEMORY,
      keyPrefix: "mem_",
      defaultTTL: 30 * 60 * 1000, // 30 minutes
      autoCleanup: true,
      cleanupInterval: 5 * 60 * 1000, // 5 minutes
    });
  }

  /**
   * Register a cache configuration
   */
  registerCache(name: string, config: CacheConfig): void {
    this.configs.set(name, config);

    if (config.autoCleanup) {
      this.setupAutoCleanup(name, config);
    }
  }

  /**
   * Set up automatic cleanup for a cache
   */
  private setupAutoCleanup(name: string, config: CacheConfig): void {
    if (this.cleanupIntervals.has(name)) {
      clearInterval(this.cleanupIntervals.get(name)!);
    }

    const interval = setInterval(
      () => {
        this.cleanup(name);
      },
      config.cleanupInterval || 5 * 60 * 1000
    ) as unknown as number;

    this.cleanupIntervals.set(name, interval);
  }

  /**
   * Generate a cache key with prefix
   */
  private generateKey(cacheName: string, key: string): string {
    const config = this.configs.get(cacheName);
    const prefix = config?.keyPrefix || "";
    return `${prefix}${key}`;
  }

  /**
   * Get data from cache
   */
  async get<T>(cacheName: string, key: string): Promise<T | null> {
    const config = this.configs.get(cacheName);
    if (!config) {
      console.warn(`Cache configuration not found: ${cacheName}`);
      return null;
    }

    const fullKey = this.generateKey(cacheName, key);

    try {
      switch (config.type) {
        case CacheType.MEMORY:
          return this.getFromMemory<T>(fullKey);

        case CacheType.LOCAL_STORAGE:
          return this.getFromLocalStorage<T>(fullKey);

        case CacheType.SESSION_STORAGE:
          return this.getFromSessionStorage<T>(fullKey);

        case CacheType.INDEXED_DB:
          return await this.getFromIndexedDB<T>(fullKey);

        default:
          console.warn(`Unsupported cache type: ${config.type}`);
          return null;
      }
    } catch (error) {
      console.warn(`Failed to get from cache ${cacheName}:`, error);
      return null;
    }
  }

  /**
   * Set data in cache
   */
  async set<T>(
    cacheName: string,
    key: string,
    data: T,
    ttl?: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    const config = this.configs.get(cacheName);
    if (!config) {
      console.warn(`Cache configuration not found: ${cacheName}`);
      return;
    }

    const fullKey = this.generateKey(cacheName, key);
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttl || config.defaultTTL,
      metadata,
    };

    try {
      switch (config.type) {
        case CacheType.MEMORY:
          this.setInMemory(fullKey, entry);
          break;

        case CacheType.LOCAL_STORAGE:
          this.setInLocalStorage(fullKey, entry);
          break;

        case CacheType.SESSION_STORAGE:
          this.setInSessionStorage(fullKey, entry);
          break;

        case CacheType.INDEXED_DB:
          await this.setInIndexedDB(fullKey, entry);
          break;

        default:
          console.warn(`Unsupported cache type: ${config.type}`);
      }
    } catch (error) {
      console.warn(`Failed to set in cache ${cacheName}:`, error);
    }
  }

  /**
   * Remove data from cache
   */
  async remove(cacheName: string, key: string): Promise<void> {
    const config = this.configs.get(cacheName);
    if (!config) return;

    const fullKey = this.generateKey(cacheName, key);

    try {
      switch (config.type) {
        case CacheType.MEMORY:
          this.memoryCache.delete(fullKey);
          break;

        case CacheType.LOCAL_STORAGE:
          localStorage.removeItem(fullKey);
          break;

        case CacheType.SESSION_STORAGE:
          sessionStorage.removeItem(fullKey);
          break;

        case CacheType.INDEXED_DB:
          await this.removeFromIndexedDB(fullKey);
          break;
      }
    } catch (error) {
      console.warn(`Failed to remove from cache ${cacheName}:`, error);
    }
  }

  /**
   * Clear entire cache
   */
  async clear(cacheName: string): Promise<void> {
    const config = this.configs.get(cacheName);
    if (!config) return;

    try {
      switch (config.type) {
        case CacheType.MEMORY:
          this.clearMemoryCache(config.keyPrefix);
          break;

        case CacheType.LOCAL_STORAGE:
          this.clearWebStorage(localStorage, config.keyPrefix);
          break;

        case CacheType.SESSION_STORAGE:
          this.clearWebStorage(sessionStorage, config.keyPrefix);
          break;

        case CacheType.INDEXED_DB:
          await this.clearIndexedDB();
          break;
      }
    } catch (error) {
      console.warn(`Failed to clear cache ${cacheName}:`, error);
    }
  }

  /**
   * Clean up expired entries
   */
  cleanup(cacheName: string): void {
    const config = this.configs.get(cacheName);
    if (!config) return;

    const now = Date.now();
    let cleanedCount = 0;

    try {
      switch (config.type) {
        case CacheType.MEMORY:
          cleanedCount = this.cleanupMemoryCache(now);
          break;

        case CacheType.LOCAL_STORAGE:
          cleanedCount = this.cleanupWebStorage(localStorage, config.keyPrefix, now);
          break;

        case CacheType.SESSION_STORAGE:
          cleanedCount = this.cleanupWebStorage(sessionStorage, config.keyPrefix, now);
          break;

        case CacheType.INDEXED_DB:
          // IndexedDB cleanup would be more complex, implement if needed
          break;
      }

      // Only log if significant cleanup occurred (more than 10 entries)
      if (cleanedCount > 10) {
        console.log(`Cleaned up ${cleanedCount} expired entries from ${cacheName} cache`);
      }
    } catch (error) {
      console.warn(`Failed to cleanup cache ${cacheName}:`, error);
    }
  }

  // Memory cache methods
  private getFromMemory<T>(key: string): T | null {
    const entry = this.memoryCache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.memoryCache.delete(key);
      return null;
    }

    return entry.data;
  }

  private setInMemory<T>(key: string, entry: CacheEntry<T>): void {
    this.memoryCache.set(key, entry);
  }

  private clearMemoryCache(prefix: string): void {
    const keysToDelete = Array.from(this.memoryCache.keys()).filter((key) =>
      key.startsWith(prefix)
    );
    keysToDelete.forEach((key) => this.memoryCache.delete(key));
  }

  private cleanupMemoryCache(now: number): number {
    let cleanedCount = 0;
    for (const [key, entry] of this.memoryCache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.memoryCache.delete(key);
        cleanedCount++;
      }
    }
    return cleanedCount;
  }

  // Web Storage methods (localStorage/sessionStorage)
  private getFromLocalStorage<T>(key: string): T | null {
    return this.getFromWebStorage<T>(localStorage, key);
  }

  private getFromSessionStorage<T>(key: string): T | null {
    return this.getFromWebStorage<T>(sessionStorage, key);
  }

  private getFromWebStorage<T>(storage: Storage, key: string): T | null {
    const item = storage.getItem(key);
    if (!item) return null;

    try {
      const entry: CacheEntry<T> = JSON.parse(item);
      if (Date.now() - entry.timestamp > entry.ttl) {
        storage.removeItem(key);
        return null;
      }
      return entry.data;
    } catch (error) {
      storage.removeItem(key);
      return null;
    }
  }

  private setInLocalStorage<T>(key: string, entry: CacheEntry<T>): void {
    this.setInWebStorage(localStorage, key, entry);
  }

  private setInSessionStorage<T>(key: string, entry: CacheEntry<T>): void {
    this.setInWebStorage(sessionStorage, key, entry);
  }

  private setInWebStorage<T>(storage: Storage, key: string, entry: CacheEntry<T>): void {
    try {
      storage.setItem(key, JSON.stringify(entry));
    } catch (error) {
      // Handle storage quota exceeded
      console.warn("Storage quota exceeded, attempting cleanup");
      this.cleanupWebStorage(storage, "", Date.now());
      try {
        storage.setItem(key, JSON.stringify(entry));
      } catch (retryError) {
        console.error("Failed to store after cleanup:", retryError);
      }
    }
  }

  private clearWebStorage(storage: Storage, prefix: string): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => storage.removeItem(key));
  }

  private cleanupWebStorage(storage: Storage, prefix: string, now: number): number {
    const keysToRemove: string[] = [];

    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(prefix)) {
        try {
          const item = storage.getItem(key);
          if (item) {
            const entry: CacheEntry<any> = JSON.parse(item);
            if (now - entry.timestamp > entry.ttl) {
              keysToRemove.push(key);
            }
          }
        } catch (error) {
          // Remove corrupted entries
          keysToRemove.push(key);
        }
      }
    }

    keysToRemove.forEach((key) => storage.removeItem(key));
    return keysToRemove.length;
  }

  // IndexedDB methods (basic implementation)
  private async getFromIndexedDB<T>(key: string): Promise<T | null> {
    // Basic IndexedDB implementation - can be expanded
    return null;
  }

  private async setInIndexedDB<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    // Basic IndexedDB implementation - can be expanded
  }

  private async removeFromIndexedDB(key: string): Promise<void> {
    // Basic IndexedDB implementation - can be expanded
  }

  private async clearIndexedDB(): Promise<void> {
    // Basic IndexedDB implementation - can be expanded
  }

  /**
   * Dispose of the cache manager
   */
  dispose(): void {
    // Clear all cleanup intervals
    for (const interval of this.cleanupIntervals.values()) {
      clearInterval(interval);
    }
    this.cleanupIntervals.clear();

    // Clear memory cache
    this.memoryCache.clear();

    // Clear configurations
    this.configs.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(cacheName: string): { size: number; hitRate?: number } {
    const config = this.configs.get(cacheName);
    if (!config) return { size: 0 };

    switch (config.type) {
      case CacheType.MEMORY: {
        const memorySize = Array.from(this.memoryCache.keys()).filter((key) =>
          key.startsWith(config.keyPrefix)
        ).length;
        return { size: memorySize };
      }

      default:
        return { size: 0 };
    }
  }
}

/**
 * Specialized cache manager for merge analysis
 */
export class MergeAnalysisCacheManager {
  private cacheManager: CacheManager;
  private readonly CACHE_NAME = "merge_analysis";

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;

    // Register merge analysis cache configuration
    this.cacheManager.registerCache(this.CACHE_NAME, {
      type: CacheType.LOCAL_STORAGE,
      keyPrefix: "merge_analysis_cache_",
      defaultTTL: 7 * 24 * 60 * 60 * 1000, // 7 days
      autoCleanup: true,
      cleanupInterval: 6 * 60 * 60 * 1000, // 6 hours
    });
  }

  /**
   * Generate a hash for PR content to detect changes
   */
  private generatePrHash(pr: PullRequestEvent): string {
    // PR events are immutable; updates create new events. Capture intrinsic
    // payload fields to detect meaningful changes for cached merge analysis.
    const content = `${pr.id}:${pr.pubkey}:${pr.created_at}:${pr.content}`;

    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // force 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Get cached merge analysis result
   */
  async get(
    pr: PullRequestEvent,
    targetBranch: string,
    repoId: string
  ): Promise<MergeAnalysisResult | null> {
    const cacheEntry = await this.cacheManager.get<MergeAnalysisCacheEntry>(
      this.CACHE_NAME,
      pr.id
    );

    if (!cacheEntry) return null;

    // Validate cache entry
    const currentPrHash = this.generatePrHash(pr);
    if (cacheEntry.prHash !== currentPrHash) {
      await this.remove(pr.id);
      return null;
    }

    if (cacheEntry.targetBranch !== targetBranch || cacheEntry.repoId !== repoId) {
      await this.remove(pr.id);
      return null;
    }

    return cacheEntry.result;
  }

  /**
   * Cache merge analysis result
   */
  async set(
    pr: PullRequestEvent,
    targetBranch: string,
    repoId: string,
    result: MergeAnalysisResult
  ): Promise<void> {
    const cacheEntry: MergeAnalysisCacheEntry = {
      result,
      timestamp: Date.now(),
      prHash: this.generatePrHash(pr),
      targetBranch,
      repoId,
    };

    await this.cacheManager.set(this.CACHE_NAME, pr.id, cacheEntry);
  }

  /**
   * Remove cached merge analysis
   */
  async remove(prId: string): Promise<void> {
    await this.cacheManager.remove(this.CACHE_NAME, prId);
  }

  /**
   * Clear all merge analysis cache
   */
  async clear(): Promise<void> {
    await this.cacheManager.clear(this.CACHE_NAME);
  }

  /**
   * Check if merge analysis is cached
   */
  async has(prId: string): Promise<boolean> {
    const result = await this.cacheManager.get(this.CACHE_NAME, prId);
    return result !== null;
  }

  /**
   * Cleanup expired entries
   */
  cleanup(): void {
    this.cacheManager.cleanup(this.CACHE_NAME);
  }
}
