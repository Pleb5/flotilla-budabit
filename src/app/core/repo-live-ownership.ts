import {writable, type Readable} from "svelte/store"
import {Address, isRelayUrl, normalizeRelayUrl} from "@welshman/util"
import {GIT_REPO_ANNOUNCEMENT} from "@nostr-git/core/events"

export type RepoLiveOwnership = ReadonlySet<string>

export const canonicalizeRepoLiveAddress = (address: string) => {
  try {
    const ref = Address.from(address)
    return ref.kind === GIT_REPO_ANNOUNCEMENT && ref.pubkey && ref.identifier ? ref.toString() : ""
  } catch {
    return ""
  }
}

export const normalizeRepoLiveRelay = (relay: string) => {
  try {
    const normalized = normalizeRelayUrl(relay)
    return isRelayUrl(normalized) ? normalized : ""
  } catch {
    return ""
  }
}

export const getRepoLiveOwnershipKey = (address: string, relay: string) => {
  const canonicalAddress = canonicalizeRepoLiveAddress(address)
  const normalizedRelay = normalizeRepoLiveRelay(relay)

  return canonicalAddress && normalizedRelay ? `${canonicalAddress}\n${normalizedRelay}` : ""
}

export const isRepoLiveOwned = (ownership: RepoLiveOwnership, address: string, relay: string) => {
  const key = getRepoLiveOwnershipKey(address, relay)
  return Boolean(key && ownership.has(key))
}

export class RepoLiveOwnershipRegistry {
  private readonly counts = new Map<string, number>()
  private readonly state = writable<RepoLiveOwnership>(new Set())

  readonly ownership: Readable<RepoLiveOwnership> = {subscribe: this.state.subscribe}

  register(address: string, relay: string) {
    const key = getRepoLiveOwnershipKey(address, relay)
    if (!key) return () => undefined

    this.counts.set(key, (this.counts.get(key) || 0) + 1)
    this.publish()
    let released = false

    return () => {
      if (released) return
      released = true

      const count = this.counts.get(key) || 0
      if (count <= 1) this.counts.delete(key)
      else this.counts.set(key, count - 1)
      this.publish()
    }
  }

  private publish() {
    this.state.set(new Set(this.counts.keys()))
  }
}

const repoLiveOwnershipRegistry = new RepoLiveOwnershipRegistry()

export const repoLiveOwnership = repoLiveOwnershipRegistry.ownership
export const registerRepoLiveOwnership = (address: string, relay: string) =>
  repoLiveOwnershipRegistry.register(address, relay)
