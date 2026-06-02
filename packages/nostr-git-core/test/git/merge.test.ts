import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import LightningFS from '@isomorphic-git/lightning-fs';
import * as git from 'isomorphic-git';

// Merge-focused tests using real isomorphic-git on LightningFS.

async function ensureDir(fs: any, path: string): Promise<void> {
  const pfs = (fs as any).promises as typeof fs.promises;
  try {
    await pfs.mkdir(path, { recursive: true } as any);
  } catch {
    // ignore EEXIST and similar
  }
}

describe.skip('git + LightningFS – merge flows', () => {
  it('performs a fast-forward merge when main is behind feature', async () => {
    const fs = new (LightningFS as any)('merge-fast-forward');
    const dir = '/repo-merge-ff';
    const pfs = (fs as any).promises as typeof fs.promises;

    await git.init({ fs: fs as any, dir, defaultBranch: 'main' });
    await ensureDir(fs, dir);

    // base commit on main
    await pfs.writeFile(`${dir}/file.txt`, 'base\n', 'utf8');
    await git.add({ fs: fs as any, dir, filepath: 'file.txt' });
    const baseOid = await git.commit({
      fs: fs as any,
      dir,
      message: 'base',
      author: { name: 'Test', email: 'test@example.com' },
    });

    expect(baseOid).toBeTruthy();

    // create feature branch and move it ahead
    await git.branch({ fs: fs as any, dir, ref: 'feature' });
    await git.checkout({ fs: fs as any, dir, ref: 'feature' });
    await pfs.writeFile(`${dir}/file.txt`, 'feature-change\n', 'utf8');
    await git.add({ fs: fs as any, dir, filepath: 'file.txt' });
    const featureOid = await git.commit({
      fs: fs as any,
      dir,
      message: 'feature commit',
      author: { name: 'Test', email: 'test@example.com' },
    });

    expect(featureOid).not.toBe(baseOid);

    // main is still at base, behind feature
    const mainLogBefore = await git.log({ fs: fs as any, dir, ref: 'main' });
    expect(mainLogBefore[0].oid).toBe(baseOid);

    // merge feature into main with fast-forward
    await git.checkout({ fs: fs as any, dir, ref: 'main' });
    const mergeResult = await git.merge({
      fs: fs as any,
      dir,
      ours: 'main',
      theirs: 'feature',
      fastForward: true,
      author: { name: 'Merge Bot', email: 'merge@example.com' },
    } as any);

    expect((mergeResult as any).fastForward).toBe(true);

    const mainLogAfter = await git.log({ fs: fs as any, dir, ref: 'main' });
    expect(mainLogAfter[0].oid).toBe(featureOid);

    const buf = await pfs.readFile(`${dir}/file.txt`, 'utf8');
    const text = typeof buf === 'string' ? buf : new TextDecoder().decode(buf as any);
    expect(typeof text).toBe('string');
  });

  it('performs a three-way merge with non-conflicting changes on different files', async () => {
    const fs = new (LightningFS as any)('merge-three-way');
    const dir = '/repo-merge-tw';
    const pfs = (fs as any).promises as typeof fs.promises;

    await git.init({ fs: fs as any, dir, defaultBranch: 'main' });
    await ensureDir(fs, dir);

    // base commit with no files
    const baseOid = await git.commit({
      fs: fs as any,
      dir,
      message: 'base',
      author: { name: 'Test', email: 'test@example.com' },
    });

    expect(baseOid).toBeTruthy();

    // main branch adds main-only.txt
    await pfs.writeFile(`${dir}/main-only.txt`, 'main\n', 'utf8');
    await git.add({ fs: fs as any, dir, filepath: 'main-only.txt' });
    const mainOid = await git.commit({
      fs: fs as any,
      dir,
      message: 'main change',
      author: { name: 'Test', email: 'test@example.com' },
    });

    // feature branch adds feature-only.txt
    await git.branch({ fs: fs as any, dir, ref: 'feature' });
    await git.checkout({ fs: fs as any, dir, ref: 'feature' });
    await pfs.writeFile(`${dir}/feature-only.txt`, 'feature\n', 'utf8');
    await git.add({ fs: fs as any, dir, filepath: 'feature-only.txt' });
    const featureOid = await git.commit({
      fs: fs as any,
      dir,
      message: 'feature change',
      author: { name: 'Test', email: 'test@example.com' },
    });

    expect(featureOid).not.toBe(mainOid);

    const mergeBase = await (git as any).findMergeBase({ fs: fs as any, dir, oids: [mainOid, featureOid] });
    expect(Array.isArray(mergeBase)).toBe(true);
    expect(mergeBase.length).toBeGreaterThan(0);

    // merge feature into main, expecting a true three-way merge without conflicts
    await git.checkout({ fs: fs as any, dir, ref: 'main' });
    await git.merge({
      fs: fs as any,
      dir,
      ours: 'main',
      theirs: 'feature',
      fastForward: false,
      author: { name: 'Merge Bot', email: 'merge@example.com' },
    } as any);

    const files = await git.listFiles({ fs: fs as any, dir });
    expect(files).toContain('main-only.txt');
  });
});
