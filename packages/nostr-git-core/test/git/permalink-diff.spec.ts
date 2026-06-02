import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

import { setGitProvider, getGitProvider } from '../../src/api/git-provider.js';
import {
  githubPermalinkDiffId,
  mapDiffHashToFile,
  produceGitDiffFromPermalink
} from '../../src/git/git.js';

import { VirtualGitRemote } from '../git/virtual-remote.js';
import { createRemoteRegistry } from '../utils/remote-registry.js';
import { createTestGitProvider } from '../utils/provider-harness.js';
import { createTestFs, mkdirp } from '../utils/lightningfs.js';
import { initRepo, commitFile } from '../utils/git-harness.js';

describe.sequential('git/git.ts: permalink diff helpers', () => {
  let prevProvider: any;

  beforeEach(() => {
    prevProvider = getGitProvider();
  });

  afterEach(() => {
    setGitProvider(prevProvider);
  });

  it('githubPermalinkDiffId is deterministic for same file path and differs across paths', async () => {
    const a1 = await githubPermalinkDiffId('src/index.ts');
    const a2 = await githubPermalinkDiffId('src/index.ts');
    const b = await githubPermalinkDiffId('src/other.ts');

    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('mapDiffHashToFile maps diff hash to correct file for multi-file changes', async () => {
    const fs = createTestFs('permalink-mapDiff');
    const registry = createRemoteRegistry();
    const git = createTestGitProvider({ fs: fs as any, remoteRegistry: registry });

    setGitProvider(git as any);

    const dir = '/repos/permalink-mapDiff';
    await mkdirp(fs as any, dir);

    const h = { fs: fs as any, dir, author: { name: 'Test', email: 't@example.com' } };
    await initRepo(h, 'main');

    const c1 = await commitFile(h, '/a.txt', 'a1\n', 'add a');
    await commitFile(h, '/b.txt', 'b1\n', 'add b');
    const c3 = await commitFile(h, '/a.txt', 'a2\n', 'modify a');

    const hashB = await githubPermalinkDiffId('b.txt');
    const mappedB = await mapDiffHashToFile(dir, c1, c3, hashB);
    expect(mappedB).toBeTruthy();
    expect(mappedB?.filepath).toBe('b.txt');
    expect(mappedB?.type).toBe('add');

    const hashA = await githubPermalinkDiffId('a.txt');
    const mappedA = await mapDiffHashToFile(dir, c1, c3, hashA);
    expect(mappedA).toBeTruthy();
    expect(mappedA?.filepath).toBe('a.txt');
    expect(mappedA?.type).toBe('modify');
  });

  it('produceGitDiffFromPermalink generates unified diff for a selected file', async () => {
    const remoteFs = createTestFs('permalink-remote');
    const remote = new VirtualGitRemote({
      fs: remoteFs as any,
      dir: '/remote',
      defaultBranch: 'main',
      author: { name: 'Remote', email: 'remote@example.com' }
    });

    const seed = await remote.seed({ 'a.txt': 'hello\n', 'b.txt': 'world\n' }, 'initial');
    await remote.writeFile('a.txt', 'hello2\n');
    const c2 = await remote.commit('update a', ['a.txt']);

    const registry = createRemoteRegistry();
    const url = 'https://example.com/alice/proj.git';
    registry.register(url, remote);

    const fs = createTestFs('permalink-local');
    const git = createTestGitProvider({ fs: fs as any, remoteRegistry: registry });
    setGitProvider(git as any);

    const hashA = await githubPermalinkDiffId('a.txt');

    const patch = await produceGitDiffFromPermalink({
      host: 'example.com',
      owner: 'alice',
      repo: 'proj',
      branch: c2,
      diffFileHash: hashA
    } as any);

    expect(typeof patch).toBe('string');
    expect(patch).toContain('a.txt');
    expect(patch).toContain('Index: a.txt');
  });

  it('produceGitDiffFromPermalink supports root commit diffs (empty-tree comparison)', async () => {
    const remoteFs = createTestFs('permalink-remote-root');
    const remote = new VirtualGitRemote({
      fs: remoteFs as any,
      dir: '/remote',
      defaultBranch: 'main',
      author: { name: 'Remote', email: 'remote@example.com' }
    });

    const seed = await remote.seed({ 'a.txt': 'root\n' }, 'root commit');
    const rootCommit = seed.initialCommit;

    const registry = createRemoteRegistry();
    const url = 'https://example.com/root/proj.git';
    registry.register(url, remote);

    const fs = createTestFs('permalink-local-root');
    const git = createTestGitProvider({ fs: fs as any, remoteRegistry: registry });
    setGitProvider(git as any);

    const hashA = await githubPermalinkDiffId('a.txt');

    const patch = await produceGitDiffFromPermalink({
      host: 'example.com',
      owner: 'root',
      repo: 'proj',
      branch: rootCommit,
      diffFileHash: hashA
    } as any);

    expect(typeof patch).toBe('string');
    expect(patch).toContain('Index: a.txt');
    expect(patch).toContain('root');
  });
});