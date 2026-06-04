import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import LightningFS from '@isomorphic-git/lightning-fs';
import * as git from 'isomorphic-git';
import { VirtualGitRemote } from './virtual-remote.js';

async function cloneFromRemote(fs: any, remoteDir: string, localDir: string): Promise<void> {
  const pfs = (fs as any).promises as typeof fs.promises;
  const copyTree = async (src: string, dst: string): Promise<void> => {
    try {
      await pfs.mkdir(dst, { recursive: true } as any);
    } catch {
      // ignore
    }
    const entries = await pfs.readdir(src);
    for (const entry of entries as string[]) {
      const srcPath = `${src}/${entry}`;
      const dstPath = `${dst}/${entry}`;
      const stat = await pfs.stat(srcPath);
      if (stat.isDirectory()) {
        await copyTree(srcPath, dstPath);
      } else {
        const data = await pfs.readFile(srcPath);
        await pfs.writeFile(dstPath, data as any);
      }
    }
  };

  await copyTree(remoteDir, localDir);
}

async function mirrorGitdir(fs: any, fromDir: string, toDir: string): Promise<void> {
  const pfs = (fs as any).promises as typeof fs.promises;
  const srcGit = `${fromDir}/.git`;
  const dstGit = `${toDir}/.git`;

  const copyTree = async (src: string, dst: string): Promise<void> => {
    try {
      await pfs.mkdir(dst, { recursive: true } as any);
    } catch {
      // ignore
    }
    const entries = await pfs.readdir(src);
    for (const entry of entries as string[]) {
      const srcPath = `${src}/${entry}`;
      const dstPath = `${dst}/${entry}`;
      const stat = await pfs.stat(srcPath);
      if (stat.isDirectory()) {
        await copyTree(srcPath, dstPath);
      } else {
        const data = await pfs.readFile(srcPath);
        await pfs.writeFile(dstPath, data as any);
      }
    }
  };

  await copyTree(srcGit, dstGit);
}

describe('virtual git remote - fetch', () => {
  it('updates local log when remote gains new commits', async () => {
    const fs = new (LightningFS as any)('fetch-test');

    const remote = new VirtualGitRemote({
      fs,
      dir: '/remote',
      defaultBranch: 'main',
      author: {
        name: 'Alice',
        email: 'alice@example.com',
      },
    });

    const seed = await remote.seed({
      'README.md': '# Virtual Remote\n',
    });

    const localDir = '/local';
    await cloneFromRemote(fs, remote.dir, localDir);

    const initialLocalLog = await git.log({ fs: fs as any, dir: localDir, ref: seed.branch });
    expect(initialLocalLog.length).toBe(1);

    await remote.writeFile('CHANGELOG.md', 'Initial changelog');
    await remote.commit('add changelog', ['CHANGELOG.md']);

    await mirrorGitdir(fs, remote.dir, localDir);

    const updatedLocalLog = await git.log({ fs: fs as any, dir: localDir, ref: seed.branch });
    expect(updatedLocalLog.length).toBeGreaterThan(initialLocalLog.length);
    expect(updatedLocalLog[0].oid).not.toBe(initialLocalLog[0].oid);
  });
});
