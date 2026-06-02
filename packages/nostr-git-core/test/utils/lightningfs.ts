import LightningFS from '@isomorphic-git/lightning-fs';
import { uniqueFsName } from './names.js';

export type LightningFsLike = {
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

export type TestFs = InstanceType<typeof LightningFS> & LightningFsLike;

function normalizePath(path: string): string {
  if (!path) return '/';
  let p = path.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

export function createTestFs(prefix: string = 'test'): TestFs {
  const name = uniqueFsName(prefix);
  return new (LightningFS as any)(name) as TestFs;
}

export async function mkdirp(fs: LightningFsLike, path: string): Promise<void> {
  const p = normalizePath(path);
  const parts = p.split('/').filter(Boolean);

  let acc = '';
  for (const part of parts) {
    acc += `/${part}`;
    try {
      await fs.promises.mkdir(acc);
    } catch (e: any) {
      // LightningFS may throw EEXIST or other benign errors when directory exists
      const code = e?.code;
      const msg = String(e?.message || '');
      if (code === 'EEXIST') continue;
      if (msg.toLowerCase().includes('exists')) continue;
    }
  }
}

function dirname(path: string): string {
  const p = normalizePath(path);
  const idx = p.lastIndexOf('/');
  if (idx <= 0) return '/';
  return p.slice(0, idx);
}

export async function writeText(fs: LightningFsLike, fullPath: string, content: string): Promise<void> {
  const p = normalizePath(fullPath);
  await mkdirp(fs, dirname(p));
  await fs.promises.writeFile(p, content, 'utf8');
}

export async function readText(fs: LightningFsLike, fullPath: string): Promise<string> {
  const p = normalizePath(fullPath);
  const data = await fs.promises.readFile(p, 'utf8');
  return typeof data === 'string' ? data : new TextDecoder().decode(data as any);
}