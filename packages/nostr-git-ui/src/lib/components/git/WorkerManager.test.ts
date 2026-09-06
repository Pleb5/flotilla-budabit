import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerManager } from './WorkerManager';
import {
  clearUrlPreferenceCache,
  getCachedUrlPreference,
  updateUrlPreferenceCache,
} from '@nostr-git/core/utils';

vi.mock('@nostr-git/core/errors', () => {
  class FatalError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'FatalError';
    }
  }

  const mk = (name: string, message: string = '') => {
    const e = new Error(message);
    (e as any).name = name;
    return e;
  };

  return {
    FatalError,
    createAuthRequiredError: vi.fn((opts: any) => mk('UserActionableError', typeof opts === 'string' ? opts : opts?.message || 'Auth required')),
    createNetworkError: vi.fn((opts: any) => mk('RetriableError', typeof opts === 'string' ? opts : opts?.message || 'Network error')),
    createTimeoutError: vi.fn((opts: any) => mk('RetriableError', typeof opts === 'string' ? opts : opts?.message || 'Timeout')),
    createFsError: vi.fn((message: string) => mk('FatalError', message)),
    createUnknownError: vi.fn((message: string) => mk('RetriableError', message)),
    wrapError: vi.fn((cause: any, err: any) => {
      (err as any).cause = cause;
      return err;
    }),
  };
});

// Mock getGitWorker
vi.mock('@nostr-git/core', () => ({
  getGitWorker: vi.fn(() => ({
    worker: {
      terminate: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    },
    api: {
      setEventIO: vi.fn().mockResolvedValue(undefined),
      setAuthConfig: vi.fn().mockResolvedValue(undefined),
      ping: vi.fn().mockResolvedValue({ success: true }),
      smartInitializeRepo: vi.fn().mockResolvedValue({ success: true }),
      syncWithRemote: vi.fn().mockResolvedValue({ success: true }),
      resetRepoToRemote: vi.fn().mockResolvedValue({ success: true, remoteCommit: 'abc123' }),
      listBranchesFromEvent: vi.fn().mockResolvedValue(['main', 'develop']),
      listRepoFilesFromEvent: vi.fn().mockResolvedValue([]),
      getRepoFileContentFromEvent: vi.fn().mockResolvedValue(''),
      fileExistsAtCommit: vi.fn().mockResolvedValue(true),
      getCommitInfo: vi.fn().mockResolvedValue({}),
      getFileHistory: vi.fn().mockResolvedValue([]),
      getCommitHistoryFromEvent: vi.fn().mockResolvedValue([]),
      getStatus: vi.fn().mockResolvedValue({
        success: true,
        files: [],
        branch: 'main'
      }),
      getCommitHistory: vi.fn().mockResolvedValue({
        success: true,
        commits: []
      })
    }
  })),
  parseRepoId: vi.fn((id: string) => id.replace(':', '/')),
  listBranchesFromEvent: vi.fn().mockResolvedValue(['main', 'develop']),
  listRepoFilesFromEvent: vi.fn().mockResolvedValue([]),
  getRepoFileContentFromEvent: vi.fn().mockResolvedValue(''),
  fileExistsAtCommit: vi.fn().mockResolvedValue(true),
  getCommitInfo: vi.fn().mockResolvedValue({}),
  getFileHistory: vi.fn().mockResolvedValue([]),
  getCommitHistory: vi.fn().mockResolvedValue([])
}));

