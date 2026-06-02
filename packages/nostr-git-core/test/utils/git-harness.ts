import * as git from 'isomorphic-git';
import type { LightningFsLike } from './lightningfs.js';
import { mkdirp, writeText } from './lightningfs.js';

export interface RepoHarness {
  fs: LightningFsLike;
  dir: string;
  author: { name: string; email: string };
}

export async function initRepo(h: RepoHarness, defaultBranch: string = 'main'): Promise<void> {
  await mkdirp(h.fs, h.dir);
  await git.init({ fs: h.fs as any, dir: h.dir, defaultBranch });
}

function stripLeadingSlash(p: string): string {
  return p.replace(/^\/+/, '');
}

function parentDir(fullPath: string): string {
  const p = fullPath.replace(/\\/g, '/');
  const idx = p.lastIndexOf('/');
  if (idx <= 0) return '/';
  return p.slice(0, idx);
}

export async function commitFile(
  h: RepoHarness,
  filepath: string,
  content: string,
  message: string
): Promise<string> {
  const rel = stripLeadingSlash(filepath);
  const full = `${h.dir}/${rel}`;
  await mkdirp(h.fs, parentDir(full));
  await writeText(h.fs, full, content);

  await git.add({ fs: h.fs as any, dir: h.dir, filepath: rel });
  const oid = await git.commit({
    fs: h.fs as any,
    dir: h.dir,
    message,
    author: h.author
  });
  return oid;
}

export async function createBranch(
  h: RepoHarness,
  name: string,
  checkout: boolean = false
): Promise<void> {
  await git.branch({ fs: h.fs as any, dir: h.dir, ref: name });
  if (checkout) {
    await git.checkout({ fs: h.fs as any, dir: h.dir, ref: name });
  }
}

export async function checkout(h: RepoHarness, ref: string): Promise<void> {
  await git.checkout({ fs: h.fs as any, dir: h.dir, ref });
}

export async function getHeadOid(h: RepoHarness, ref: string = 'HEAD'): Promise<string> {
  const oid = await git.resolveRef({ fs: h.fs as any, dir: h.dir, ref });
  return oid;
}

export async function listBranches(h: RepoHarness): Promise<string[]> {
  return await git.listBranches({ fs: h.fs as any, dir: h.dir });
}

export async function listRemotes(h: RepoHarness): Promise<Array<{ remote: string; url: string }>> {
  return await git.listRemotes({ fs: h.fs as any, dir: h.dir });
}

export async function statusMatrix(h: RepoHarness): Promise<any[]> {
  return await git.statusMatrix({ fs: h.fs as any, dir: h.dir });
}