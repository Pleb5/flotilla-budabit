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

describe('virtual git remote - push', () => {
  it('reflects local commits in remote log after mirrorFromLocal', async () => {
    const fs = new (LightningFS as any)('push-test');

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

    const pfs = (fs as any).promises as typeof fs.promises;
    await pfs.writeFile(`${localDir}/README.md`, '# Virtual Remote\n\nLocal change.\n', 'utf8');

    await git.add({ fs: fs as any, dir: localDir, filepath: 'README.md' });
    const localCommitOid = await git.commit({
      fs: fs as any,
      dir: localDir,
      message: 'local change',
      author: {
        name: 'Bob',
        email: 'bob@example.com',
      },
    });

    await remote.mirrorFromLocal(localDir);

    const remoteLog = await git.log({ fs: fs as any, dir: remote.dir, ref: seed.branch });
    const oids = remoteLog.map((e) => e.oid);
    expect(oids).toContain(localCommitOid);
  });
});
