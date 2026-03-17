import type {TrustedEvent} from "@welshman/util"
import {load} from "@welshman/net"

export interface ReleaseArtifact {
  event: TrustedEvent
  hash: string
  filename: string
  triggeredBy: string
  ephemeralPubkey: string
  workflow: string
  branch: string
  tags: Record<string, string>
}

export interface ArtifactGroup {
  key: string
  labels: Record<string, string>
  hashCounts: Map<string, ReleaseArtifact[]>
  totalCount: number
  consensusHash: string | null
  isUnanimous: boolean
}

export function validateHash(hash: string): boolean {
  return /^[a-f0-9]{64}$/.test(hash)
}

export function getTagValue(event: TrustedEvent, tagName: string): string | undefined {
  return event.tags.find(t => t[0] === tagName)?.[1]
}

export function buildGroupKey(event: TrustedEvent, groupByTags: string[]): string {
  return groupByTags
    .map(tag => getTagValue(event, tag) ?? "unknown")
    .join("|")
}

export async function resolveTrustedPublishers(
  repoAddr: string,
  trustedNpubs: Set<string>,
  relays: string[],
): Promise<Map<string, TrustedEvent>> {
  const runs = await load({
    relays,
    filters: [{kinds: [5401], "#a": [repoAddr]}],
  })

  const trustedRuns = new Map<string, TrustedEvent>()
  for (const run of runs) {
    const triggeredBy = getTagValue(run, "triggered-by")
    const publisher = getTagValue(run, "publisher")
    if (triggeredBy && trustedNpubs.has(triggeredBy) && publisher) {
      trustedRuns.set(publisher, run)
    }
  }
  return trustedRuns
}

export function groupArtifacts(
  artifacts: ReleaseArtifact[],
  groupByTags: string[],
): ArtifactGroup[] {
  const groups = new Map<string, ReleaseArtifact[]>()

  for (const artifact of artifacts) {
    const key = buildGroupKey(artifact.event, groupByTags)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(artifact)
  }

  return Array.from(groups.entries()).map(([key, arts]) => {
    const hashCounts = new Map<string, ReleaseArtifact[]>()
    for (const a of arts) {
      if (!hashCounts.has(a.hash)) hashCounts.set(a.hash, [])
      hashCounts.get(a.hash)!.push(a)
    }

    const sorted = [...hashCounts.entries()].sort((a, b) => b[1].length - a[1].length)
    const consensusHash = sorted[0]?.[0] ?? null
    const isUnanimous = sorted.length === 1

    return {
      key,
      labels: Object.fromEntries(
        groupByTags.map(tag => [tag, getTagValue(arts[0].event, tag) ?? "unknown"]),
      ),
      hashCounts,
      totalCount: arts.length,
      consensusHash,
      isUnanimous,
    }
  })
}

export function createSignedReleaseTemplate(sourceEvent: TrustedEvent): {
  kind: number
  created_at: number
  tags: string[][]
  content: string
} {
  const tags = sourceEvent.tags.filter(t => t[0] !== "url")
  const urlTag = sourceEvent.tags.find(t => t[0] === "url")
  if (urlTag) tags.unshift(urlTag)

  return {
    kind: sourceEvent.kind,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: sourceEvent.content,
  }
}

export async function resolveNip51List(
  listAddr: string,
  relays: string[],
): Promise<string[]> {
  const events = await load({
    relays,
    filters: [{kinds: [30000], "#d": [listAddr]}],
  })

  if (!events.length) return []

  return events[0].tags.filter(t => t[0] === "p").map(t => t[1])
}
