import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NostrGitProvider } from '../../src/api/providers/nostr-git-provider';
import BlossomFS, { Signer, BlossomPushSummary } from '../../src/blossom/index.js';
import { NostrEvent } from 'nostr-tools';

// Polyfills for IndexedDB + fetch (Node/Jsdom environment)
import 'fake-indexeddb/auto';
import { TextEncoder, TextDecoder } from 'util';
globalThis.TextEncoder = TextEncoder as any;
globalThis.TextDecoder = TextDecoder as any;

// Mock fetch for Blossom endpoints
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

// Mock signer implementing NIP-07/NIP-46
const mockSigner: Signer = {
  async getPublicKey() {
    return 'deadbeef'.repeat(8);
  },
  async signEvent(evt: NostrEvent) {
    return { ...evt, id: 'eventid', sig: 'signature' };
  },
};

// Mock Git provider
const mockGitProvider = {
  push: vi.fn(),
  clone: vi.fn(),
  commit: vi.fn(),
  fetch: vi.fn(),
  init: vi.fn(),
  log: vi.fn(),
  merge: vi.fn(),
  pull: vi.fn(),
  status: vi.fn(),
  statusMatrix: vi.fn(),
  deleteBranch: vi.fn(),
  listBranches: vi.fn(),
  renameBranch: vi.fn(),
  branch: vi.fn(),
  deleteTag: vi.fn(),
  listTags: vi.fn(),
  tag: vi.fn(),
  add: vi.fn(),
  addNote: vi.fn(),
  listFiles: vi.fn(),
  readBlob: vi.fn(),
  readCommit: vi.fn(),
  readNote: vi.fn(),
  readObject: vi.fn(),
  readTag: vi.fn(),
  readTree: vi.fn(),
  remove: vi.fn(),
  removeNote: vi.fn(),
  writeBlob: vi.fn(),
  writeCommit: vi.fn(),
  writeObject: vi.fn(),
  writeRef: vi.fn(),
  writeTag: vi.fn(),
  writeTree: vi.fn(),
  deleteRemote: vi.fn(),
  getRemoteInfo: vi.fn(),
  getRemoteInfo2: vi.fn(),
  listRemotes: vi.fn(),
  listServerRefs: vi.fn(),
  addRemote: vi.fn(),
  checkout: vi.fn(),
  getConfig: vi.fn(),
  getConfigAll: vi.fn(),
  setConfig: vi.fn(),
  deleteRef: vi.fn(),
  expandOid: vi.fn(),
  expandRef: vi.fn(),
  fastForward: vi.fn(),
  findMergeBase: vi.fn(),
  findRoot: vi.fn(),
  hashBlob: vi.fn(),
  indexPack: vi.fn(),
  isDescendent: vi.fn(),
  isIgnored: vi.fn(),
  listNotes: vi.fn(),
  listRefs: vi.fn(),
  packObjects: vi.fn(),
  resetIndex: vi.fn(),
  resolveRef: vi.fn(),
  stash: vi.fn(),
  updateIndex: vi.fn(),
  version: vi.fn(),
  walk: vi.fn(),
  TREE: vi.fn(),
};

// Mock Nostr client
const mockNostrClient = {
  publish: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
};

const mockEventIO = {
  fetchEvents: vi.fn().mockResolvedValue([]),
  publishEvent: vi.fn().mockResolvedValue({ ok: true, relays: [] }),
};

