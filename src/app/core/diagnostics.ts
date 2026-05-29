import {dev} from "$app/environment"

export type ProfileLoadReason = "first-load" | "same-relays" | "improved-hints"

type ProfileLoadSummary = {
  pubkey: string
  relays: string[]
  reason: ProfileLoadReason
  force: boolean
}

type PublishRelaySummary = {
  category: string
  relays: string[]
  baseRelays?: string[]
  activeCommunityRelays?: string[]
  scopedCommunityRelays?: string[]
  repoRelays?: string[]
  indexerRelays?: string[]
}

const warnedEmptyImageSources = new Set<string>()

const unique = (values: string[] = []) => Array.from(new Set(values.filter(Boolean)))
const canLogDiagnostics = () => dev && typeof window !== "undefined"

const summarizePubkey = (pubkey: string) =>
  pubkey.length > 16 ? `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}` : pubkey

export const logProfileLoadSummary = ({pubkey, relays, reason, force}: ProfileLoadSummary) => {
  if (!canLogDiagnostics()) return

  const relaySet = unique(relays)
  console.debug("[budabit:profile] load", {
    pubkey: summarizePubkey(pubkey),
    reason,
    force,
    relayCount: relaySet.length,
    relays: relaySet,
  })
}

export const logPublishRelaySummary = ({
  category,
  relays,
  baseRelays = [],
  activeCommunityRelays = [],
  scopedCommunityRelays = [],
  repoRelays = [],
  indexerRelays = [],
}: PublishRelaySummary) => {
  if (!canLogDiagnostics()) return

  const relaySet = unique(relays)
  console.debug("[budabit:publish] relays", {
    category,
    relayCount: relaySet.length,
    relays: relaySet,
    baseRelayCount: unique(baseRelays).length,
    activeCommunityRelayCount: unique(activeCommunityRelays).length,
    scopedCommunityRelayCount: unique(scopedCommunityRelays).length,
    repoRelayCount: unique(repoRelays).length,
    indexerRelayCount: unique(indexerRelays).length,
  })
}

export const warnEmptyImageSource = (component: string, source = "src") => {
  if (!canLogDiagnostics()) return

  const key = `${component}:${source}`
  if (warnedEmptyImageSources.has(key)) return

  warnedEmptyImageSources.add(key)
  console.warn("[budabit:image] empty source", {component, source})
}

export const resetDiagnosticsForTest = () => {
  warnedEmptyImageSources.clear()
}
