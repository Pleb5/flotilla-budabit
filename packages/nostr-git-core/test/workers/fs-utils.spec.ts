import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import * as isoGit from 'isomorphic-git';
import { createRemoteRegistry } from '../utils/remote-registry.js';
import { createTestFs, mkdirp, writeText } from '../utils/lightningfs.js';
import { createTestGitProvider } from '../utils/provider-harness.js';

import { getProviderFs, ensureDir, safeRmrf, isRepoClonedFs } from '../../src/worker/workers/fs-utils.js';

describe('worker/fs-utils', () => {
  it('getProviderFs extracts fs from direct provider shape', () => {
    const fs = createTestFs('fs-utils-direct');
    const provider: any = { fs };
    expect(getProviderFs(provider)).toBe(fs);
  });

  it('getProviderFs extracts fs from one-level wrapped provider shape', () => {
    const fs = createTestFs('fs-utils-wrap1');
    const provider: any = { baseProvider: { fs } };
    expect(getProviderFs(provider)).toBe(fs);
  });

  it('getProviderFs extracts fs from two-level wrapped provider shape', () => {
    const fs = createTestFs('fs-utils-wrap2');
    const provider: any = { baseProvider: { baseProvider: { fs } } };
    expect(getProviderFs(provider)).toBe(fs);
  });

  it('ensureDir creates a directory when parent exists', async () => {
    const fs = createTestFs('fs-utils-ensureDir');
    await mkdirp(fs as any, '/parent');

    await ensureDir(fs as any, '/parent/child');

    const st = await (fs as any).promises.stat('/parent/child');
    const isDir = typeof st.isDirectory === 'function' ? st.isDirectory() : st.type === 'dir';
    expect(isDir).toBe(true);
  });

  it('safeRmrf removes directories recursively and tolerates missing paths', async () => {
    const fs = createTestFs('fs-utils-safeRmrf');
    await mkdirp(fs as any, '/rm/a');
    await writeText(fs as any, '/rm/a/file.txt', 'hello');
    await writeText(fs as any, '/rm/b.txt', 'world');

    await safeRmrf(fs as any, '/rm');

    await expect((fs as any).promises.stat('/rm')).rejects.toBeTruthy();

    // Should not throw on missing
    await safeRmrf(fs as any, '/rm');
  });

  it('isRepoClonedFs detects cloned repo by .git directory existence', async () => {
    const fs = createTestFs('fs-utils-isRepoCloned');
    const remoteRegistry = createRemoteRegistry();
    const provider = createTestGitProvider({ fs: fs as any, remoteRegistry });

    const dir = '/repos/owner/repo';
    await mkdirp(fs as any, dir);
    await (provider as any).init({ dir, defaultBranch: 'main' });

    const ok = await isRepoClonedFs(provider as any, dir);
    expect(ok).toBe(true);

    const no = await isRepoClonedFs(provider as any, '/repos/does-not-exist');
    expect(no).toBe(false);
  });

  it('isRepoClonedFs falls back to listBranches when fs is not present (returns false if it fails)', async () => {
    const provider: any = {
      listBranches: async () => {
        throw new Error('not a repo');
      }
    };

    const ok = await isRepoClonedFs(provider, '/repos/anything');
    expect(ok).toBe(false);
  });

  it('isRepoClonedFs can detect repo if listBranches works and fs is not present', async () => {
    const fs = createTestFs('fs-utils-listBranches');
    const dir = '/repo';
    await mkdirp(fs as any, dir);
    await isoGit.init({ fs: fs as any, dir, defaultBranch: 'main' });

    const provider: any = {
      listBranches: async (args: any) => {
        return await isoGit.listBranches({ fs: fs as any, dir: args.dir });
      }
    };

    const ok = await isRepoClonedFs(provider, dir);
    expect(ok).toBe(true);
  });
});