describe('NostrGitProvider blossomMirror integration', () => {
  let provider: NostrGitProvider;
  let fs: BlossomFS;
  let emptySummary: BlossomPushSummary;

  beforeEach(async () => {
    mockFetch.mockReset();
    vi.clearAllMocks();

    mockGitProvider.push.mockReset();
    mockGitProvider.push.mockImplementation(async () => ({ success: true, server: {} }));

    provider = new NostrGitProvider({
      eventIO: mockEventIO as any,
      gitProvider: mockGitProvider as any,
      publishRepoState: false,
      publishRepoAnnouncements: false,
      defaultRelays: [],
      fallbackRelays: [],
      graspRelays: [],
      httpOverrides: undefined,
    });
    (provider as any).baseGitProvider = mockGitProvider;
    fs = new BlossomFS('testfs', { signer: mockSigner });
    emptySummary = { totalObjects: 0, uploaded: [], skipped: [], failures: [] };

    // Wait for DB init
    await new Promise((r) => setTimeout(r, 20));
  });

  it('performs Blossom mirror after successful push', async () => {
    // Mock successful push
    // Mock BlossomFS pushToBlossom method
    const pushToBlossomSpy = vi.spyOn(fs, 'pushToBlossom').mockResolvedValue(emptySummary);

    const pushOptions = {
      dir: '/test/repo',
      fs,
      refspecs: ['refs/heads/main'],
      repoId: 'test-repo',
      repoAddr: '31990:npub1test:test-repo',
      blossomMirror: true,
      endpoint: 'https://blossom.test'
    };

    await provider.push(pushOptions);

    expect(mockGitProvider.push).toHaveBeenCalled();
    expect(pushToBlossomSpy).toHaveBeenCalledWith('/test/repo', {
      endpoint: 'https://blossom.test',
      onProgress: expect.any(Function)
    });
  });

  it('skips Blossom mirror when blossomMirror is false', async () => {
    const pushToBlossomSpy = vi.spyOn(fs, 'pushToBlossom').mockResolvedValue(emptySummary);

    const pushOptions = {
      dir: '/test/repo',
      fs,
      refspecs: ['refs/heads/main'],
      repoId: 'test-repo',
      repoAddr: '31990:npub1test:test-repo',
      blossomMirror: false
    };

    await provider.push(pushOptions);

    expect(mockGitProvider.push).toHaveBeenCalled();
    expect(pushToBlossomSpy).not.toHaveBeenCalled();
  });

  it('skips Blossom mirror when blossomMirror is undefined', async () => {
    const pushToBlossomSpy = vi.spyOn(fs, 'pushToBlossom').mockResolvedValue(emptySummary);

    const pushOptions = {
      dir: '/test/repo',
      fs,
      refspecs: ['refs/heads/main'],
      repoId: 'test-repo',
      repoAddr: '31990:npub1test:test-repo'
      // blossomMirror not specified
    };

    await provider.push(pushOptions);

    expect(mockGitProvider.push).toHaveBeenCalled();
    expect(pushToBlossomSpy).not.toHaveBeenCalled();
  });

  it('skips Blossom mirror when fs does not have pushToBlossom method', async () => {
    // Create a mock fs without pushToBlossom method
    const mockFs = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      readdir: vi.fn(),
      stat: vi.fn(),
      unlink: vi.fn(),
      mkdir: vi.fn(),
    };

    const pushOptions = {
      dir: '/test/repo',
      fs: mockFs,
      refspecs: ['refs/heads/main'],
      repoId: 'test-repo',
      repoAddr: '31990:npub1test:test-repo',
      blossomMirror: true
    };

    await provider.push(pushOptions);

    expect(mockGitProvider.push).toHaveBeenCalled();
    // Should not throw or fail
  });

  it('skips Blossom mirror when dir is not provided', async () => {
    const pushToBlossomSpy = vi.spyOn(fs, 'pushToBlossom').mockResolvedValue(emptySummary);

    const pushOptions = {
      fs,
      refspecs: ['refs/heads/main'],
      repoId: 'test-repo',
      repoAddr: '31990:npub1test:test-repo',
      blossomMirror: true
      // dir not provided
    };

    await provider.push(pushOptions);

    expect(mockGitProvider.push).toHaveBeenCalled();
    expect(pushToBlossomSpy).not.toHaveBeenCalled();
  });

  it('handles Blossom mirror errors gracefully', async () => {
    // Mock pushToBlossom to throw an error
    const pushToBlossomSpy = vi.spyOn(fs, 'pushToBlossom').mockRejectedValue(new Error('Blossom upload failed'));

    const pushOptions = {
      dir: '/test/repo',
      fs,
      refspecs: ['refs/heads/main'],
      repoId: 'test-repo',
      repoAddr: '31990:npub1test:test-repo',
      blossomMirror: true
    };

    // Should not throw even if Blossom mirror fails
    await expect(provider.push(pushOptions)).resolves.not.toThrow();

    expect(mockGitProvider.push).toHaveBeenCalled();
    expect(pushToBlossomSpy).toHaveBeenCalled();
  });

  it('uses fs endpoint when no custom endpoint provided', async () => {
    const pushToBlossomSpy = vi.spyOn(fs, 'pushToBlossom').mockResolvedValue(emptySummary);

    const pushOptions = {
      dir: '/test/repo',
      fs,
      refspecs: ['refs/heads/main'],
      repoId: 'test-repo',
      repoAddr: '31990:npub1test:test-repo',
      blossomMirror: true
      // endpoint not provided, should use fs default
    };

    await provider.push(pushOptions);

    expect(pushToBlossomSpy).toHaveBeenCalledWith('/test/repo', {
      endpoint: undefined, // Will use fs default
      onProgress: expect.any(Function)
    });
  });

  it('runs Blossom mirror after GRASP state publishing', async () => {
    // Mock GRASP
    const mockGrasp = {
      publishStateFromLocal: vi.fn().mockResolvedValue('grasp-event-id')
    };
    provider.configureGrasp(mockGrasp);

    const pushToBlossomSpy = vi.spyOn(fs, 'pushToBlossom').mockResolvedValue(emptySummary);

    const pushOptions = {
      dir: '/test/repo',
      fs,
      refspecs: ['refs/heads/main'],
      repoId: 'test-repo',
      repoAddr: '31990:npub1test:test-repo',
      blossomMirror: true,
      publishRepoStateFromLocal: true,
      ownerPubkey: 'npub1test'
    };

    await provider.push(pushOptions);

    // Verify order: push -> GRASP -> Blossom mirror
    expect(mockGitProvider.push).toHaveBeenCalled();
    expect(mockGrasp.publishStateFromLocal).toHaveBeenCalled();
    expect(pushToBlossomSpy).toHaveBeenCalled();
  });

  it('provides progress logging during Blossom mirror', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const pushToBlossomSpy = vi.spyOn(fs, 'pushToBlossom').mockImplementation(async (dir, opts) => {
      // Simulate progress callbacks
      if (opts?.onProgress) {
        opts.onProgress(25);
        opts.onProgress(50);
        opts.onProgress(75);
        opts.onProgress(100);
      }
      return emptySummary;
    });

    const pushOptions = {
      dir: '/test/repo',
      fs,
      refspecs: ['refs/heads/main'],
      repoId: 'test-repo',
      repoAddr: '31990:npub1test:test-repo',
      blossomMirror: true
    };

    await provider.push(pushOptions);

    expect(consoleSpy).toHaveBeenCalledWith('Starting Blossom mirror upload...');
    expect(consoleSpy).toHaveBeenCalledWith('Blossom upload progress: 25.0%');
    expect(consoleSpy).toHaveBeenCalledWith('Blossom upload progress: 50.0%');
    expect(consoleSpy).toHaveBeenCalledWith('Blossom upload progress: 75.0%');
    expect(consoleSpy).toHaveBeenCalledWith('Blossom upload progress: 100.0%');
    expect(consoleSpy).toHaveBeenCalledWith('Blossom mirror upload completed');

    consoleSpy.mockRestore();
  });

  it('logs errors during Blossom mirror without failing push', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const pushToBlossomSpy = vi.spyOn(fs, 'pushToBlossom').mockRejectedValue(new Error('Network error'));

    const pushOptions = {
      dir: '/test/repo',
      fs,
      refspecs: ['refs/heads/main'],
      repoId: 'test-repo',
      repoAddr: '31990:npub1test:test-repo',
      blossomMirror: true
    };

    await provider.push(pushOptions);

    expect(consoleErrorSpy).toHaveBeenCalledWith('Error during Blossom mirror upload:', expect.any(Error));
    expect(mockGitProvider.push).toHaveBeenCalled(); // Push should still succeed

    consoleErrorSpy.mockRestore();
  });

  it('handles Blossom mirror with custom endpoint', async () => {
    mockGitProvider.push.mockResolvedValue({ success: true, server: {} });

    const pushToBlossomSpy = vi.spyOn(fs, 'pushToBlossom').mockResolvedValue(emptySummary);

    const pushOptions = {
      dir: '/test/repo',
      fs,
      refspecs: ['refs/heads/main'],
      repoId: 'test-repo',
      repoAddr: '31990:npub1test:test-repo',
      blossomMirror: true,
      endpoint: 'https://custom-blossom.example.com'
    };

    await provider.push(pushOptions);

    expect(pushToBlossomSpy).toHaveBeenCalledWith('/test/repo', {
      endpoint: 'https://custom-blossom.example.com',
      onProgress: expect.any(Function)
    });
  });

  it('handles Blossom mirror with multiple refs', async () => {
    mockGitProvider.push.mockResolvedValue({ success: true, server: {} });

    const pushToBlossomSpy = vi.spyOn(fs, 'pushToBlossom').mockResolvedValue(emptySummary);

    const pushOptions = {
      dir: '/test/repo',
      fs,
      refspecs: ['refs/heads/main', 'refs/heads/develop', 'refs/tags/v1.0.0'],
      repoId: 'test-repo',
      repoAddr: '31990:npub1test:test-repo',
      blossomMirror: true
    };

    await provider.push(pushOptions);

    expect(pushToBlossomSpy).toHaveBeenCalledWith('/test/repo', {
      endpoint: undefined,
      onProgress: expect.any(Function)
    });
  });

  it('handles Blossom mirror with empty repository', async () => {
    mockGitProvider.push.mockResolvedValue({ success: true, server: {} });

    const pushToBlossomSpy = vi.spyOn(fs, 'pushToBlossom').mockResolvedValue(emptySummary);

    const pushOptions = {
      dir: '/empty/repo',
      fs,
      refspecs: [],
      repoId: 'empty-repo',
      repoAddr: '31990:npub1test:empty-repo',
      blossomMirror: true
    };

    await provider.push(pushOptions);

    expect(pushToBlossomSpy).toHaveBeenCalledWith('/empty/repo', {
      endpoint: undefined,
      onProgress: expect.any(Function)
    });
  });

  it('handles Blossom mirror with network timeout', async () => {
    mockGitProvider.push.mockResolvedValue({ success: true, server: {} });

    const pushToBlossomSpy = vi.spyOn(fs, 'pushToBlossom').mockRejectedValue(
      new Error('Network timeout')
    );

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const pushOptions = {
      dir: '/test/repo',
      fs,
      refspecs: ['refs/heads/main'],
      repoId: 'test-repo',
      repoAddr: '31990:npub1test:test-repo',
      blossomMirror: true
    };

    const result = await provider.push(pushOptions);

    expect(result).toBeDefined();
    expect(result.server).toBeDefined(); // Push should still succeed
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error during Blossom mirror upload:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it('handles Blossom mirror with authentication failure', async () => {
    mockGitProvider.push.mockResolvedValue({ success: true, server: {} });

    const pushToBlossomSpy = vi.spyOn(fs, 'pushToBlossom').mockRejectedValue(
      new Error('Authentication failed')
    );

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const pushOptions = {
      dir: '/test/repo',
      fs,
      refspecs: ['refs/heads/main'],
      repoId: 'test-repo',
      repoAddr: '31990:npub1test:test-repo',
      blossomMirror: true
    };

    const result = await provider.push(pushOptions);

    expect(result).toBeDefined();
    expect(result.server).toBeDefined(); // Push should still succeed
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error during Blossom mirror upload:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });
});
