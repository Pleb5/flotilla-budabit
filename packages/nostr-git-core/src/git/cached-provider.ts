import type { GitProvider } from "./provider.js"
import type {CacheMode, GitConfig} from "./config.js"

// Simple per-dir cache store with TTL
type CacheEntry = {cache: Record<string | symbol, any>; lastUsed: number}

export class CachedGitProvider implements GitProvider {
  private readonly inner: GitProvider
  // Expose the underlying provider for environments that need direct fs access (e.g., workers)
  public readonly baseProvider: GitProvider
  private readonly mode: CacheMode
  private readonly ttl: number
  private readonly caches = new Map<string, CacheEntry>()

  constructor(inner: GitProvider, cfg: GitConfig) {
    this.inner = inner
    this.baseProvider = inner
    this.mode = cfg.cacheMode
    this.ttl = cfg.cacheMaxAgeMs
  }

  // Forward fs property if present on the inner provider (e.g., IsomorphicGitProvider with LightningFS)
  get fs(): any {
    return (this.inner as any)?.fs
  }

  // --- cache helpers ---
  private now() {
    return Date.now()
  }

  private getDir(options: any): string | undefined {
    return options?.dir
  }

  private getCache(options: any): any {
    if (this.mode === "off") return undefined
    const dir = this.getDir(options)
    if (!dir) return undefined

    // expire
    const entry = this.caches.get(dir)
    const now = this.now()
    if (entry && now - entry.lastUsed > this.ttl) {
      this.caches.delete(dir)
    }

    // ensure
    let next = this.caches.get(dir)
    if (!next) {
      next = {cache: {}, lastUsed: now}
      this.caches.set(dir, next)
    } else {
      next.lastUsed = now
    }
    return next.cache
  }

  private invalidate(options: any) {
    const dir = this.getDir(options)
    if (!dir) return
    // Replace cache object so old one can be GC'd
    if (this.caches.has(dir)) {
      this.caches.set(dir, {cache: {}, lastUsed: this.now()})
    }
  }

  // Inject cache into read-ish operations
  private withCache<T extends object>(options: T): T {
    if (this.mode === "off") return options
    const cache = this.getCache(options)
    if (cache) return {...(options as any), cache}
    return options
  }

  // --- GitProvider delegation ---
  TREE(options: {ref: string}): any {
    return this.inner.TREE(options)
  }

  // Repository
  async clone(options: any) {
    const r = await this.inner.clone(options)
    this.invalidate(options)
    return r
  }
  async commit(options: any) {
    const r = await this.inner.commit(options)
    this.invalidate(options)
    return r
  }
  async fetch(options: any) {
    const r = await this.inner.fetch(options)
    this.invalidate(options)
    return r
  }
  async init(options: any) {
    const r = await this.inner.init(options)
    this.invalidate(options)
    return r
  }
  async log(options: any) {
    return this.inner.log(this.withCache(options))
  }
  async merge(options: any) {
    const r = await this.inner.merge(options)
    this.invalidate(options)
    return r
  }
  async pull(options: any) {
    const r = await this.inner.pull(options)
    this.invalidate(options)
    return r
  }
  async push(options: any) {
    const r = await this.inner.push(options)
    this.invalidate(options)
    return r
  }
  async status(options: any) {
    return this.inner.status(this.withCache(options))
  }
  async statusMatrix(options: any) {
    return this.inner.statusMatrix(this.withCache(options))
  }

  // Branches
  async deleteBranch(options: any) {
    const r = await this.inner.deleteBranch(options)
    this.invalidate(options)
    return r
  }
  async listBranches(options: any) {
    return this.inner.listBranches(this.withCache(options))
  }
  async renameBranch(options: any) {
    const r = await this.inner.renameBranch(options)
    this.invalidate(options)
    return r
  }
  async branch(options: any) {
    const r = await this.inner.branch(options)
    this.invalidate(options)
    return r
  }

  // Tags
  async deleteTag(options: any) {
    const r = await this.inner.deleteTag(options)
    this.invalidate(options)
    return r
  }
  async listTags(options: any) {
    return this.inner.listTags(this.withCache(options))
  }
  async tag(options: any) {
    const r = await this.inner.tag(options)
    this.invalidate(options)
    return r
  }

