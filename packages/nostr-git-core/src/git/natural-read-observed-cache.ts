import {GitNaturalObjectCache, normalizeObjectHash} from "./natural-read-cache.js"
import {createGitNaturalIndexedObjectStore} from "./natural-read-indexed-cache.js"

export type GitNaturalObservedBytes = Uint8Array | ArrayBuffer | ArrayBufferView

export class GitNaturalObservedObjectBridge {
  private readonly cache: GitNaturalObjectCache

  constructor(cache?: GitNaturalObjectCache) {
    this.cache =
      cache ??
      new GitNaturalObjectCache({
        asyncStore: createGitNaturalIndexedObjectStore(),
      })
  }

  cacheBlob(hash: string | undefined | null, data: GitNaturalObservedBytes | undefined | null): boolean {
    try {
      const normalizedHash = normalizeObjectHash(hash || "")
      if (!/^[0-9a-f]{40}$/.test(normalizedHash) || !data) return false
      this.cache.putBlob({hash: normalizedHash, data: copyBytes(data)})
      return true
    } catch {
      return false
    }
  }

  async flushPersistence(): Promise<void> {
    await this.cache.flushPersistence()
  }

  close(): void {
    this.cache.close()
  }
}

const defaultBridge = new GitNaturalObservedObjectBridge()

export function cacheObservedGitNaturalBlob(
  hash: string | undefined | null,
  data: GitNaturalObservedBytes | undefined | null,
): boolean {
  return defaultBridge.cacheBlob(hash, data)
}

function copyBytes(data: GitNaturalObservedBytes): Uint8Array {
  if (data instanceof Uint8Array) return new Uint8Array(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0))
  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
}
