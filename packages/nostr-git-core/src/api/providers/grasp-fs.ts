/**
 * In-memory filesystem utility for isomorphic-git.
 *
 * Provides a full fs.promises interface backed by a Map for files
 * and a Set for directories.
 * Used in GraspApi.listCommits() and GraspApi.getCommit() to avoid duplication.
 */

export function createMemFs(): any {
  const memfs = new Map<string, Uint8Array>();
  const dirs = new Set<string>(['/']);

  const normalizePath = (path: string): string => {
    if (!path.startsWith('/')) path = '/' + path;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return path.replace(/\\/g, '/');
  };

  const ensureDirHierarchy = (targetPath: string) => {
    const normalizedPath = normalizePath(targetPath);
    const parts = normalizedPath.split('/');
    let current = '';
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!part) {
        current = '/';
        dirs.add('/');
        continue;
      }
      current = current === '/' ? `/${part}` : `${current}/${part}`;
      dirs.add(current);
    }
  };

  const getStatResult = (path: string) => {
    const normalized = normalizePath(path);
    if (memfs.has(normalized)) {
      return {
        isFile: () => true,
        isDirectory: () => false,
      };
    }
    if (dirs.has(normalized)) {
      return {
        isFile: () => false,
        isDirectory: () => true,
      };
    }
    const err: any = new Error(`ENOENT: no such file or directory, stat '${path}'`);
    err.code = 'ENOENT';
    throw err;
  };

  const readFile = async (path: string): Promise<Uint8Array> => {
    const normalized = normalizePath(path);
    const data = memfs.get(normalized);
    if (!data) {
      const err: any = new Error(`ENOENT: no such file or directory, open '${path}'`);
      err.code = 'ENOENT';
      throw err;
    }
    return data;
  };

  const writeFile = async (path: string, data: Uint8Array): Promise<void> => {
    const normalized = normalizePath(path);
    ensureDirHierarchy(normalized);
    memfs.set(normalized, data);
  };

  const mkdir = async (path: string, _opts?: any): Promise<void> => {
    const normalized = normalizePath(path);
    ensureDirHierarchy(normalized);
    dirs.add(normalized);
  };

  const readdir = async (path: string): Promise<string[]> => {
    const normalized = normalizePath(path);
    const prefix = normalized === '/' ? '/' : `${normalized}/`;
    const entries = new Set<string>();

    for (const dirPath of dirs) {
      if (dirPath === normalized) continue;
      if (dirPath.startsWith(prefix)) {
        const remainder = dirPath.slice(prefix.length);
        if (remainder && !remainder.includes('/')) {
          entries.add(remainder);
        }
      }
    }

    for (const filePath of memfs.keys()) {
      if (filePath.startsWith(prefix)) {
        const remainder = filePath.slice(prefix.length);
        if (remainder && !remainder.includes('/')) {
          entries.add(remainder);
        }
      }
    }

    return Array.from(entries);
  };

  const stat = async (path: string) => getStatResult(path);
  const lstat = async (path: string) => getStatResult(path);

  const unlink = async (path: string): Promise<void> => {
    const normalized = normalizePath(path);
    memfs.delete(normalized);
  };

  const rmdir = async (path: string): Promise<void> => {
    const normalized = normalizePath(path);
    dirs.delete(normalized);
  };

  return {
    promises: {
      readFile,
      writeFile,
      mkdir,
      readdir,
      stat,
      lstat,
      unlink,
      rmdir,
    },
  } as any;
}