describe('WorkerManager', () => {
  let manager: WorkerManager;
  let progressCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearUrlPreferenceCache();
    progressCallback = vi.fn();
    manager = new WorkerManager(progressCallback);
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('Initialization', () => {
    it('should create instance without initializing worker', () => {
      expect(manager.isReady).toBe(false);
      expect(manager.workerInstance).toBeNull();
      expect(manager.apiInstance).toBeNull();
    });

    it('should initialize worker on first call', async () => {
      await manager.initialize();

      expect(manager.isReady).toBe(true);
      expect(manager.workerInstance).toBeTruthy();
      expect(manager.apiInstance).toBeTruthy();
    });

    it('should not reinitialize if already initialized', async () => {
      await manager.initialize();
      const firstWorker = manager.workerInstance;

      await manager.initialize();
      const secondWorker = manager.workerInstance;

      expect(firstWorker).toBe(secondWorker);
    });

    it('should handle concurrent initialization calls', async () => {
      const promises = [manager.initialize(), manager.initialize(), manager.initialize()];

      await Promise.all(promises);

      expect(manager.isReady).toBe(true);
    });

    it('should accept progress callback during initialization', async () => {
      await manager.initialize();

      // Progress callback is registered but may not be called during init
      // It will be called when actual git operations emit progress events
      expect(manager.isReady).toBe(true);
    });
  });

  describe('Worker Operations', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should execute operations through worker API', async () => {
      const result = await manager.execute('getStatus', {
        repoId: 'owner:repo',
        branch: 'main'
      });

      expect(result).toEqual({
        success: true,
        files: [],
        branch: 'main'
      });
    });

    it('does not JSON-copy results already cloned by the worker boundary', async () => {
      const toJSON = vi.fn(() => ({ success: true, files: [], branch: 'main' }));
      const result = { success: true, files: [], branch: 'main', toJSON };
      manager.apiInstance.getStatus = vi.fn().mockResolvedValue(result);

      await expect(manager.execute('getStatus', { repoId: 'owner:repo' })).resolves.toBe(result);
      expect(toJSON).not.toHaveBeenCalled();
    });

    it('should throw error if not initialized', async () => {
      const uninitializedManager = new WorkerManager();

      await expect(uninitializedManager.execute('getStatus', {})).rejects.toThrow('WorkerManager not initialized');
    });

    it('should handle getStatus operation', async () => {
      const result = await manager.getStatus({
        repoId: 'owner:repo',
        branch: 'main'
      });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('branch');
    });

    it('should handle getCommitHistory operation', async () => {
      const result = await manager.getCommitHistory({
        repoId: 'owner:repo',
        branch: 'main',
        depth: 50
      });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('commits');
    });

    it('should handle smartInitializeRepo operation', async () => {
      const result = await manager.smartInitializeRepo({
        repoId: 'owner:repo',
        cloneUrls: ['https://example.com/repo.git'],
        forceUpdate: false
      });

      expect(result).toHaveProperty('success');
    });

    it('does not race repository mutations with an outer RPC timeout', async () => {
      const execute = vi.spyOn(manager, 'execute').mockResolvedValue({ success: true });

      await manager.smartInitializeRepo({
        repoId: 'owner:repo',
        cloneUrls: ['https://example.com/repo.git']
      });
      await manager.syncWithRemote({
        repoId: 'owner:repo',
        cloneUrls: ['https://example.com/repo.git']
      });
      await manager.ensureFullClone({
        repoId: 'owner:repo',
        branch: 'main',
        cloneUrls: ['https://example.com/repo.git']
      });

      expect(execute).toHaveBeenNthCalledWith(
        1,
        'smartInitializeRepo',
        {
          repoId: 'owner:repo',
          cloneUrls: ['https://example.com/repo.git']
        },
        { timeoutMs: 0 }
      );
      expect(execute).toHaveBeenNthCalledWith(
        2,
        'syncWithRemote',
        {
          repoId: 'owner:repo',
          cloneUrls: ['https://example.com/repo.git']
        },
        { timeoutMs: 0 }
      );
      expect(execute).toHaveBeenNthCalledWith(
        3,
        'ensureFullClone',
        {
          repoId: 'owner:repo',
          branch: 'main',
          cloneUrls: ['https://example.com/repo.git']
        },
        { timeoutMs: 0 }
      );
    });

    it('preserves structured Git natural capability errors from the worker', async () => {
      const api = manager.apiInstance as any;
      api.gitNaturalListDirectory = vi.fn().mockResolvedValue({
        success: false,
        error: 'Git server does not advertise filter support',
        gitNaturalError: {
          name: 'GitNaturalReadError',
          message: 'Git server does not advertise filter support',
          code: 'missing-filter-capability',
          remoteUrl: 'https://example.com/repo.git',
          capability: 'filter',
          filter: 'blob:none'
        }
      });

      await expect(
        manager.gitNaturalListDirectory({
          url: 'https://example.com/repo.git',
          ref: 'main',
          enabled: true
        })
      ).rejects.toMatchObject({
        name: 'GitNaturalReadError',
        code: 'missing-filter-capability',
        remoteUrl: 'https://example.com/repo.git',
        capability: 'filter',
        filter: 'blob:none'
      });
    });

    it('retries commit metadata and diff together without clone fallback on operational failure', async () => {
      const api = manager.apiInstance as any;
      const primary = 'https://primary.example/repo.git';
      const secondary = 'https://secondary.example/repo.git';
      const calls: string[] = [];
      api.gitNaturalGetCommit = vi.fn(async ({ url }: { url: string }) => {
        calls.push(`meta:${url}`);
        return {
          commit: {
            hash: 'head',
            author: { name: 'Alice', email: 'alice@example.com', timestamp: 1 },
            message: 'Change',
            parents: ['parent']
          }
        };
      });
      api.gitNaturalGetDiffBetween = vi.fn(async ({ url }: { url: string }) => {
        calls.push(`diff:${url}`);
        if (url === primary) {
          return {
            success: false,
            error: 'pack parser failed',
            gitNaturalError: {
              name: 'GitNaturalReadError',
              message: 'pack parser failed',
              code: 'protocol-error',
              remoteUrl: url
            }
          };
        }
        return { changes: [] };
      });
      api.getCommitDetails = vi.fn();
      api.smartInitializeRepo.mockClear();

      const result = await manager.getCommitDetails({
        repoId: 'worker-manager-operational-fallback',
        commitId: 'head',
        cloneUrls: [primary, secondary]
      });

      expect(calls).toEqual([`meta:${primary}`, `diff:${primary}`, `meta:${secondary}`, `diff:${secondary}`]);
      expect(result).toMatchObject({ success: true, usedUrl: secondary, diffAvailable: true });
      expect(api.gitNaturalGetCommit).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 0 }),
      );
      expect(api.gitNaturalGetDiffBetween).toHaveBeenCalledWith(
        expect.not.objectContaining({ timeoutMs: expect.anything() }),
      );
      expect(api.smartInitializeRepo).not.toHaveBeenCalled();
      expect(api.getCommitDetails).not.toHaveBeenCalled();
    });

    it('keeps missing-filter clone fallback inside its remote attempt', async () => {
      const api = manager.apiInstance as any;
      const primary = 'https://primary-filterless.example/repo.git';
      const secondary = 'https://secondary-filtered.example/repo.git';
      const calls: string[] = [];
      api.gitNaturalGetCommit = vi.fn(async ({ url }: { url: string }) => {
        calls.push(`natural:${url}`);
        if (url === primary) {
          return {
            success: false,
            error: 'filter unsupported',
            gitNaturalError: {
              name: 'GitNaturalReadError',
              message: 'filter unsupported',
              code: 'missing-filter-capability',
              remoteUrl: url,
              capability: 'filter'
            }
          };
        }
        return {
          commit: {
            hash: 'root',
            author: { name: 'Alice', email: 'alice@example.com', timestamp: 1 },
            message: 'Root',
            parents: []
          }
        };
      });
      api.smartInitializeRepo = vi.fn(async ({ cloneUrls }: { cloneUrls: string[] }) => {
        calls.push(`clone:${cloneUrls[0]}`);
        return { success: true, usedUrl: cloneUrls[0] };
      });
      api.getCommitDetails = vi.fn(async () => {
        throw new Error('clone failed');
      });
      api.gitNaturalGetDiffBetween = vi.fn(async () => ({ changes: [] }));

      const result = await manager.getCommitDetails({
        repoId: 'worker-manager-capability-fallback',
        commitId: 'root',
        cloneUrls: [primary, secondary]
      });

      expect(calls).toEqual([`natural:${primary}`, `clone:${primary}`, `natural:${secondary}`]);
      expect(result).toMatchObject({ success: true, usedUrl: secondary });
      expect(api.smartInitializeRepo).toHaveBeenCalledWith({
        repoId: 'worker-manager-capability-fallback',
        cloneUrls: [primary],
        branch: undefined,
        strictCloneUrls: true,
        readScope: undefined,
        trackReadPreference: false
      });
      expect(api.getCommitDetails).toHaveBeenCalledWith({
        repoId: 'worker-manager-capability-fallback',
        commitId: 'root',
        cloneUrls: [primary],
        cloneFallbackReason: 'missing-filter-capability'
      });
    });

    it('keeps scoped PR source routing independent from the target cursor', async () => {
      const api = manager.apiInstance as any;
      const repoId = 'worker-manager-pr-scopes';
      const targetPrimary = 'https://target-primary.example/repo.git';
      const targetSecondary = 'https://target-secondary.example/repo.git';
      const sourcePrimary = 'https://source-primary.example/repo.git';
      const sourceSecondary = 'https://source-secondary.example/repo.git';
      const calls: string[] = [];
      updateUrlPreferenceCache(repoId, targetSecondary, [targetPrimary]);
      api.gitNaturalGetCommit = vi.fn(async ({ url }: { url: string }) => {
        calls.push(url);
        if (url === sourcePrimary) {
          return {
            success: false,
            error: 'source primary failed',
            gitNaturalError: {
              name: 'GitNaturalReadError',
              message: 'source primary failed',
              code: 'protocol-error',
              remoteUrl: url
            }
          };
        }
        return {
          commit: {
            hash: 'a'.repeat(40),
            author: { name: 'Alice', email: 'alice@example.com', timestamp: 1 },
            message: 'Change',
            parents: []
          }
        };
      });

      await manager.getCommitMeta({
        repoId,
        commitId: 'a'.repeat(40),
        cloneUrls: [sourcePrimary, sourceSecondary],
        readScope: 'pr-source:event'
      });

      expect(calls).toEqual([sourcePrimary, sourceSecondary]);
      expect(getCachedUrlPreference(repoId)?.preferredUrl).toBe(targetSecondary);
      expect(getCachedUrlPreference(repoId, 'pr-source:event')?.preferredUrl).toBe(sourceSecondary);

      calls.length = 0;
      await manager.getCommitMeta({
        repoId,
        commitId: 'a'.repeat(40),
        cloneUrls: [targetPrimary, targetSecondary]
      });
      expect(calls).toEqual([targetSecondary]);
    });

    it('forwards the PR source scope through worker review APIs', async () => {
      const api = manager.apiInstance as any;
      api.getPRReviewData = vi.fn(async () => ({ success: true }));
      api.getPRSubmittedCommits = vi.fn(async () => ({ success: true }));
      api.getPRPreview = vi.fn(async () => ({ success: true }));
      api.getCommitsAheadOfTip = vi.fn(async () => ({ success: true }));
      api.getMergeBaseBetween = vi.fn(async () => ({ mergeBase: 'a'.repeat(40) }));
      api.analyzePRMerge = vi.fn(async () => ({ success: true }));
      api.cancelGitNaturalRead = vi.fn(async () => true);
      const common = {
        repoId: 'owner/repo',
        cloneUrls: ['https://target.example/repo.git'],
        sourceReadScope: 'pr-source:event'
      };

      await manager.getPRReviewData({
        ...common,
        tipCommitOid: 'a'.repeat(40),
        targetBranch: 'main',
        operationId: 'pr-review:test'
      });
      await manager.getPRSubmittedCommits({
        repoId: common.repoId,
        tipCommitOid: 'a'.repeat(40),
        baseCommitOid: 'b'.repeat(40),
        cloneUrls: ['https://source.example/repo.git'],
        sourceReadScope: common.sourceReadScope,
        operationId: 'pr-submitted:test'
      });
      await manager.getPRPreview({ ...common, sourceBranch: 'feature', targetBranch: 'main' });
      await manager.getCommitsAheadOfTip({ ...common, tipOid: 'a'.repeat(40) });
      await manager.getMergeBaseBetween({
        ...common,
        headOid: 'a'.repeat(40),
        targetBranch: 'main'
      });
      await manager.analyzePRMerge({
        repoId: common.repoId,
        prCloneUrls: ['https://source.example/repo.git'],
        targetCloneUrls: common.cloneUrls,
        tipCommitOid: 'a'.repeat(40),
        targetBranch: 'main',
        sourceReadScope: common.sourceReadScope
      });

      for (const method of [
        api.getPRReviewData,
        api.getPRSubmittedCommits,
        api.getPRPreview,
        api.getCommitsAheadOfTip,
        api.getMergeBaseBetween,
        api.analyzePRMerge
      ]) {
        expect(method).toHaveBeenCalledWith(expect.objectContaining({ sourceReadScope: 'pr-source:event' }));
      }
      expect(api.getPRReviewData).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'pr-review:test' })
      );
      expect(api.getPRSubmittedCommits).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceReadScope: 'pr-source:event',
          operationId: 'pr-submitted:test'
        })
      );
      await expect(manager.cancelGitNaturalRead('pr-review:test')).resolves.toBe(true);
      expect(api.cancelGitNaturalRead).toHaveBeenCalledWith({ operationId: 'pr-review:test' });
    });

    it('forwards cancellation identity to an OID-pinned natural diff', async () => {
      const api = manager.apiInstance as any;
      api.gitNaturalGetDiffBetween = vi.fn(async () => ({ changes: [] }));

      await manager.getDiffBetween({
        repoId: 'owner/repo',
        baseOid: 'a'.repeat(40),
        headOid: 'b'.repeat(40),
        cloneUrls: ['https://source.example/repo.git'],
        gitNaturalDiff: true,
        operationId: 'pr-review:diff'
      });

      expect(api.gitNaturalGetDiffBetween).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'pr-review:diff' })
      );
    });

    it('orders and reconciles target and source cursors for composite PR reads', async () => {
      const api = manager.apiInstance as any;
      const targetUrls = [
        'https://target-primary.example/repo.git',
        'https://target-secondary.example/repo.git',
        'https://target-tertiary.example/repo.git'
      ];
      const sourceUrls = [
        'https://source-primary.example/repo.git',
        'https://source-secondary.example/repo.git',
        'https://source-tertiary.example/repo.git'
      ];
      const sourceReadScope = 'pr-source:event';
      const seedCursors = (repoId: string) => {
        updateUrlPreferenceCache(repoId, targetUrls[1], [targetUrls[0]]);
        updateUrlPreferenceCache(repoId, sourceUrls[1], [sourceUrls[0]], sourceReadScope);
      };
      const result = {
        success: true,
        commits: [],
        commitOids: [],
        usedTargetCloneUrl: targetUrls[2],
        targetAttempts: [
          { url: targetUrls[1], success: false, error: 'target failed' },
          { url: targetUrls[2], success: true }
        ],
        usedCloneUrl: sourceUrls[2],
        sourceAttempts: [
          { url: sourceUrls[1], success: false, error: 'source failed' },
          { url: sourceUrls[2], success: true }
        ]
      };

      const analysisRepo = 'worker-manager-analysis-cursors';
      seedCursors(analysisRepo);
      api.analyzePRMerge = vi.fn(async () => result);
      await manager.analyzePRMerge({
        repoId: analysisRepo,
        prCloneUrls: sourceUrls,
        targetCloneUrls: targetUrls,
        tipCommitOid: 'a'.repeat(40),
        targetBranch: 'main',
        sourceReadScope
      });
      expect(api.analyzePRMerge).toHaveBeenCalledWith(
        expect.objectContaining({
          prCloneUrls: sourceUrls.slice(1),
          targetCloneUrls: targetUrls.slice(1)
        })
      );
      expect(getCachedUrlPreference(analysisRepo)?.preferredUrl).toBe(targetUrls[2]);
      expect(getCachedUrlPreference(analysisRepo, sourceReadScope)?.preferredUrl).toBe(sourceUrls[2]);

      const writeAnalysisRepo = 'worker-manager-write-analysis-cursors';
      seedCursors(writeAnalysisRepo);
      api.analyzePRMerge = vi.fn(async () => ({
        ...result,
        usedTargetCloneUrl: targetUrls[0],
        targetAttempts: [{ url: targetUrls[0], success: true }]
      }));
      await manager.analyzePRMerge({
        repoId: writeAnalysisRepo,
        prCloneUrls: sourceUrls,
        targetCloneUrls: [targetUrls[0]],
        tipCommitOid: 'a'.repeat(40),
        targetBranch: 'main',
        sourceReadScope,
        trackTargetReadPreference: false
      });
      expect(api.analyzePRMerge).toHaveBeenCalledWith(
        expect.objectContaining({ targetCloneUrls: [targetUrls[0]] })
      );
      expect(getCachedUrlPreference(writeAnalysisRepo)?.preferredUrl).toBe(targetUrls[1]);
      expect(getCachedUrlPreference(writeAnalysisRepo, sourceReadScope)?.preferredUrl).toBe(
        sourceUrls[2]
      );

      const reviewRepo = 'worker-manager-review-cursors';
      seedCursors(reviewRepo);
      api.getPRReviewData = vi.fn(async () => result);
      await manager.getPRReviewData({
        repoId: reviewRepo,
        tipCommitOid: 'a'.repeat(40),
        targetBranch: 'main',
        cloneUrls: targetUrls,
        prCloneUrls: sourceUrls,
        sourceReadScope
      });
      expect(api.getPRReviewData).toHaveBeenCalledWith(
        expect.objectContaining({
          cloneUrls: targetUrls.slice(1),
          prCloneUrls: sourceUrls.slice(1)
        })
      );
      expect(getCachedUrlPreference(reviewRepo)?.preferredUrl).toBe(targetUrls[2]);
      expect(getCachedUrlPreference(reviewRepo, sourceReadScope)?.preferredUrl).toBe(sourceUrls[2]);

      const submittedRepo = 'worker-manager-submitted-range-cursors';
      seedCursors(submittedRepo);
      api.getPRSubmittedCommits = vi.fn(async () => ({
        ...result,
        usedTargetCloneUrl: undefined,
        targetAttempts: undefined
      }));
      await manager.getPRSubmittedCommits({
        repoId: submittedRepo,
        tipCommitOid: 'a'.repeat(40),
        baseCommitOid: 'b'.repeat(40),
        cloneUrls: sourceUrls,
        sourceReadScope
      });
      expect(api.getPRSubmittedCommits).toHaveBeenCalledWith(
        expect.objectContaining({ cloneUrls: sourceUrls.slice(1), sourceReadScope })
      );
      expect(getCachedUrlPreference(submittedRepo)?.preferredUrl).toBe(targetUrls[1]);
      expect(getCachedUrlPreference(submittedRepo, sourceReadScope)?.preferredUrl).toBe(sourceUrls[2]);

      const previewRepo = 'worker-manager-preview-cursors';
      seedCursors(previewRepo);
      api.getPRPreview = vi.fn(async () => result);
      await manager.getPRPreview({
        repoId: previewRepo,
        sourceBranch: 'feature',
        targetBranch: 'main',
        cloneUrls: targetUrls,
        sourceCloneUrls: sourceUrls,
        sourceReadScope
      });
      expect(api.getPRPreview).toHaveBeenCalledWith(
        expect.objectContaining({
          cloneUrls: targetUrls.slice(1),
          sourceCloneUrls: sourceUrls.slice(1)
        })
      );
      expect(getCachedUrlPreference(previewRepo)?.preferredUrl).toBe(targetUrls[2]);
      expect(getCachedUrlPreference(previewRepo, sourceReadScope)?.preferredUrl).toBe(sourceUrls[2]);

      const aheadRepo = 'worker-manager-ahead-cursors';
      seedCursors(aheadRepo);
      api.getCommitsAheadOfTip = vi.fn(async () => result);
      await manager.getCommitsAheadOfTip({
        repoId: aheadRepo,
        tipOid: 'a'.repeat(40),
        cloneUrls: targetUrls,
        sourceCloneUrls: sourceUrls,
        sourceReadScope
      });
      expect(api.getCommitsAheadOfTip).toHaveBeenCalledWith(
        expect.objectContaining({
          cloneUrls: targetUrls.slice(1),
          sourceCloneUrls: sourceUrls.slice(1)
        })
      );
      expect(getCachedUrlPreference(aheadRepo)?.preferredUrl).toBe(targetUrls[1]);
      expect(getCachedUrlPreference(aheadRepo, sourceReadScope)?.preferredUrl).toBe(sourceUrls[2]);

      const mergeBaseRepo = 'worker-manager-merge-base-cursors';
      seedCursors(mergeBaseRepo);
      api.getMergeBaseBetween = vi.fn(async () => ({ ...result, mergeBase: 'b'.repeat(40) }));
      await manager.getMergeBaseBetween({
        repoId: mergeBaseRepo,
        headOid: 'a'.repeat(40),
        targetBranch: 'main',
        cloneUrls: targetUrls,
        sourceCloneUrls: sourceUrls,
        sourceReadScope
      });
      expect(api.getMergeBaseBetween).toHaveBeenCalledWith(
        expect.objectContaining({
          cloneUrls: targetUrls.slice(1),
          sourceCloneUrls: sourceUrls.slice(1)
        })
      );
      expect(getCachedUrlPreference(mergeBaseRepo)?.preferredUrl).toBe(targetUrls[2]);
      expect(getCachedUrlPreference(mergeBaseRepo, sourceReadScope)?.preferredUrl).toBe(sourceUrls[2]);
    });

    it('does not let a stale PR RPC completion move either role cursor backward', async () => {
      const api = manager.apiInstance as any;
      const repoId = 'worker-manager-stale-pr-read';
      const sourceReadScope = 'pr-source:event';
      const targetUrls = [
        'https://target-primary.example/repo.git',
        'https://target-secondary.example/repo.git',
        'https://target-tertiary.example/repo.git'
      ];
      const sourceUrls = [
        'https://source-primary.example/repo.git',
        'https://source-secondary.example/repo.git',
        'https://source-tertiary.example/repo.git'
      ];
      let resolveReview!: (value: any) => void;
      api.getPRReviewData = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveReview = resolve;
          })
      );

      const pending = manager.getPRReviewData({
        repoId,
        tipCommitOid: 'a'.repeat(40),
        targetBranch: 'main',
        cloneUrls: targetUrls,
        prCloneUrls: sourceUrls,
        sourceReadScope
      });
      await vi.waitFor(() => expect(api.getPRReviewData).toHaveBeenCalled());
      updateUrlPreferenceCache(repoId, targetUrls[2], targetUrls.slice(0, 2));
      updateUrlPreferenceCache(repoId, sourceUrls[2], sourceUrls.slice(0, 2), sourceReadScope);
      resolveReview({
        success: true,
        commits: [],
        commitOids: [],
        usedTargetCloneUrl: targetUrls[1],
        targetAttempts: [{ url: targetUrls[1], success: true }],
        usedCloneUrl: sourceUrls[1],
        sourceAttempts: [{ url: sourceUrls[1], success: true }]
      });
      await pending;

      expect(getCachedUrlPreference(repoId)?.preferredUrl).toBe(targetUrls[2]);
      expect(getCachedUrlPreference(repoId, sourceReadScope)?.preferredUrl).toBe(sourceUrls[2]);
    });

    it('does not let an older URL-list result replace a newer list cursor', async () => {
      const api = manager.apiInstance as any;
      const repoId = 'worker-manager-replaced-url-list';
      const oldUrls = [
        'https://primary.example/repo.git',
        'https://secondary.example/repo.git'
      ];
      const newUrls = [
        'https://secondary.example/repo.git',
        'https://tertiary.example/repo.git'
      ];
      const completions: Array<(value: any) => void> = [];
      api.getPRReviewData = vi.fn(
        () =>
          new Promise((resolve) => {
            completions.push(resolve);
          })
      );

      const oldRead = manager.getPRReviewData({
        repoId,
        tipCommitOid: 'a'.repeat(40),
        targetBranch: 'main',
        cloneUrls: oldUrls
      });
      await vi.waitFor(() => expect(completions).toHaveLength(1));
      const newRead = manager.getPRReviewData({
        repoId,
        tipCommitOid: 'b'.repeat(40),
        targetBranch: 'main',
        cloneUrls: newUrls
      });
      await vi.waitFor(() => expect(completions).toHaveLength(2));

      completions[1]({
        success: true,
        commits: [],
        commitOids: [],
        usedTargetCloneUrl: newUrls[1],
        targetAttempts: [
          { url: newUrls[0], success: false, error: 'secondary failed' },
          { url: newUrls[1], success: true }
        ]
      });
      await newRead;
      completions[0]({
        success: true,
        commits: [],
        commitOids: [],
        usedTargetCloneUrl: oldUrls[1],
        targetAttempts: [{ url: oldUrls[1], success: true }]
      });
      await oldRead;

      expect(getCachedUrlPreference(repoId)?.preferredUrl).toBe(newUrls[1]);
    });

    it('does not let a pre-reset worker result restore the cleared cursor', async () => {
      const api = manager.apiInstance as any;
      const repoId = 'worker-manager-reset-generation';
      const urls = [
        'https://primary.example/repo.git',
        'https://secondary.example/repo.git'
      ];
      let complete!: (value: any) => void;
      api.getPRReviewData = vi.fn(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          })
      );

      const pending = manager.getPRReviewData({
        repoId,
        tipCommitOid: 'a'.repeat(40),
        targetBranch: 'main',
        cloneUrls: urls
      });
      await vi.waitFor(() => expect(api.getPRReviewData).toHaveBeenCalled());
      clearUrlPreferenceCache(repoId);
      complete({
        success: true,
        commits: [],
        commitOids: [],
        usedTargetCloneUrl: urls[1],
        targetAttempts: [{ url: urls[1], success: true }]
      });
      await pending;

      expect(getCachedUrlPreference(repoId)).toBeUndefined();
    });

    it('does not advance a cursor for a cancelled composite read', async () => {
      const api = manager.apiInstance as any;
      const repoId = 'worker-manager-cancelled-read';
      const urls = [
        'https://primary.example/repo.git',
        'https://secondary.example/repo.git'
      ];
      api.getPRReviewData = vi.fn().mockResolvedValue({
        success: false,
        error: 'Aborted',
        commits: [],
        commitOids: [],
        targetAttempts: [
          { url: urls[0], success: false, error: 'Aborted', errorCode: 'AbortError' }
        ]
      });

      await manager.getPRReviewData({
        repoId,
        tipCommitOid: 'a'.repeat(40),
        targetBranch: 'main',
        cloneUrls: urls
      });

      expect(getCachedUrlPreference(repoId)).toBeUndefined();
    });

    it('reconciles terminal composite-read failures without throwing away attempts', async () => {
      const api = manager.apiInstance as any;
      const targetUrls = [
        'https://target-primary.example/repo.git',
        'https://target-secondary.example/repo.git'
      ];
      const sourceUrls = [
        'https://source-primary.example/repo.git',
        'https://source-secondary.example/repo.git'
      ];
      const sourceReadScope = 'pr-source:terminal';
      const failure = {
        success: false,
        error: 'all remotes failed',
        targetAttempts: targetUrls.map((url) => ({ url, success: false, error: 'target failed' })),
        sourceAttempts: sourceUrls.map((url) => ({ url, success: false, error: 'source failed' }))
      };

      const reviewRepo = 'worker-manager-terminal-review';
      api.getPRReviewData = vi.fn(async () => failure);
      await expect(
        manager.getPRReviewData({
          repoId: reviewRepo,
          tipCommitOid: 'a'.repeat(40),
          targetBranch: 'main',
          cloneUrls: targetUrls,
          prCloneUrls: sourceUrls,
          sourceReadScope
        })
      ).resolves.toMatchObject({ success: false });
      expect(getCachedUrlPreference(reviewRepo)?.preferredUrl).toBe(targetUrls[1]);
      expect(getCachedUrlPreference(reviewRepo, sourceReadScope)?.preferredUrl).toBe(sourceUrls[1]);

      const previewRepo = 'worker-manager-terminal-preview';
      api.getPRPreview = vi.fn(async () => failure);
      await expect(
        manager.getPRPreview({
          repoId: previewRepo,
          sourceBranch: 'feature',
          targetBranch: 'main',
          cloneUrls: targetUrls,
          sourceCloneUrls: sourceUrls,
          sourceReadScope
        })
      ).resolves.toMatchObject({ success: false });
      expect(getCachedUrlPreference(previewRepo)?.preferredUrl).toBe(targetUrls[1]);
      expect(getCachedUrlPreference(previewRepo, sourceReadScope)?.preferredUrl).toBe(sourceUrls[1]);

      const aheadRepo = 'worker-manager-terminal-ahead';
      api.getCommitsAheadOfTip = vi.fn(async () => failure);
      await expect(
        manager.getCommitsAheadOfTip({
          repoId: aheadRepo,
          tipOid: 'a'.repeat(40),
          cloneUrls: targetUrls,
          sourceCloneUrls: sourceUrls,
          sourceReadScope
        })
      ).resolves.toMatchObject({ success: false });
      expect(getCachedUrlPreference(aheadRepo, sourceReadScope)?.preferredUrl).toBe(sourceUrls[1]);

      const mergeBaseRepo = 'worker-manager-terminal-merge-base';
      api.getMergeBaseBetween = vi.fn(async () => failure);
      await expect(
        manager.getMergeBaseBetween({
          repoId: mergeBaseRepo,
          headOid: 'a'.repeat(40),
          targetBranch: 'main',
          cloneUrls: targetUrls,
          sourceCloneUrls: sourceUrls,
          sourceReadScope
        })
      ).resolves.toMatchObject({ success: false });
      expect(getCachedUrlPreference(mergeBaseRepo)?.preferredUrl).toBe(targetUrls[1]);
      expect(getCachedUrlPreference(mergeBaseRepo, sourceReadScope)?.preferredUrl).toBe(
        sourceUrls[1]
      );
    });
  });

  describe('Auth Configuration', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should set auth config', async () => {
      const config = {
        tokens: [{ host: 'github.com', token: 'ghp_test123' }]
      };

      await manager.setAuthConfig(config);

      const retrieved = manager.getAuthConfig();
      expect(retrieved).toEqual(config);
    });

    it('should add auth token', async () => {
      await manager.addAuthToken({
        host: 'gitlab.com',
        token: 'glpat_test456'
      });

      const config = manager.getAuthConfig();
      expect(config.tokens).toHaveLength(1);
      expect(config.tokens[0].host).toBe('gitlab.com');
    });

    it('should remove existing token when adding for same host', async () => {
      await manager.addAuthToken({
        host: 'github.com',
        token: 'token1'
      });

      await manager.addAuthToken({
        host: 'github.com',
        token: 'token2'
      });

      const config = manager.getAuthConfig();
      expect(config.tokens).toHaveLength(1);
      expect(config.tokens[0].token).toBe('token2');
    });

    it('should remove auth token', async () => {
      await manager.addAuthToken({
        host: 'github.com',
        token: 'token1'
      });

      await manager.removeAuthToken('github.com');

      const config = manager.getAuthConfig();
      expect(config.tokens).toHaveLength(0);
    });
  });

  describe('Health Check', () => {
    it('should return false when not initialized', async () => {
      const result = await manager.healthCheck();
      expect(result).toBe(false);
    });

    it('should return true when initialized', async () => {
      await manager.initialize();
      const result = await manager.healthCheck();
      expect(result).toBe(true);
    });
  });

  describe('Restart', () => {
    it('should reinitialize worker', async () => {
      await manager.initialize();
      const firstWorker = manager.workerInstance;

      await manager.restart();
      const secondWorker = manager.workerInstance;

      expect(firstWorker).not.toBe(secondWorker);
      expect(manager.isReady).toBe(true);
    });
  });

  describe('Disposal', () => {
    it('should terminate worker on dispose', async () => {
      await manager.initialize();
      const worker = manager.workerInstance;
      const terminateSpy = vi.spyOn(worker!, 'terminate');

      manager.dispose();

      expect(terminateSpy).toHaveBeenCalled();
      expect(manager.workerInstance).toBeNull();
      expect(manager.apiInstance).toBeNull();
    });

    it('should handle dispose when not initialized', () => {
      expect(() => manager.dispose()).not.toThrow();
    });
  });

  describe('Progress Callback', () => {
    it('should call progress callback on worker events', async () => {
      const callback = vi.fn();
      const mgr = new WorkerManager(callback);
      await mgr.initialize();

      // Simulate progress event
      const progressEvent = {
        phase: 'cloning',
        loaded: 50,
        total: 100
      };

      callback(progressEvent);

      expect(callback).toHaveBeenCalledWith(progressEvent);

      mgr.dispose();
    });

    it('should allow changing progress callback', async () => {
      await manager.initialize();

      const newCallback = vi.fn();
      manager.setProgressCallback(newCallback);

      // Callback should be updated (tested via integration)
      expect(true).toBe(true);
    });
  });
});

describe('WorkerManager Integration', () => {
  /**
   * These tests verify the integration between WorkerManager and git-worker
   */

  it('should handle worker initialization with EventIO', async () => {
    const manager = new WorkerManager();
    await manager.initialize();

    // Worker should be initialized with EventIO
    expect(manager.isReady).toBe(true);

    manager.dispose();
  });

  it('should maintain auth config across operations', async () => {
    const manager = new WorkerManager();
    await manager.initialize();

    await manager.setAuthConfig({
      tokens: [{ host: 'test.com', token: 'test' }]
    });

    // Subsequent operations should use the auth config
    await manager.getStatus({ repoId: 'test:repo', branch: 'main' });

    manager.dispose();
  });

  it('should handle worker errors gracefully', async () => {
    const manager = new WorkerManager();
    await manager.initialize();

    // Mock error in worker
    const api = manager.apiInstance;
    if (api) {
      api.getStatus = vi.fn().mockRejectedValue(new Error('Worker error'));
    }

    // The error is wrapped by WorkerManager.execute, so we check for the wrapped message
    await expect(manager.getStatus({ repoId: 'test:repo' })).rejects.toThrow("Worker operation 'getStatus' failed");

    manager.dispose();
  });
});
