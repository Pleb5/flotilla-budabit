// Provider FS helpers extracted from git-worker
// These run in the worker and use the git-wrapper provider's fs when available.
import type { GitProvider } from '../../git/provider.js';

export function getProviderFs(git: GitProvider): any | undefined {
  // Try direct fs first
  let fs: any | undefined = (git as any).fs;
  if (fs) return fs;

  // Try unwrapping common wrapper shape (e.g., MultiVendorGitProvider -> baseProvider)
  const base = (git as any).baseProvider;
  if (base && typeof base === 'object') {
    fs = (base as any).fs;
    if (fs) return fs;

    // Some wrappers may nest further; attempt one more level defensively
    const base2 = (base as any).baseProvider;
    if (base2 && typeof base2 === 'object') {
      fs = (base2 as any).fs;
      if (fs) return fs;
    }
  }

  return undefined;
}

export async function ensureDir(fs: any, path: string): Promise<void> {
  if (!fs?.promises) return;
  try {
    await fs.promises.mkdir(path);
  } catch (e: any) {
    if (!e || (e.code !== 'EEXIST' && e.message?.includes('exists') === false)) {
      // ignore if already exists; rethrow otherwise
      throw e;
    }
  }
}

export async function safeRmrf(fs: any, path: string): Promise<void> {
  if (!fs?.promises) return;
  async function rmrf(p: string): Promise<void> {
    try {
      const stat = await fs.promises.stat(p);
      const isDir =
        typeof stat.isDirectory === 'function' ? stat.isDirectory() : stat.type === 'dir';
      if (isDir) {
        const entries = await fs.promises.readdir(p);
        for (const entry of entries) await rmrf(`${p}/${entry}`);
        await fs.promises.rmdir(p);
      } else {
        await fs.promises.unlink(p);
      }
    } catch {
      return;
    }
  }
  await rmrf(path);
}

export async function isRepoClonedFs(git: GitProvider, dir: string): Promise<boolean> {
  try {
    const fs: any = (git as any).fs;
    if (fs?.promises) {
      const gitDir = `${dir}/.git`;
      const stat = await fs.promises.stat(gitDir);
      if (typeof stat.isDirectory === 'function') return stat.isDirectory();
      return stat.type ? stat.type === 'dir' : false;
    }
    await (git as any).listBranches({ dir });
    return true;
  } catch {
    return false;
  }
}
