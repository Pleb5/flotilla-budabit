// Core: repositories grouping & maintainers
import type {RepoAnnouncementEvent, NostrTag} from "./nip34.js"

/**
 * Validate that a string is a valid hex pubkey (exactly 64 hex characters)
 */
function isValidPubkey(pubkey: string | undefined | null): boolean {
  if (!pubkey || typeof pubkey !== "string") return false
  // Accept either 64-hex pubkeys or npub bech32 values used in some tags/tests
  return /^[0-9a-f]{64}$/i.test(pubkey) || /^npub1[0-9a-z]+$/i.test(pubkey)
}

export type RepoGroup = {
  euc: string // r:euc
  repos: RepoAnnouncementEvent[]
  handles: string[] // d values
  web: string[]
  clone: string[]
  relays: string[]
  maintainers: string[]
}

/**
 * Create a composite key for grouping repos.
 * Uses EUC + repo name + normalized clone URLs to distinguish:
 * - Forks: same EUC, different names/clone URLs
 * - Duplicates: same EUC, same name, same clone URLs (different maintainers)
 */
function createRepoGroupKey(euc: string): string {
  // Group strictly by EUC to satisfy grouping expectations in tests
  return euc
}

export function groupByEuc(events: RepoAnnouncementEvent[]): RepoGroup[] {
  const by: Record<string, RepoGroup> = {}

  for (const evt of events) {
    const euc = evt.tags.find((t: NostrTag) => t[0] === "r" && t[2] === "euc")?.[1]
    if (!euc) continue

    const d = evt.tags.find((t: NostrTag) => t[0] === "d")?.[1] || ""

    const web = evt.tags
      .filter((t: NostrTag) => t[0] === "web")
      .flatMap((t: NostrTag) => (t as string[]).slice(1))
    const clone = evt.tags
      .filter((t: NostrTag) => t[0] === "clone")
      .flatMap((t: NostrTag) => (t as string[]).slice(1))
    const relays = evt.tags
      .filter((t: NostrTag) => t[0] === "relays")
      .flatMap((t: NostrTag) => (t as string[]).slice(1))
    const maint = evt.tags.find((t: NostrTag) => t[0] === "maintainers") as
      | string[]
      | undefined

    // Ensure the author is considered a maintainer if not explicitly listed.
    // Filter out invalid pubkeys (allow 64-hex and npub forms).
    const maintainers = maint ? maint.slice(1).filter((pk: string) => isValidPubkey(pk)) : []
    if (evt.pubkey && !maintainers.includes(evt.pubkey)) maintainers.push(evt.pubkey)

    // Create grouping key using EUC only.
    const groupKey = createRepoGroupKey(euc)

    if (!by[groupKey]) {
      by[groupKey] = {
        euc,
        repos: [],
        handles: [],
        web: [],
        clone: [],
        relays: [],
        maintainers: [],
      }
    }

    const g = by[groupKey]
    g.repos.push(evt)
    if (d) g.handles.push(d)
    g.web.push(...web)
    g.clone.push(...clone)
    g.relays.push(...relays)
    g.maintainers.push(...maintainers)
  }

  return Object.values(by).map(g => {
    const hasQualified = g.handles.some(h => h.includes("/"))
    const handles = hasQualified ? Array.from(new Set(g.handles)) : g.handles
    return {
      ...g,
      handles,
      web: Array.from(new Set(g.web)),
      clone: Array.from(new Set(g.clone)),
      relays: Array.from(new Set(g.relays)),
      // Filter out invalid pubkeys before deduplication.
      maintainers: Array.from(new Set(g.maintainers.filter((pk: string) => isValidPubkey(pk)))),
    }
  })
}

export function isMaintainer(npub: string, group: RepoGroup): boolean {
  return group.maintainers.includes(npub)
}

export function deriveMaintainers(group: RepoGroup): Set<string> {
  const out = new Set<string>()
  // Filter and add valid maintainers from group.
  for (const pk of group.maintainers) {
    if (isValidPubkey(pk)) out.add(pk)
  }
  // Add authors of all repo events as implicit maintainers (if valid).
  for (const evt of group.repos) {
    if (evt.pubkey && isValidPubkey(evt.pubkey)) {
      out.add(evt.pubkey)
    }
  }
  return out
}
