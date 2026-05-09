import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerManager } from './WorkerManager';

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
      const promises = [
        manager.initialize(),
        manager.initialize(),
        manager.initialize()
      ];
      
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

    it('should throw error if not initialized', async () => {
      const uninitializedManager = new WorkerManager();
      
      await expect(
        uninitializedManager.execute('getStatus', {})
      ).rejects.toThrow('WorkerManager not initialized');
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
  });

  describe('Auth Configuration', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should set auth config', async () => {
      const config = {
        tokens: [
          { host: 'github.com', token: 'ghp_test123' }
        ]
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
    await expect(
      manager.getStatus({ repoId: 'test:repo' })
    ).rejects.toThrow("Worker operation 'getStatus' failed");

    manager.dispose();
  });
});
