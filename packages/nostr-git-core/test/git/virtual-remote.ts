import LightningFS from '@isomorphic-git/lightning-fs';
import * as git from 'isomorphic-git';

export interface VirtualGitRemoteAuthor {
  name: string;
  email: string;
}

export interface VirtualGitRemoteOptions {
  /** Optional injected LightningFS-like instance for advanced tests */
  fs?: any;
  /** Working directory for the remote repo (defaults to '/remote') */
  dir?: string;
  /** Default branch name (defaults to 'main') */
  defaultBranch?: string;
  /** Commit author used by helpers */
  author: VirtualGitRemoteAuthor;
}

export interface SeedResult {
  initialCommit: string;
  branch: string;
}

/**
 * VirtualGitRemote implements a deterministic Git repository hosted entirely
 * inside a LightningFS instance. It does not perform any network I/O.
 */
export class VirtualGitRemote {
  readonly fs: any;
  readonly dir: string;
  readonly defaultBranch: string;
  readonly author: VirtualGitRemoteAuthor;

  private initialized = false;

  constructor(options: VirtualGitRemoteOptions) {
    this.fs = options.fs ?? new (LightningFS as any)('virtual-remote');
    this.dir = options.dir ?? '/remote';
    this.defaultBranch = options.defaultBranch ?? 'main';
    this.author = options.author;
  }

  /** Underlying gitdir path for the remote repo */
  get gitdir(): string {
    return `${this.dir}/.git`;
  }

  /** Initialize the remote repository if it has not been initialized yet. */
  async init(): Promise<void> {
    if (this.initialized) return;

    await git.init({
      fs: this.fs as any,
      dir: this.dir,
      defaultBranch: this.defaultBranch,
    });

    this.initialized = true;
  }

  /** Write a text file into the remote working tree. */
  async writeFile(path: string, content: string): Promise<void> {
    await this.init();
    const pfs = (this.fs as any).promises as typeof this.fs.promises;
    const fullPath = `${this.dir}/${path.replace(/^\/+/, '')}`;
    const segments = fullPath.split('/').slice(0, -1);
    let acc = '';
    for (const segment of segments) {
      if (!segment) continue;
      acc += `/${segment}`;
      try {
        await pfs.mkdir(acc);
      } catch {
        // ignore EEXIST and other benign errors in tests
      }
    }

    await pfs.writeFile(fullPath, content, 'utf8');
  }

  /** Stage the given file paths relative to the repo root. */
  private async addAll(filepaths: string[]): Promise<void> {
    for (const filepath of filepaths) {
      await git.add({ fs: this.fs as any, dir: this.dir, filepath });
    }
  }

  /**
   * Commit helper used by tests.
   *
   * @param message Commit message
   * @param filepaths Paths relative to repo root to be staged before commit
   */
  async commit(message: string, filepaths: string[]): Promise<string> {
    await this.init();
    await this.addAll(filepaths);

    const oid = await git.commit({
      fs: this.fs as any,
      dir: this.dir,
      message,
      author: this.author,
    });

    return oid;
  }

  /** Seed the remote with a single initial commit containing the provided files. */
  async seed(files: Record<string, string>, message = 'initial commit'): Promise<SeedResult> {
    await this.init();

    const filepaths: string[] = [];
    for (const [filepath, content] of Object.entries(files)) {
      await this.writeFile(filepath, content);
      filepaths.push(filepath);
    }

    const initialCommit = await this.commit(message, filepaths);
    return { initialCommit, branch: this.defaultBranch };
  }

  /** Return the current commit log (most recent first). */
  async log(ref: string = 'HEAD'): Promise<git.ReadCommitResult[]> {
    await this.init();
    const entries = await git.log({ fs: this.fs as any, dir: this.dir, ref });
    return entries;
  }

  /** Convenience: read a text file from the remote working tree. */
  async readFile(path: string): Promise<string> {
    await this.init();
    const pfs = (this.fs as any).promises as typeof this.fs.promises;
    const fullPath = `${this.dir}/${path.replace(/^\/+/, '')}`;
    const buf = await pfs.readFile(fullPath, 'utf8');
    return typeof buf === 'string' ? buf : new TextDecoder().decode(buf as any);
  }

  /**
   * Naive "push" implementation used only in tests.
   * Copies refs and objects from a local repo in the same LightningFS instance
   * into this remote repo, mimicking a push of all reachable data.
   */
  async mirrorFromLocal(localDir: string): Promise<void> {
    await this.init();
    const pfs = (this.fs as any).promises as typeof this.fs.promises;
    const srcGit = `${localDir}/.git`;
    const dstGit = this.gitdir;

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
}
