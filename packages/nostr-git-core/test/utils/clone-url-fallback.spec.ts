import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  withUrlFallback,
  withMultiWrite,
  filterValidCloneUrls,
  reorderUrlsByPreference,
  orderReadUrlsByPreference,
  sortUrlsByApiPriority,
  getCachedUrlPreference,
  updateUrlPreferenceCache,
  clearUrlPreferenceCache,
  getCloneUrlsFromEvent,
  getPrimaryCloneUrlFromEvent,
  isPushCapableCloneUrl,
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

    it('filters out disabled Bitbucket remotes while retaining enabled mirrors', () => {
      expect(filterValidCloneUrls([
        'https://bitbucket.org/team/repo.git',
        'git@bitbucket.org:team/repo.git',
        'https://github.com/team/repo.git',
      ])).toEqual(['https://github.com/team/repo.git']);
      expect(isPushCapableCloneUrl('https://bitbucket.org/team/repo.git')).toBe(false);
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
    it('preserves declared order even when a preferred URL is cached', () => {
      updateUrlPreferenceCache('repo', 'https://preferred.com/repo.git');

      const urls = [
        'https://other1.com/repo.git',
        'https://preferred.com/repo.git',
        'https://other2.com/repo.git',
      ];

      const result = reorderUrlsByPreference(urls, 'repo');

      expect(result).toEqual(urls);
    });

    it('does not move previously failed primary URLs to the end', () => {
      updateUrlPreferenceCache('repo', 'https://preferred.com/repo.git', [
        'https://failed.com/repo.git',
      ]);

      const urls = [
        'https://failed.com/repo.git',
        'https://other.com/repo.git',
        'https://preferred.com/repo.git',
      ];

      const result = reorderUrlsByPreference(urls, 'repo');

      expect(result).toEqual(urls);
    });

    it('returns original order without repoId', () => {
      const urls = ['https://a.com', 'https://b.com'];
      const result = reorderUrlsByPreference(urls);
      expect(result).toEqual(urls);
    });

    it('does not promote API-capable remotes ahead of declared order', () => {
      const urls = [
        'https://gitnostr.com/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/repo.git',
        'https://github.com/user/repo.git',
      ];

      expect(sortUrlsByApiPriority(urls)).toEqual(urls);
      expect(reorderUrlsByPreference(urls, 'repo')).toEqual(urls);
    });
  });

  describe('orderReadUrlsByPreference', () => {
    it('starts with declared order before a fallback is active', () => {
      const urls = ['https://primary.example/repo.git', 'https://secondary.example/repo.git'];

      expect(orderReadUrlsByPreference(urls, 'repo')).toEqual(urls);
    });

    it('starts at the active fallback and only continues forward', () => {
      updateUrlPreferenceCache('repo', 'https://secondary.example/repo.git', [
        'https://primary.example/repo.git',
      ]);
      const urls = [
        'https://primary.example/repo.git',
        'https://secondary.example/repo.git',
        'https://tertiary.example/repo.git',
      ];

      expect(orderReadUrlsByPreference(urls, 'repo')).toEqual([
        'https://secondary.example/repo.git',
        'https://tertiary.example/repo.git',
      ]);
      expect(reorderUrlsByPreference(urls, 'repo')).toEqual(urls);
    });

    it('invalidates stale state when the active URL is no longer declared', () => {
      updateUrlPreferenceCache('repo', 'https://removed.example/repo.git');
      const urls = ['https://primary.example/repo.git', 'https://secondary.example/repo.git'];

      expect(orderReadUrlsByPreference(urls, 'repo')).toEqual(urls);
      expect(getCachedUrlPreference('repo')).toBeUndefined();
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

    it('reuses the active fallback on subsequent reads', async () => {
      const urls = [
        'https://primary.example',
        'https://secondary.example',
        'https://third.example',
      ];
      const firstOperation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Primary failed'))
        .mockResolvedValueOnce({ data: 'secondary' });

      await withUrlFallback(urls, firstOperation, { repoId: 'repo' });

      const secondOperation = vi.fn().mockResolvedValue({ data: 'secondary again' });
      const result = await withUrlFallback(urls, secondOperation, { repoId: 'repo' });

      expect(result.usedUrl).toBe('https://secondary.example');
      expect(secondOperation).toHaveBeenCalledTimes(1);
      expect(secondOperation).toHaveBeenCalledWith(
        'https://secondary.example',
        expect.any(AbortSignal)
      );
    });

    it('advances the shared cursor before attempting the next fallback', async () => {
      const urls = ['https://primary.example', 'https://secondary.example'];
      const observedActiveUrls: Array<string | undefined> = [];

      await withUrlFallback(
        urls,
        vi.fn(async (url: string) => {
          observedActiveUrls.push(getCachedUrlPreference('repo')?.preferredUrl);
          if (url === urls[0]) throw new Error('Primary failed');
          return { data: 'ok' };
        }),
        { repoId: 'repo' }
      );

      expect(observedActiveUrls).toEqual([undefined, 'https://secondary.example']);
    });

    it('waits for a timed-out attempt to cancel before starting the next URL', async () => {
      let primaryRunning = false;
      let secondaryOverlapped = false;

      const result = await withUrlFallback(
        ['https://primary.example', 'https://secondary.example'],
        async (url, signal) => {
          if (url.includes('primary')) {
            primaryRunning = true;
            await new Promise<void>((_resolve, reject) => {
              signal?.addEventListener(
                'abort',
                () => {
                  setTimeout(() => {
                    primaryRunning = false;
                    reject(new Error('primary cancelled'));
                  }, 5);
                },
                { once: true }
              );
            });
          }

          secondaryOverlapped = primaryRunning;
          return { data: 'secondary' };
        },
        { repoId: 'repo', perUrlTimeoutMs: 5 }
      );

      expect(result.success).toBe(true);
      expect(result.usedUrl).toBe('https://secondary.example');
      expect(secondaryOverlapped).toBe(false);
    });

    it('does not advance after timeout until an operation that ignored abort settles', async () => {
      let settlePrimary!: () => void;
      let secondaryStarted = false;
      const primarySettled = new Promise<void>((resolve) => {
        settlePrimary = resolve;
      });

      const resultPromise = withUrlFallback(
        ['https://primary.example', 'https://secondary.example'],
        async (url) => {
          if (url.includes('primary')) {
            await primarySettled;
            return { data: 'late primary' };
          }
          secondaryStarted = true;
          return { data: 'secondary' };
        },
        { repoId: 'repo', perUrlTimeoutMs: 5 }
      );

      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(secondaryStarted).toBe(false);

      settlePrimary();
      const result = await resultPromise;
      expect(result.usedUrl).toBe('https://secondary.example');
      expect(secondaryStarted).toBe(true);
    });

    it('does not let a stale primary success rewind a concurrent fallback', async () => {
      const urls = ['https://primary.example', 'https://secondary.example'];
      let releasePrimary!: () => void;
      const primaryRelease = new Promise<void>((resolve) => {
        releasePrimary = resolve;
      });

      const slowPrimary = withUrlFallback(
        urls,
        async () => {
          await primaryRelease;
          return { data: 'primary' };
        },
        { repoId: 'repo', perUrlTimeoutMs: 0 }
      );
      const fallback = await withUrlFallback(
        urls,
        async (url) => {
          if (url === urls[0]) throw new Error('primary failed');
          return { data: 'secondary' };
        },
        { repoId: 'repo' }
      );

      expect(fallback.usedUrl).toBe(urls[1]);
      releasePrimary();
      await slowPrimary;
      expect(getCachedUrlPreference('repo')?.preferredUrl).toBe(urls[1]);
    });

    it('skips stale intermediate attempts after another read advances farther', async () => {
      const urls = [
        'https://primary.example',
        'https://secondary.example',
        'https://tertiary.example',
      ];
      let rejectPrimary!: (error: Error) => void;
      const delayedPrimary = new Promise<never>((_resolve, reject) => {
        rejectPrimary = reject;
      });
      const staleAttempts: string[] = [];

      const staleRead = withUrlFallback(
        urls,
        async (url) => {
          staleAttempts.push(url);
          if (url === urls[0]) return await delayedPrimary;
          return { data: url };
        },
        { repoId: 'repo', perUrlTimeoutMs: 0 }
      );
      await withUrlFallback(
        urls,
        async (url) => {
          if (url !== urls[2]) throw new Error(`${url} failed`);
          return { data: 'tertiary' };
        },
        { repoId: 'repo' }
      );

      rejectPrimary(new Error('stale primary failed'));
      const staleResult = await staleRead;
      expect(staleAttempts).toEqual([urls[0], urls[2]]);
      expect(staleResult.usedUrl).toBe(urls[2]);
      expect(getCachedUrlPreference('repo')?.preferredUrl).toBe(urls[2]);
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
    it('keeps the first declared URL as primary without promoting a later usable URL', () => {
      const event = {
        tags: [['clone', 'nostr://repo', 'https://primary.example/repo.git']],
      };

      expect(getPrimaryCloneUrlFromEvent(event as any)).toBe('nostr://repo');
      expect(isPushCapableCloneUrl('nostr://repo')).toBe(false);
      expect(isPushCapableCloneUrl('https://primary.example/repo.git')).toBe(true);
    });
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
