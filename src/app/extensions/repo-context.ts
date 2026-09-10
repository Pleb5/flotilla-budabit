import type {RepoAnnouncementEvent} from "@nostr-git/core/events"
import type {RepoContext} from "./types"
import {getRepoAddress} from "./types"

export function buildRepoExtensionContext(
  repo: {
    repoEvent?: Pick<RepoAnnouncementEvent, "pubkey" | "tags">
    identifier?: string
    name?: string
    maintainers?: readonly string[]
  },
  naddr: string,
  relays: readonly string[],
): RepoContext | undefined {
  const pubkey = repo.repoEvent?.pubkey
  const identifier = repo.repoEvent?.tags.find(tag => tag[0] === "d")?.[1] ?? repo.identifier
  if (!pubkey || !identifier || relays.length === 0) return undefined
  return {
    pubkey,
    name: identifier,
    displayName: repo.name || identifier,
    naddr,
    relays: [...relays],
    maintainers: [...new Set([pubkey, ...(repo.maintainers || [])])],
  }
}

export const getRepoExtensionInstanceId = (extensionId: string, repo: RepoContext): string =>
  `${extensionId}:${repo.pubkey}:${repo.name}`

export const buildRepoExtensionUpdate = (
  repo: RepoContext,
  userPubkey: string | null | undefined,
) => ({
  contextId: `repo:${repo.pubkey}:${repo.name}`,
  userPubkey,
  relays: [...(repo.relays || [])],
  repo: {
    repoPubkey: repo.pubkey,
    repoName: repo.name,
    repoDisplayName: repo.displayName,
    repoNaddr: repo.naddr,
    repoAddress: getRepoAddress(repo),
    userPubkey: userPubkey || null,
    repoRelays: [...(repo.relays || [])],
    maintainers: [...(repo.maintainers || [])],
  },
})
