import {dev} from "$app/environment"

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
