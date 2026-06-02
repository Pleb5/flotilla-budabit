import * as git from 'isomorphic-git';
import type { GitProvider } from '../../src/git/provider.js';
import type { LightningFsLike } from './lightningfs.js';
import { mkdirp } from './lightningfs.js';
import type { RemoteRegistry } from './remote-registry.js';
import { normalizeRemoteUrl } from './remote-registry.js';

type AnyFs = LightningFsLike & {
  promises: {
    mkdir: (path: string, opts?: any) => Promise<void>;
    stat: (path: string) => Promise<any>;
    readdir: (path: string) => Promise<string[]>;
    readFile: (path: string, encoding?: any) => Promise<any>;
    writeFile: (path: string, data: any, encoding?: any) => Promise<void>;
    unlink?: (path: string) => Promise<void>;
    rmdir?: (path: string) => Promise<void>;
  };
};

function normalizePath(path: string): string {
  if (!path) return '/';
  let p = String(path).replace(/\\/g, '/');
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function joinPath(...parts: string[]): string {
  return normalizePath(parts.join('/'));
}

function dirname(path: string): string {
  const p = normalizePath(path);
  const idx = p.lastIndexOf('/');
  if (idx <= 0) return '/';
  return p.slice(0, idx);
}

async function safeMkdir(fs: AnyFs, path: string): Promise<void> {
  try {
    await fs.promises.mkdir(path);
  } catch (e: any) {
    const code = e?.code;
    const msg = String(e?.message || '');
    if (code === 'EEXIST') return;
    if (msg.toLowerCase().includes('exists')) return;
  }
}

async function copyTree(
  srcFs: AnyFs,
  srcPath: string,
  dstFs: AnyFs,
  dstPath: string
): Promise<void> {
  const src = normalizePath(srcPath);
  const dst = normalizePath(dstPath);

  const stat = await srcFs.promises.stat(src);
  const isDir =
    typeof stat?.isDirectory === 'function' ? stat.isDirectory() : stat?.type === 'dir';

  if (isDir) {
    await safeMkdir(dstFs, dst);
    let entries: string[] = [];
    try {
      entries = await srcFs.promises.readdir(src);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      const s = joinPath(src, entry);
      const d = joinPath(dst, entry);
      await copyTree(srcFs, s, dstFs, d);
    }
    return;
  }

  // File
  await mkdirp(dstFs, dirname(dst));
  const data = await srcFs.promises.readFile(src);
  await dstFs.promises.writeFile(dst, data as any);
}

async function copyDirMerge(
  srcFs: AnyFs,
  srcDir: string,
  dstFs: AnyFs,
  dstDir: string
): Promise<void> {
  const src = normalizePath(srcDir);
  const dst = normalizePath(dstDir);

  // If src doesn't exist, nothing to do
  try {
    const stat = await srcFs.promises.stat(src);
    const isDir =
      typeof stat?.isDirectory === 'function' ? stat.isDirectory() : stat?.type === 'dir';
    if (!isDir) return;
  } catch {
    return;
  }

  await safeMkdir(dstFs, dst);
  const entries = await srcFs.promises.readdir(src);
  for (const entry of entries) {
    const s = joinPath(src, entry);
    const d = joinPath(dst, entry);
    const st = await srcFs.promises.stat(s);
    const isDir =
      typeof st?.isDirectory === 'function' ? st.isDirectory() : st?.type === 'dir';
    if (isDir) {
      await copyDirMerge(srcFs, s, dstFs, d);
    } else {
      await mkdirp(dstFs, dirname(d));
      const data = await srcFs.promises.readFile(s);
      await dstFs.promises.writeFile(d, data as any);
    }
  }
}

async function writeRefFile(fs: AnyFs, gitDir: string, refPath: string, oid: string): Promise<void> {
  const full = joinPath(gitDir, refPath);
  await mkdirp(fs, dirname(full));
  await fs.promises.writeFile(full, `${oid}\n`, 'utf8');
}

async function ensureOriginConfig(fs: AnyFs, dir: string, url: string): Promise<void> {
  try {
    await (git as any).addRemote({ fs: fs as any, dir, remote: 'origin', url });
  } catch {
    // ignore if already exists
  }
  // Ensure fetch refspec exists; isomorphic-git expects this in some operations
  try {
    await (git as any).setConfig({
      fs: fs as any,
      dir,
      path: 'remote.origin.fetch',
      value: '+refs/heads/*:refs/remotes/origin/*'
    });
  } catch {
    // best effort
  }
  try {
    await (git as any).setConfig({
      fs: fs as any,
      dir,
      path: 'remote.origin.url',
      value: url
    });
  } catch {
    // best effort
  }
}

async function listRemoteHeads(remoteFs: AnyFs, remoteDir: string): Promise<Array<{ ref: string; oid: string }>> {
  const branches = await git.listBranches({ fs: remoteFs as any, dir: remoteDir });
  const out: Array<{ ref: string; oid: string }> = [];
  for (const b of branches) {
    const oid = await git.resolveRef({ fs: remoteFs as any, dir: remoteDir, ref: `refs/heads/${b}` });
    out.push({ ref: `refs/heads/${b}`, oid });
  }
  return out;
}

async function updateTrackingRefsFromRemote(params: {
  localFs: AnyFs;
  localDir: string;
  remoteFs: AnyFs;
  remoteDir: string;
  requestedRef?: string;
}): Promise<void> {
  const { localFs, localDir, remoteFs, remoteDir, requestedRef } = params;
  const localGitDir = joinPath(localDir, '.git');

  const heads = await listRemoteHeads(remoteFs, remoteDir);
  const wanted =
    requestedRef && requestedRef.trim().length
      ? heads.filter((h) => h.ref === `refs/heads/${requestedRef}` || h.ref === requestedRef)
      : heads;

  for (const h of wanted) {
    const branchName = h.ref.startsWith('refs/heads/') ? h.ref.slice('refs/heads/'.length) : h.ref;
    await writeRefFile(localFs, localGitDir, `refs/remotes/origin/${branchName}`, h.oid);
  }
}

export interface TestGitProviderOptions {
  fs: AnyFs;
  remoteRegistry: RemoteRegistry;
}

/**
 * Creates a GitProvider-like adapter for tests:
 * - Local operations delegate to isomorphic-git with injected LightningFS.
 * - clone/fetch/push use a RemoteRegistry mapping URL -> VirtualGitRemote, performing copy-based transport.
 *
 * Note: We intentionally return a GitProvider via type cast to keep this adapter resilient
 * if the upstream interface changes, while still providing all methods used by src/git and src/worker.
 */
export function createTestGitProvider(opts: TestGitProviderOptions): GitProvider {
  const fs = opts.fs;
  const remoteRegistry = opts.remoteRegistry;

  const provider: any = {
    fs,

    // Expose TREE helper for walk() usage
    TREE: (git as any).TREE,

    async init(args: any) {
      const dir = normalizePath(args?.dir);
      await mkdirp(fs, dir);
      return await (git as any).init({ fs: fs as any, ...args, dir });
    },

    async clone(args: any) {
      const dir = normalizePath(args?.dir);
      const url = normalizeRemoteUrl(args?.url || args?.remoteUrl || '');
      if (!url) throw new Error('TestGitProvider.clone: missing url');

      const remote = remoteRegistry.get(url);
      if (!remote) {
        throw new Error(`TestGitProvider.clone: remote not registered for url=${url}`);
      }

      await remote.init();
      await mkdirp(fs, dir);

      // Copy remote .git directory into local
      const srcGitDir = normalizePath(remote.gitdir);
      const dstGitDir = joinPath(dir, '.git');

      // Ensure destination is empty-ish; easiest is to mkdirp and overwrite contents
      await safeMkdir(fs, dstGitDir);

      await copyTree(remote.fs as any, srcGitDir, fs, dstGitDir);

      // Ensure origin remote exists in local config
      await ensureOriginConfig(fs, dir, url);

      // Create tracking refs for origin/* to match what sync utilities expect
      await updateTrackingRefsFromRemote({
        localFs: fs,
        localDir: dir,
        remoteFs: remote.fs as any,
        remoteDir: remote.dir,
        requestedRef: args?.ref
      });
    },

    async fetch(args: any) {
      const dir = normalizePath(args?.dir);
      const url = normalizeRemoteUrl(args?.url || '');
      if (!url) throw new Error('TestGitProvider.fetch: missing url');

      const remote = remoteRegistry.get(url);
      if (!remote) {
        throw new Error(`TestGitProvider.fetch: remote not registered for url=${url}`);
      }

      await remote.init();

      // Merge object database (and any pack files) from remote into local
      const srcObjects = joinPath(remote.gitdir, 'objects');
      const dstObjects = joinPath(dir, '.git', 'objects');
      await copyDirMerge(remote.fs as any, srcObjects, fs, dstObjects);

      // Also copy packed-refs if present (best-effort)
      try {
        await copyTree(remote.fs as any, joinPath(remote.gitdir, 'packed-refs'), fs, joinPath(dir, '.git', 'packed-refs'));
      } catch {
        // ignore
      }

      // Update origin tracking refs under refs/remotes/origin/*
      await updateTrackingRefsFromRemote({
        localFs: fs,
        localDir: dir,
        remoteFs: remote.fs as any,
        remoteDir: remote.dir,
        requestedRef: args?.ref
      });

      // Ensure origin config exists
      await ensureOriginConfig(fs, dir, url);
    },

    async push(args: any) {
      const dir = normalizePath(args?.dir);
      const url = normalizeRemoteUrl(args?.url || '');
      if (!url) throw new Error('TestGitProvider.push: missing url');

      const remote = remoteRegistry.get(url);
      if (!remote) {
        throw new Error(`TestGitProvider.push: remote not registered for url=${url}`);
      }

      await remote.init();

      const localGitDir = joinPath(dir, '.git');
      const remoteGitDir = normalizePath(remote.gitdir);

      // Merge objects from local to remote (ensures remote has required objects)
      const localObjects = joinPath(localGitDir, 'objects');
      const remoteObjects = joinPath(remoteGitDir, 'objects');
      await copyDirMerge(fs, localObjects, remote.fs as any, remoteObjects);

      // Resolve local ref to oid
      const localRef = args?.ref || 'HEAD';
      const localOid = await git.resolveRef({ fs: fs as any, dir, ref: localRef });

      // Determine remoteRef path (default refs/heads/<ref>)
      const remoteRef: string =
        args?.remoteRef ||
        (String(localRef).startsWith('refs/') ? String(localRef) : `refs/heads/${localRef}`);

      await writeRefFile(remote.fs as any, remoteGitDir, remoteRef, localOid);

      // Return a generic shape compatible with code that expects a response object
      return { success: true };
    },

    async listServerRefs(args: any) {
      const url = normalizeRemoteUrl(args?.url || '');
      if (!url) throw new Error('TestGitProvider.listServerRefs: missing url');

      const remote = remoteRegistry.get(url);
      if (!remote) {
        throw new Error(`TestGitProvider.listServerRefs: remote not registered for url=${url}`);
      }

      await remote.init();

      const heads = await listRemoteHeads(remote.fs as any, remote.dir);
      const prefix = args?.prefix ? String(args.prefix) : undefined;
      const filtered = prefix ? heads.filter((h) => h.ref.startsWith(prefix)) : heads;

      // Match expected shape used by needsUpdateUtil: { ref, oid }
      return filtered.map((h) => ({ ref: h.ref, oid: h.oid }));
    },

    // ---- Simple wrappers to isomorphic-git (local-only) ----

    async resolveRef(args: any) {
      try {
        const dir = normalizePath(args?.dir);
        if (args?.ref === 'HEAD' && typeof args?.depth === 'number' && args.depth > 1 && dir) {
          const headPath = joinPath(dir, '.git', 'HEAD');
          const raw = await fs.promises.readFile(headPath, 'utf8');
          const head = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as any);
          const m = head.trim().match(/^ref:\s*(refs\/heads\/.+)$/);
          if (m?.[1]) {
            return m[1];
          }
        }
      } catch {
        // fall through to default resolve
      }
      return await git.resolveRef({ fs: fs as any, ...args });
    },

    async deleteRef(args: any) {
      return await (git as any).deleteRef({ fs: fs as any, ...args });
    },

    async listRefs(args: any) {
      const dir = normalizePath(args?.dir);
      const refs: string[] = [];
      const branches = await git.listBranches({ fs: fs as any, dir });
      for (const b of branches) refs.push(`refs/heads/${b}`);

      let tags: string[] = [];
      try {
        tags = await (git as any).listTags({ fs: fs as any, dir });
      } catch {
        tags = [];
      }
      for (const t of tags) refs.push(`refs/tags/${t}`);

      return refs.map((r) => ({ ref: r }));
    },

    async listBranches(args: any) {
      return await git.listBranches({ fs: fs as any, ...args });
    },

    async listRemotes(args: any) {
      return await git.listRemotes({ fs: fs as any, ...args });
    },

    async branch(args: any) {
      return await (git as any).branch({ fs: fs as any, ...args });
    },

    async checkout(args: any) {
      return await git.checkout({ fs: fs as any, ...args });
    },

    async readCommit(args: any) {
      return await git.readCommit({ fs: fs as any, ...args });
    },

    async readBlob(args: any) {
      return await git.readBlob({ fs: fs as any, ...args });
    },

    async walk(args: any) {
      return await (git as any).walk({ fs: fs as any, ...args });
    },

    async log(args: any) {
      return await git.log({ fs: fs as any, ...args });
    },

    async add(args: any) {
      return await git.add({ fs: fs as any, ...args });
    },

    async remove(args: any) {
      return await (git as any).remove({ fs: fs as any, ...args });
    },

    async commit(args: any) {
      return await git.commit({ fs: fs as any, ...args });
    },

    async statusMatrix(args: any) {
      return await (git as any).statusMatrix({ fs: fs as any, ...args });
    },

    async findMergeBase(args: any) {
      return await (git as any).findMergeBase({ fs: fs as any, ...args });
    },

    async isDescendent(args: any) {
      return await (git as any).isDescendent({ fs: fs as any, ...args });
    },

    async setConfig(args: any) {
      return await (git as any).setConfig({ fs: fs as any, ...args });
    },

    async writeRef(args: any) {
      return await (git as any).writeRef({ fs: fs as any, ...args });
    },

    async addRemote(args: any) {
      return await (git as any).addRemote({ fs: fs as any, ...args });
    }
  };

  return provider as GitProvider;
}