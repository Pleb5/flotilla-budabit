import type { GitProvider } from './provider.js';
import { createGitProvider } from './factory.js';
import type {
  VendorProvider,
  RepoMetadata,
  CreateRepoOptions,
  UpdateRepoOptions
} from './vendor-providers.js';
import { parseRepoFromUrl, resolveVendorProvider } from './vendor-provider-factory.js';
import {
  createAuthRequiredError,
  createInvalidInputError,
  type GitErrorContext,
} from '../errors/index.js';
// Core no longer imports isomorphic-git or LightningFS directly; we rely on git-wrapper factory.

/**
 * Enhanced GitProvider that supports multiple Git service vendors
 * Wraps the base IsomorphicGitProvider with vendor-specific functionality
 */
export class MultiVendorGitProvider implements GitProvider {
  private baseProvider: GitProvider;
  private tokenStore: Map<string, string> = new Map();

  constructor(options?: { baseProvider?: GitProvider }) {
    this.baseProvider = options?.baseProvider ?? createGitProvider();
  }

  // Forward fs property if present on the base provider (needed for direct filesystem access)
  get fs(): any {
    return (this.baseProvider as any)?.fs;
  }

  // Token management
  setTokens(tokens: Array<{ host: string; token: string }>): void {
    this.tokenStore.clear();
    for (const { host, token } of tokens) {
      this.tokenStore.set(host.toLowerCase(), token);
    }
  }

  getToken(hostname: string): string | undefined {
    return this.tokenStore.get(hostname.toLowerCase());
  }

  // Vendor-specific operations
  async getRepoMetadata(url: string): Promise<RepoMetadata> {
    const parsed = parseRepoFromUrl(url);
    if (!parsed) {
      throw createInvalidInputError(
        `Unable to parse repository URL: ${url}`,
        this.buildContext({ remote: url, operation: 'getRepoMetadata' })
      );
    }

    const { provider, owner, repo } = parsed;
    const token = this.getToken(provider.hostname);

    return provider.getRepoMetadata(owner, repo, token);
  }

  async createRemoteRepo(
    name: string,
    options: CreateRepoOptions & { targetHost: string }
  ): Promise<RepoMetadata> {
    const { targetHost, ...createOptions } = options;
    const vendorUrl = targetHost.startsWith('http') ? targetHost : `https://${targetHost}`;
    const vendor = resolveVendorProvider(vendorUrl);
    const token = this.getToken(vendor.hostname);

    if (!token) {
      throw createAuthRequiredError(
        this.buildContext({ remote: vendorUrl, operation: 'createRemoteRepo' })
      );
    }

    return vendor.createRepo(name, createOptions, token);
  }

  async updateRemoteRepo(url: string, options: UpdateRepoOptions): Promise<RepoMetadata> {
    const parsed = parseRepoFromUrl(url);
    if (!parsed) {
      throw createInvalidInputError(
        `Unable to parse repository URL: ${url}`,
        this.buildContext({ remote: url, operation: 'updateRemoteRepo' })
      );
    }

    const { provider, owner, repo } = parsed;
    const token = this.getToken(provider.hostname);

    if (!token) {
      throw createAuthRequiredError(
        this.buildContext({ remote: url, operation: 'updateRemoteRepo' })
      );
    }

    return provider.updateRepo(owner, repo, options, token);
  }

  async forkRemoteRepo(url: string, forkName: string): Promise<RepoMetadata> {
    const parsed = parseRepoFromUrl(url);
    if (!parsed) {
      throw createInvalidInputError(
        `Unable to parse repository URL: ${url}`,
        this.buildContext({ remote: url, operation: 'forkRemoteRepo' })
      );
    }

    const { provider, owner, repo } = parsed;
    const token = this.getToken(provider.hostname);

    if (!token) {
      throw createAuthRequiredError(
        this.buildContext({ remote: url, operation: 'forkRemoteRepo' })
      );
    }

    return provider.forkRepo(owner, repo, forkName, token);
  }

  getVendorProvider(url: string): VendorProvider {
    return resolveVendorProvider(url);
  }

  private buildContext(context: GitErrorContext): GitErrorContext {
    return {
      ...context,
    };
  }

  // Delegate all base Git operations to the underlying provider
  TREE(options: { ref: string }): any {
    return this.baseProvider.TREE(options);
  }

  clone(options: any): Promise<void> {
    return this.baseProvider.clone(options);
  }

  commit(options: any): Promise<string> {
    return this.baseProvider.commit(options);
  }

  fetch(options: any): Promise<any> {
    return this.baseProvider.fetch(options);
  }

  init(options: any): Promise<any> {
    return this.baseProvider.init(options);
  }

  log(options: any): Promise<any> {
    return this.baseProvider.log(options);
  }

  merge(options: any): Promise<any> {
    return this.baseProvider.merge(options);
  }

  pull(options: any): Promise<any> {
    return this.baseProvider.pull(options);
  }

  push(options: any): Promise<any> {
    return this.baseProvider.push(options);
  }

  status(options: any): Promise<any> {
    return this.baseProvider.status(options);
  }

  statusMatrix(options: any): Promise<any> {
    return this.baseProvider.statusMatrix(options);
  }

