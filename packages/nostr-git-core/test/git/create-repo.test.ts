import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import LightningFS from '@isomorphic-git/lightning-fs';
import * as git from 'isomorphic-git';

// More extensive tests focused on creating brand-new repositories and basic git flows.

describe('git + LightningFS – create repo flows', () => {
  it('initializes a new empty repo and has clean status', async () => {
    const fs = new (LightningFS as any)('create-repo-empty');
    const dir = '/repo-empty';

    await git.init({ fs: fs as any, dir, defaultBranch: 'main' });

    const matrix = await git.statusMatrix({ fs: fs as any, dir });
    expect(Array.isArray(matrix)).toBe(true);
    expect(matrix.length).toBe(0);
  });

  it('creates first commit with tracked file and shows clean working tree', async () => {
    const fs = new (LightningFS as any)('create-repo-first-commit');
    const dir = '/repo-first';
    const pfs = (fs as any).promises as typeof fs.promises;

    await git.init({ fs: fs as any, dir, defaultBranch: 'main' });

    try {
      await pfs.mkdir(dir, { recursive: true } as any);
    } catch {
      // ignore EEXIST and similar errors
    }
    await pfs.writeFile(`${dir}/README.md`, '# New Repo\n', 'utf8');

    await git.add({ fs: fs as any, dir, filepath: 'README.md' });
    const oid = await git.commit({
      fs: fs as any,
      dir,
      message: 'Initial commit',
      author: {
        name: 'Test User',
        email: 'test@example.com',
      },
    });

    expect(typeof oid).toBe('string');
    expect(oid.length).toBeGreaterThan(10);

    const matrix = await git.statusMatrix({ fs: fs as any, dir });
    expect(matrix.length).toBe(1);
    const [filepath, head, workdir, stage] = matrix[0];
    expect(filepath).toBe('README.md');
    expect(head).toBe(1);
    expect(workdir).toBe(1);
    expect(stage).toBe(1);
  });

  it('creates a feature branch and keeps main untouched', async () => {
    const fs = new (LightningFS as any)('create-repo-branch');
    const dir = '/repo-branch';
    const pfs = (fs as any).promises as typeof fs.promises;

    await git.init({ fs: fs as any, dir, defaultBranch: 'main' });

    try {
      await pfs.mkdir(dir, { recursive: true } as any);
    } catch {
      // ignore EEXIST and similar errors
    }
    await pfs.writeFile(`${dir}/index.txt`, 'v1\n', 'utf8');
    await git.add({ fs: fs as any, dir, filepath: 'index.txt' });
    const baseOid = await git.commit({
      fs: fs as any,
      dir,
      message: 'base',
      author: {
        name: 'Test User',
        email: 'test@example.com',
      },
    });

    expect(baseOid).toBeTruthy();

    await git.branch({ fs: fs as any, dir, ref: 'feature/x' });
    await git.checkout({ fs: fs as any, dir, ref: 'feature/x' });

    await pfs.writeFile(`${dir}/index.txt`, 'v2-feature\n', 'utf8');
    await git.add({ fs: fs as any, dir, filepath: 'index.txt' });
    const featureOid = await git.commit({
      fs: fs as any,
      dir,
      message: 'feature change',
      author: {
        name: 'Test User',
        email: 'test@example.com',
      },
    });

    expect(featureOid).toBeTruthy();
    expect(featureOid).not.toBe(baseOid);

    const listMain = await git.log({ fs: fs as any, dir, ref: 'main' });
    const listFeature = await git.log({ fs: fs as any, dir, ref: 'feature/x' });

    expect(listMain[0].oid).toBe(baseOid);
    expect(listFeature[0].oid).toBe(featureOid);
  });

  it('lists tracked files correctly after multiple additions', async () => {
    const fs = new (LightningFS as any)('create-repo-files');
    const dir = '/repo-files';
    const pfs = (fs as any).promises as typeof fs.promises;

    await git.init({ fs: fs as any, dir, defaultBranch: 'main' });

    try {
      await pfs.mkdir(dir, { recursive: true } as any);
    } catch {
      // ignore EEXIST and similar errors
    }
    try {
      await pfs.mkdir(`${dir}/sub`, { recursive: true } as any);
    } catch {
      // ignore EEXIST and similar errors
    }
    await pfs.writeFile(`${dir}/a.txt`, 'A\n', 'utf8');
    await pfs.writeFile(`${dir}/b.txt`, 'B\n', 'utf8');
    await pfs.writeFile(`${dir}/sub/c.txt`, 'C\n', 'utf8');

    await git.add({ fs: fs as any, dir, filepath: 'a.txt' });
    await git.add({ fs: fs as any, dir, filepath: 'b.txt' });
    await git.add({ fs: fs as any, dir, filepath: 'sub/c.txt' });

    await git.commit({
      fs: fs as any,
      dir,
      message: 'add files',
      author: {
        name: 'Test User',
        email: 'test@example.com',
      },
    });

    const files = await git.listFiles({ fs: fs as any, dir });
    expect(files.sort()).toEqual(['a.txt', 'b.txt', 'sub/c.txt'].sort());
  });
});
