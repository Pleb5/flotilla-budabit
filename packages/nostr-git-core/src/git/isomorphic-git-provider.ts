import * as isogit from "isomorphic-git"
import {GitFetchResult, GitMergeResult, GitProvider} from "./provider.js"

export class IsomorphicGitProvider implements GitProvider {
  fs: any
  http: any
  corsProxy: string | null
  defaultDir?: string

  constructor(options: {fs: any; http: any; corsProxy: string | null; defaultDir?: string}) {
    this.fs = options.fs
    this.http = options.http
    this.corsProxy = options.corsProxy
    this.defaultDir = options.defaultDir
  }

  private pickCorsProxy(options: any): any {
    return "corsProxy" in options ? options.corsProxy : this.corsProxy
  }

  private pickDir(options: any): any {
    return "dir" in options ? options.dir : this.defaultDir
  }

  private withDir(options: any): any {
    const dir = this.pickDir(options)
    return dir ? {...options, dir} : options
  }

  // Return a tree walker for the given ref (commit-ish)
  TREE(options: {ref: string}) {
    // isomorphic-git exposes TREE as a function for tree-walking
    // https://isomorphic-git.org/docs/en/TREE
    return (isogit as any).TREE({...this.withDir(options), fs: this.fs})
  }
  // Repository
  async clone(options: any) {
    const corsProxy = this.pickCorsProxy(options)
    return isogit.clone({...this.withDir(options), fs: this.fs, http: this.http, corsProxy})
  }
  async commit(options: any) {
    return isogit.commit({...this.withDir(options), fs: this.fs})
  }
  async fetch(options: any) {
    const corsProxy = this.pickCorsProxy(options)
    return isogit.fetch({
      ...this.withDir(options),
      fs: this.fs,
      http: this.http,
      corsProxy,
    }) as Promise<GitFetchResult>
  }
  async init(options: any) {
    return isogit.init({...this.withDir(options), fs: this.fs})
  }
  async log(options: any) {
    return isogit.log({...this.withDir(options), fs: this.fs})
  }
  async merge(options: any) {
    return isogit.merge({...this.withDir(options), fs: this.fs}) as Promise<GitMergeResult>
  }
  async pull(options: any) {
    const corsProxy = this.pickCorsProxy(options)
    return isogit.pull({...this.withDir(options), fs: this.fs, http: this.http, corsProxy})
  }
  async push(options: any) {
    // Allow caller to override corsProxy (e.g., set to null for GRASP to disable proxy)
    // Check if corsProxy is explicitly provided in options (even if null/undefined)
    const corsProxy = "corsProxy" in options ? options.corsProxy : this.corsProxy
    // Allow caller to override http client (e.g., for NIP-98 auth injection)
    const http = options.http || this.http
    return isogit.push({...this.withDir(options), fs: this.fs, http, corsProxy})
  }
  async status(options: any) {
    return isogit.status({...this.withDir(options), fs: this.fs})
  }
  async statusMatrix(options: any) {
    return isogit.statusMatrix({...this.withDir(options), fs: this.fs})
  }
  async version() {
    return isogit.version()
  }

  // Branches
  async deleteBranch(options: any) {
    return isogit.deleteBranch({...this.withDir(options), fs: this.fs})
  }
  async listBranches(options: any) {
    return isogit.listBranches({...this.withDir(options), fs: this.fs})
  }
  async renameBranch(options: any) {
    return isogit.renameBranch({...this.withDir(options), fs: this.fs})
  }
  async branch(options: any) {
    return isogit.branch({...this.withDir(options), fs: this.fs})
  }

  // Tags
  async deleteTag(options: any) {
    return isogit.deleteTag({...this.withDir(options), fs: this.fs})
  }
  async listTags(options: any) {
    return isogit.listTags({...this.withDir(options), fs: this.fs})
  }
  async tag(options: any) {
    return isogit.tag({...this.withDir(options), fs: this.fs})
  }