  deleteBranch(options: any): Promise<any> {
    return this.baseProvider.deleteBranch(options);
  }

  listBranches(options: any): Promise<any> {
    return this.baseProvider.listBranches(options);
  }

  renameBranch(options: any): Promise<any> {
    return this.baseProvider.renameBranch(options);
  }

  branch(options: any): Promise<any> {
    return this.baseProvider.branch(options);
  }

  deleteTag(options: any): Promise<any> {
    return this.baseProvider.deleteTag(options);
  }

  listTags(options: any): Promise<any> {
    return this.baseProvider.listTags(options);
  }

  tag(options: any): Promise<any> {
    return this.baseProvider.tag(options);
  }

  add(options: any): Promise<any> {
    return this.baseProvider.add(options);
  }

  addNote(options: any): Promise<any> {
    return this.baseProvider.addNote(options);
  }

  listFiles(options: any): Promise<any> {
    return this.baseProvider.listFiles(options);
  }

  readBlob(options: any): Promise<any> {
    return this.baseProvider.readBlob(options);
  }

  readCommit(options: any): Promise<any> {
    return this.baseProvider.readCommit(options);
  }

  readNote(options: any): Promise<any> {
    return this.baseProvider.readNote(options);
  }

  readObject(options: any): Promise<any> {
    return this.baseProvider.readObject(options);
  }

  readTag(options: any): Promise<any> {
    return this.baseProvider.readTag(options);
  }

  readTree(options: any): Promise<any> {
    return this.baseProvider.readTree(options);
  }

  remove(options: any): Promise<any> {
    return this.baseProvider.remove(options);
  }

  removeNote(options: any): Promise<any> {
    return this.baseProvider.removeNote(options);
  }

  writeBlob(options: any): Promise<any> {
    return this.baseProvider.writeBlob(options);
  }

  writeCommit(options: any): Promise<any> {
    return this.baseProvider.writeCommit(options);
  }

  writeObject(options: any): Promise<any> {
    return this.baseProvider.writeObject(options);
  }

  writeRef(options: any): Promise<any> {
    return this.baseProvider.writeRef(options);
  }

  writeTag(options: any): Promise<any> {
    return this.baseProvider.writeTag(options);
  }

  writeTree(options: any): Promise<any> {
    return this.baseProvider.writeTree(options);
  }

  deleteRemote(options: any): Promise<any> {
    return this.baseProvider.deleteRemote(options);
  }

  getRemoteInfo(options: any): Promise<any> {
    return this.baseProvider.getRemoteInfo(options);
  }

  getRemoteInfo2(options: any): Promise<any> {
    return this.baseProvider.getRemoteInfo2(options);
  }

  listRemotes(options: any): Promise<any> {
    return this.baseProvider.listRemotes(options);
  }

  listServerRefs(options: any): Promise<any> {
    return this.baseProvider.listServerRefs(options);
  }

  addRemote(options: any): Promise<any> {
    return this.baseProvider.addRemote(options);
  }

  checkout(options: any): Promise<any> {
    return this.baseProvider.checkout(options);
  }

  getConfig(options: any): Promise<any> {
    return this.baseProvider.getConfig(options);
  }

  getConfigAll(options: any): Promise<any> {
    return this.baseProvider.getConfigAll(options);
  }

  setConfig(options: any): Promise<any> {
    return this.baseProvider.setConfig(options);
  }

  deleteRef(options: any): Promise<any> {
    return this.baseProvider.deleteRef(options);
  }

  expandOid(options: any): Promise<any> {
    return this.baseProvider.expandOid(options);
  }

  expandRef(options: any): Promise<any> {
    return this.baseProvider.expandRef(options);
  }

  fastForward(options: any): Promise<any> {
    return this.baseProvider.fastForward(options);
  }

  findMergeBase(options: any): Promise<any> {
    return this.baseProvider.findMergeBase(options);
  }

  findRoot(options: any): Promise<any> {
    return this.baseProvider.findRoot(options);
  }

  hashBlob(options: any): Promise<any> {
    return this.baseProvider.hashBlob(options);
  }

  indexPack(options: any): Promise<any> {
    return this.baseProvider.indexPack(options);
  }

  isDescendent(options: any): Promise<any> {
    return this.baseProvider.isDescendent(options);
  }

  isIgnored(options: any): Promise<any> {
    return this.baseProvider.isIgnored(options);
  }

  listNotes(options: any): Promise<any> {
    return this.baseProvider.listNotes(options);
  }

  listRefs(options: any): Promise<any> {
    return this.baseProvider.listRefs(options);
  }

  packObjects(options: any): Promise<any> {
    return this.baseProvider.packObjects(options);
  }

  resetIndex(options: any): Promise<any> {
    return this.baseProvider.resetIndex(options);
  }

  resolveRef(options: any): Promise<any> {
    return this.baseProvider.resolveRef(options);
  }

  stash(options: any): Promise<any> {
    return this.baseProvider.stash(options);
  }

  updateIndex(options: any): Promise<any> {
    return this.baseProvider.updateIndex(options);
  }

  version(): Promise<any> {
    return this.baseProvider.version();
  }

  walk(options: any): Promise<any> {
    return this.baseProvider.walk(options);
  }
}
