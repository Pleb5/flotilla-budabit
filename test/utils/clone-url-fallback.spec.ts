import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  withUrlFallback,
  withMultiWrite,
  filterValidCloneUrls,
  reorderUrlsByPreference,
  getCachedUrlPreference,
  updateUrlPreferenceCache,
  clearUrlPreferenceCache,
  getCloneUrlsFromEvent,
  cloneWithFallback,
  pushToAllRemotes,
} from '../../src/utils/clone-url-fallback.js';

describe('clone-url-fallback utilities', () => {
  beforeEach(() => {
    clearUrlPreferenceCache();
  });

  describe('filterValidCloneUrls', () => {
    it('filters out nostr:// pseudo URLs', () => {
      const urls = [
        'https://github.com/user/repo.git',
        'nostr://relay.example.com',
        'nostr:1234567890abcdef',
        'git@github.com:user/repo.git',
      ];
      const result = filterValidCloneUrls(urls);
      expect(result).toEqual([
        'https://github.com/user/repo.git',
        'git@github.com:user/repo.git',
      ]);
    });

    it('handles empty input', () => {
      expect(filterValidCloneUrls([])).toEqual([]);
      expect(filterValidCloneUrls(null as any)).toEqual([]);
      expect(filterValidCloneUrls(undefined as any)).toEqual([]);
    });

    it('filters out empty strings and whitespace', () => {
      const urls = ['https://github.com/repo.git', '', '  ', null as any, 'git://other.com/repo'];
      const result = filterValidCloneUrls(urls);
      expect(result).toEqual([
        'https://github.com/repo.git',
        'git://other.com/repo',
      ]);
    });
  });

  describe('URL preference caching', () => {
    it('caches and retrieves URL preference', () => {
      const repoId = 'test-repo';
      const url = 'https://github.com/user/repo.git';

      expect(getCachedUrlPreference(repoId)).toBeUndefined();

      updateUrlPreferenceCache(repoId, url, ['https://failed.com/repo.git']);

      const cached = getCachedUrlPreference(repoId);
      expect(cached).toBeDefined();
      expect(cached?.preferredUrl).toBe(url);
      expect(cached?.failedUrls).toContain('https://failed.com/repo.git');
    });

    it('clears cache for specific repo', () => {
      updateUrlPreferenceCache('repo1', 'https://url1.com/repo.git');
      updateUrlPreferenceCache('repo2', 'https://url2.com/repo.git');

      clearUrlPreferenceCache('repo1');

      expect(getCachedUrlPreference('repo1')).toBeUndefined();
      expect(getCachedUrlPreference('repo2')).toBeDefined();
    });

    it('clears entire cache', () => {
      updateUrlPreferenceCache('repo1', 'https://url1.com/repo.git');
      updateUrlPreferenceCache('repo2', 'https://url2.com/repo.git');

      clearUrlPreferenceCache();

      expect(getCachedUrlPreference('repo1')).toBeUndefined();
      expect(getCachedUrlPreference('repo2')).toBeUndefined();
    });
  });

  describe('reorderUrlsByPreference', () => {
    it('puts preferred URL first', () => {
      updateUrlPreferenceCache('repo', 'https://preferred.com/repo.git');

      const urls = [
        'https://other1.com/repo.git',
        'https://preferred.com/repo.git',
        'https://other2.com/repo.git',
      ];

      const result = reorderUrlsByPreference(urls, 'repo');

      expect(result[0]).toBe('https://preferred.com/repo.git');
    });

    it('puts failed URLs last', () => {
      updateUrlPreferenceCache('repo', 'https://preferred.com/repo.git', [
        'https://failed.com/repo.git',
      ]);

      const urls = [
        'https://failed.com/repo.git',
        'https://other.com/repo.git',
        'https://preferred.com/repo.git',
      ];

      const result = reorderUrlsByPreference(urls, 'repo');

      expect(result[0]).toBe('https://preferred.com/repo.git');
      expect(result[result.length - 1]).toBe('https://failed.com/repo.git');
    });

    it('returns original order without repoId', () => {
      const urls = ['https://a.com', 'https://b.com'];
      const result = reorderUrlsByPreference(urls);
      expect(result).toEqual(urls);
    });
  });

  describe('withUrlFallback', () => {
    it('returns first successful result', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('First URL failed'))
        .mockResolvedValueOnce({ data: 'success' });

      const result = await withUrlFallback(
        ['https://url1.com', 'https://url2.com'],
        operation
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ data: 'success' });
      expect(result.usedUrl).toBe('https://url2.com');
      expect(result.attempts).toHaveLength(2);
      expect(result.attempts[0].success).toBe(false);
      expect(result.attempts[1].success).toBe(true);
    });

    it('returns failure when all URLs fail', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('First failed'))
        .mockRejectedValueOnce(new Error('Second failed'));

      const result = await withUrlFallback(
        ['https://url1.com', 'https://url2.com'],
        operation
      );

      expect(result.success).toBe(false);
      expect(result.result).toBeUndefined();
      expect(result.usedUrl).toBeUndefined();
      expect(result.attempts).toHaveLength(2);
    });

    it('updates cache on success', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce({ data: 'ok' });

      await withUrlFallback(
        ['https://failed.com', 'https://success.com'],
        operation,
        { repoId: 'test-repo' }
      );

      const cached = getCachedUrlPreference('test-repo');
      expect(cached?.preferredUrl).toBe('https://success.com');
      expect(cached?.failedUrls).toContain('https://failed.com');
    });

    it('continues after auth errors so readable mirrors can be tried', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('401 Unauthorized'))
        .mockResolvedValueOnce({ data: 'public mirror' });

      const result = await withUrlFallback(
        ['https://url1.com', 'https://url2.com'],
        operation
      );

      expect(result.success).toBe(true);
      expect(result.usedUrl).toBe('https://url2.com');
      expect(result.attempts).toHaveLength(2);
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('handles empty URL list', async () => {
      const operation = vi.fn();

      const result = await withUrlFallback([], operation);

      expect(result.success).toBe(false);
      expect(result.attempts).toHaveLength(0);
      expect(operation).not.toHaveBeenCalled();
    });
  });

  describe('withMultiWrite', () => {
    it('writes to all URLs in parallel', async () => {
      const results: string[] = [];
      const operation = vi.fn().mockImplementation(async (url: string) => {
        results.push(url);
        return { pushed: url };
      });

      const result = await withMultiWrite(
        ['https://url1.com', 'https://url2.com', 'https://url3.com'],
        operation
      );

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(3);
      expect(result.failureCount).toBe(0);
      expect(result.results).toHaveLength(3);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('reports partial success', async () => {
      const operation = vi.fn()
        .mockResolvedValueOnce({ pushed: true })
        .mockRejectedValueOnce(new Error('Push failed'))
        .mockResolvedValueOnce({ pushed: true });

      const result = await withMultiWrite(
        ['https://url1.com', 'https://url2.com', 'https://url3.com'],
        operation
      );

      expect(result.success).toBe(false);
      expect(result.partialSuccess).toBe(true);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(1);
      expect(result.summary).toContain('2/3');
    });

    it('reports total failure', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Failed'));

      const result = await withMultiWrite(
        ['https://url1.com', 'https://url2.com'],
        operation
      );

      expect(result.success).toBe(false);
      expect(result.partialSuccess).toBe(false);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(2);
    });

    it('handles empty URL list', async () => {
      const operation = vi.fn();

      const result = await withMultiWrite([], operation);

      expect(result.success).toBe(false);
      expect(result.results).toHaveLength(0);
      expect(result.summary).toContain('No valid clone URLs');
    });
  });

  describe('getCloneUrlsFromEvent', () => {
    it('extracts clone URLs from event tags', () => {
      const event = {
        tags: [
          ['d', 'repo-name'],
          ['clone', 'https://github.com/user/repo.git', 'git@github.com:user/repo.git'],
          ['web', 'https://github.com/user/repo'],
        ],
      };

      const urls = getCloneUrlsFromEvent(event as any);

      expect(urls).toEqual([
        'https://github.com/user/repo.git',
        'git@github.com:user/repo.git',
      ]);
    });

    it('handles multiple clone tags', () => {
      const event = {
        tags: [
          ['clone', 'https://url1.com/repo.git'],
          ['clone', 'https://url2.com/repo.git'],
        ],
      };

      const urls = getCloneUrlsFromEvent(event as any);

      expect(urls).toEqual([
        'https://url1.com/repo.git',
        'https://url2.com/repo.git',
      ]);
    });

    it('handles events without clone tags', () => {
      const event = {
        tags: [['d', 'repo-name']],
      };

      const urls = getCloneUrlsFromEvent(event as any);

      expect(urls).toEqual([]);
    });
  });

  describe('convenience wrappers', () => {
    it('cloneWithFallback wraps withUrlFallback', async () => {
      const cloneFn = vi.fn().mockResolvedValue({ cloned: true });

      const result = await cloneWithFallback(
        ['https://url.com'],
        cloneFn,
        'test-repo'
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ cloned: true });
    });

    it('pushToAllRemotes wraps withMultiWrite', async () => {
      const pushFn = vi.fn().mockResolvedValue({ pushed: true });

      const result = await pushToAllRemotes(
        ['https://url1.com', 'https://url2.com'],
        pushFn
      );

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(2);
    });
  });
});
