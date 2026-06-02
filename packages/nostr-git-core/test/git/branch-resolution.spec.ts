import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';

import type { GitProvider } from '../../src/git/provider.js';
import { resolveBranchToOid } from '../../src/git/git.js';

import { createTestFs, mkdirp } from '../utils/lightningfs.js';
import { createRemoteRegistry } from '../utils/remote-registry.js';
import { createTestGitProvider } from '../utils/provider-harness.js';
import { initRepo, commitFile, createBranch, checkout } from '../utils/git-harness.js';

describe('git/git.ts: resolveBranchToOid', () => {
  it('resolves preferred branch when it exists', async () => {
    const fs = createTestFs('branch-resolve-preferred');
    const remoteRegistry = createRemoteRegistry();
    const git = createTestGitProvider({ fs: fs as any, remoteRegistry });

    const dir = '/repos/branch-resolve-preferred';
    await mkdirp(fs as any, dir);

    const h = { fs: fs as any, dir, author: { name: 'Test', email: 't@example.com' } };
    await initRepo(h, 'main');
    await commitFile(h, '/README.md', 'hello\n', 'init');
    await createBranch(h, 'feature/x', false);

    const oid = await resolveBranchToOid(git as any, dir, 'feature/x');
    const expected = await (git as any).resolveRef({ dir, ref: 'feature/x' });

    expect(oid).toBe(expected);
  });

  it('falls back to main when preferred branch is missing and invokes onBranchNotFound', async () => {
    const fs = createTestFs('branch-resolve-fallback-main');
    const remoteRegistry = createRemoteRegistry();
    const git = createTestGitProvider({ fs: fs as any, remoteRegistry });

    const dir = '/repos/branch-resolve-fallback-main';
    await mkdirp(fs as any, dir);

    const h = { fs: fs as any, dir, author: { name: 'Test', email: 't@example.com' } };
    await initRepo(h, 'main');
    await commitFile(h, '/README.md', 'hello\n', 'init');

    const misses: string[] = [];
    const oid = await resolveBranchToOid(git as any, dir, 'does-not-exist', {
      onBranchNotFound: (branchName) => misses.push(branchName)
    });

    const expected = await (git as any).resolveRef({ dir, ref: 'main' });
    expect(oid).toBe(expected);
    expect(misses).toEqual(['does-not-exist']);
  });

  it('falls back through preferred → main → master → develop → dev chain', async () => {
    const fs = createTestFs('branch-resolve-chain');
    const remoteRegistry = createRemoteRegistry();
    const git = createTestGitProvider({ fs: fs as any, remoteRegistry });

    const dir = '/repos/branch-resolve-chain';
    await mkdirp(fs as any, dir);

    // Only 'develop' exists
    const h = { fs: fs as any, dir, author: { name: 'Test', email: 't@example.com' } };
    await initRepo(h, 'develop');
    await commitFile(h, '/README.md', 'hello\n', 'init');
    await checkout(h, 'develop');

    const misses: string[] = [];
    const oid = await resolveBranchToOid(git as any, dir, 'feature/missing', {
      onBranchNotFound: (branchName) => misses.push(branchName)
    });

    const expected = await (git as any).resolveRef({ dir, ref: 'develop' });
    expect(oid).toBe(expected);
    expect(misses).toEqual(['feature/missing', 'main', 'master']);
  });

  it('throws wrapped error when no candidate branches can be resolved and invokes onBranchNotFound for each candidate', async () => {
    const fs = createTestFs('branch-resolve-none');
    const remoteRegistry = createRemoteRegistry();
    const git = createTestGitProvider({ fs: fs as any, remoteRegistry });

    const dir = '/repos/branch-resolve-none';
    await mkdirp(fs as any, dir); // directory exists but is not a git repo

    const misses: string[] = [];
    await expect(
      resolveBranchToOid(git as any as GitProvider, dir, 'preferred', {
        onBranchNotFound: (branchName) => misses.push(branchName)
      })
    ).rejects.toBeTruthy();

    // preferred + main + master + develop + dev
    expect(misses).toEqual(['preferred', 'main', 'master', 'develop', 'dev']);
  });
});