  // Files
  async add(options: any) {
    return isogit.add({...this.withDir(options), fs: this.fs})
  }
  async addNote(options: any) {
    return isogit.addNote({...this.withDir(options), fs: this.fs})
  }
  async listFiles(options: any) {
    return isogit.listFiles({...this.withDir(options), fs: this.fs})
  }
  async readBlob(options: any) {
    return isogit.readBlob({...this.withDir(options), fs: this.fs})
  }
  async readCommit(options: any) {
    return isogit.readCommit({...this.withDir(options), fs: this.fs})
  }
  async readNote(options: any) {
    return isogit.readNote({...this.withDir(options), fs: this.fs})
  }
  async readObject(options: any) {
    return isogit.readObject({...this.withDir(options), fs: this.fs})
  }
  async readTag(options: any) {
    return isogit.readTag({...this.withDir(options), fs: this.fs})
  }
  async readTree(options: any) {
    return isogit.readTree({...this.withDir(options), fs: this.fs})
  }
  async remove(options: any) {
    return isogit.remove({...this.withDir(options), fs: this.fs})
  }
  async removeNote(options: any) {
    return isogit.removeNote({...this.withDir(options), fs: this.fs})
  }
  async writeBlob(options: any) {
    return isogit.writeBlob({...this.withDir(options), fs: this.fs})
  }
  async writeCommit(options: any) {
    return isogit.writeCommit({...this.withDir(options), fs: this.fs})
  }
  async writeObject(options: any) {
    return isogit.writeObject({...this.withDir(options), fs: this.fs})
  }
  async writeRef(options: any) {
    return isogit.writeRef({...this.withDir(options), fs: this.fs})
  }
  async writeTag(options: any) {
    return isogit.writeTag({...this.withDir(options), fs: this.fs})
  }
  async writeTree(options: any) {
    return isogit.writeTree({...this.withDir(options), fs: this.fs})
  }

  // Remotes
  async deleteRemote(options: any) {
    return isogit.deleteRemote({...this.withDir(options), fs: this.fs})
  }
  async getRemoteInfo(options: any) {
    const corsProxy = this.pickCorsProxy(options)
    return isogit.getRemoteInfo({
      ...options,
      fs: this.fs,
      http: this.http,
      corsProxy,
    })
  }
  async getRemoteInfo2(options: any) {
    const corsProxy = this.pickCorsProxy(options)
    return (isogit as any).getRemoteInfo2({
      ...options,
      fs: this.fs,
      http: this.http,
      corsProxy,
    })
  }
  async listRemotes(options: any) {
    return isogit.listRemotes({...this.withDir(options), fs: this.fs})
  }
  async listServerRefs(options: any) {
    const corsProxy = this.pickCorsProxy(options)
    return (isogit as any).listServerRefs({
      ...options,
      fs: this.fs,
      http: this.http,
      corsProxy,
    })
  }
  async addRemote(options: any) {
    return isogit.addRemote({...this.withDir(options), fs: this.fs})
  }

  // Working Directory
  async checkout(options: any) {
    return isogit.checkout({...this.withDir(options), fs: this.fs})
  }

  // Config
  async getConfig(options: any) {
    return isogit.getConfig({...this.withDir(options), fs: this.fs})
  }
  async getConfigAll(options: any) {
    return isogit.getConfigAll({...this.withDir(options), fs: this.fs})
  }
  async setConfig(options: any) {
    return isogit.setConfig({...this.withDir(options), fs: this.fs})
  }

  // Refs
  async deleteRef(options: any) {
    return isogit.deleteRef({...this.withDir(options), fs: this.fs})
  }
  async expandOid(options: any) {
    return isogit.expandOid({...this.withDir(options), fs: this.fs})
  }
  async expandRef(options: any) {
    return isogit.expandRef({...this.withDir(options), fs: this.fs})
  }
  async fastForward(options: any) {
    return isogit.fastForward({...this.withDir(options), fs: this.fs})
  }
  async findMergeBase(options: any) {
    return isogit.findMergeBase({...this.withDir(options), fs: this.fs})
  }
  async findRoot(options: any) {
    return isogit.findRoot({...this.withDir(options), fs: this.fs})
  }
  async hashBlob(options: any) {
    return isogit.hashBlob({...this.withDir(options), fs: this.fs})
  }
  async indexPack(options: any) {
    return isogit.indexPack({...this.withDir(options), fs: this.fs})
  }
  async isDescendent(options: any) {
    return isogit.isDescendent({...this.withDir(options), fs: this.fs})
  }
  async isIgnored(options: any) {
    return isogit.isIgnored({...this.withDir(options), fs: this.fs})
  }
  async listNotes(options: any) {
    return isogit.listNotes({...this.withDir(options), fs: this.fs})
  }
  async listRefs(options: any) {
    return isogit.listRefs({...this.withDir(options), fs: this.fs})
  }
  async packObjects(options: any) {
    return isogit.packObjects({...this.withDir(options), fs: this.fs})
  }
  async resetIndex(options: any) {
    return isogit.resetIndex({...this.withDir(options), fs: this.fs})
  }
  async resolveRef(options: any) {
    return isogit.resolveRef({...this.withDir(options), fs: this.fs})
  }
  async stash(options: any) {
    return isogit.stash({...this.withDir(options), fs: this.fs})
  }
  async updateIndex(options: any) {
    return isogit.updateIndex({...this.withDir(options), fs: this.fs})
  }
  async walk(options: any) {
    return isogit.walk({...this.withDir(options), fs: this.fs})
  }
}