  // Files
  async add(options: any) {
    const r = await this.inner.add(options)
    this.invalidate(options)
    return r
  }
  async addNote(options: any) {
    const r = await this.inner.addNote(options)
    this.invalidate(options)
    return r
  }
  async listFiles(options: any) {
    return this.inner.listFiles(this.withCache(options))
  }
  async readBlob(options: any) {
    return this.inner.readBlob(this.withCache(options))
  }
  async readCommit(options: any) {
    return this.inner.readCommit(this.withCache(options))
  }
  async readNote(options: any) {
    return this.inner.readNote(this.withCache(options))
  }
  async readObject(options: any) {
    return this.inner.readObject(this.withCache(options))
  }
  async readTag(options: any) {
    return this.inner.readTag(this.withCache(options))
  }
  async readTree(options: any) {
    return this.inner.readTree(this.withCache(options))
  }
  async remove(options: any) {
    const r = await this.inner.remove(options)
    this.invalidate(options)
    return r
  }
  async removeNote(options: any) {
    const r = await this.inner.removeNote(options)
    this.invalidate(options)
    return r
  }
  async writeBlob(options: any) {
    const r = await this.inner.writeBlob(options)
    this.invalidate(options)
    return r
  }
  async writeCommit(options: any) {
    const r = await this.inner.writeCommit(options)
    this.invalidate(options)
    return r
  }
  async writeObject(options: any) {
    const r = await this.inner.writeObject(options)
    this.invalidate(options)
    return r
  }
  async writeRef(options: any) {
    const r = await this.inner.writeRef(options)
    this.invalidate(options)
    return r
  }
  async writeTag(options: any) {
    const r = await this.inner.writeTag(options)
    this.invalidate(options)
    return r
  }
  async writeTree(options: any) {
    const r = await this.inner.writeTree(options)
    this.invalidate(options)
    return r
  }

  // Remotes
  async deleteRemote(options: any) {
    const r = await this.inner.deleteRemote(options)
    this.invalidate(options)
    return r
  }
  async getRemoteInfo(options: any) {
    return this.inner.getRemoteInfo(this.withCache(options))
  }
  async getRemoteInfo2(options: any) {
    return this.inner.getRemoteInfo2(this.withCache(options))
  }
  async listRemotes(options: any) {
    return this.inner.listRemotes(this.withCache(options))
  }
  async listServerRefs(options: any) {
    return this.inner.listServerRefs(this.withCache(options))
  }
  async addRemote(options: any) {
    const r = await this.inner.addRemote(options)
    this.invalidate(options)
    return r
  }

  // Working Directory
  async checkout(options: any) {
    const r = await this.inner.checkout(options)
    this.invalidate(options)
    return r
  }

  // Config
  async getConfig(options: any) {
    return this.inner.getConfig(this.withCache(options))
  }
  async getConfigAll(options: any) {
    return this.inner.getConfigAll(this.withCache(options))
  }
  async setConfig(options: any) {
    const r = await this.inner.setConfig(options)
    this.invalidate(options)
    return r
  }

  // Refs
  async deleteRef(options: any) {
    const r = await this.inner.deleteRef(options)
    this.invalidate(options)
    return r
  }
  async expandOid(options: any) {
    return this.inner.expandOid(this.withCache(options))
  }
  async expandRef(options: any) {
    return this.inner.expandRef(this.withCache(options))
  }
  async fastForward(options: any) {
    const r = await this.inner.fastForward(options)
    this.invalidate(options)
    return r
  }
  async findMergeBase(options: any) {
    return this.inner.findMergeBase(this.withCache(options))
  }
  async findRoot(options: any) {
    return this.inner.findRoot(this.withCache(options))
  }
  async hashBlob(options: any) {
    return this.inner.hashBlob(this.withCache(options))
  }
  async indexPack(options: any) {
    return this.inner.indexPack(this.withCache(options))
  }
  async isDescendent(options: any) {
    return this.inner.isDescendent(this.withCache(options))
  }
  async isIgnored(options: any) {
    return this.inner.isIgnored(this.withCache(options))
  }
  async listNotes(options: any) {
    return this.inner.listNotes(this.withCache(options))
  }
  async listRefs(options: any) {
    return this.inner.listRefs(this.withCache(options))
  }
  async packObjects(options: any) {
    return this.inner.packObjects(this.withCache(options))
  }
  async resetIndex(options: any) {
    const r = await this.inner.resetIndex(options)
    this.invalidate(options)
    return r
  }
  async resolveRef(options: any) {
    return this.inner.resolveRef(this.withCache(options))
  }
  async stash(options: any) {
    const r = await this.inner.stash(options)
    this.invalidate(options)
    return r
  }
  async updateIndex(options: any) {
    const r = await this.inner.updateIndex(options)
    this.invalidate(options)
    return r
  }
  async version() {
    return this.inner.version()
  }
  async walk(options: any) {
    return this.inner.walk(this.withCache(options))
  }
}
