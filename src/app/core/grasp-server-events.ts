import {
  DEFAULT_GRASP_SET_ID,
  GIT_USER_GRASP_LIST,
  GRASP_SET_KIND,
  normalizeGraspServerUrl,
  normalizeUserGraspServerUrls,
  parseGraspServersEvent,
  parseUserGraspListServerUrls,
  type UserGraspListEvent,
  validateGraspServerUrl,
} from "@nostr-git/core/events"
import type {TrustedEvent} from "@welshman/util"

export const makeUserGraspListFilter = (author: string) => ({
  kinds: [GIT_USER_GRASP_LIST],
  authors: [author],
})

export const makeLegacyGraspServersFilter = (author: string) => ({
  kinds: [GRASP_SET_KIND],
  authors: [author],
  "#d": [DEFAULT_GRASP_SET_ID],
})

export const makeGraspServerListFilters = (author: string) => [
  makeUserGraspListFilter(author),
  makeLegacyGraspServersFilter(author),
]

const getDTag = (event: Pick<TrustedEvent, "tags">) =>
  (event.tags || []).find(tag => tag[0] === "d")?.[1] || ""

const isPreferredEvent = (candidate: TrustedEvent, current: TrustedEvent | undefined) => {
  if (!current) return true
  if (candidate.created_at !== current.created_at) return candidate.created_at > current.created_at

  return candidate.id < current.id
}

const selectLatest = (events: TrustedEvent[]) => {
  let latest: TrustedEvent | undefined

  for (const event of events) {
    if (isPreferredEvent(event, latest)) latest = event
  }

  return latest
}

export const isUserGraspListEvent = (event: Pick<TrustedEvent, "kind">) =>
  event.kind === GIT_USER_GRASP_LIST

export const isLegacyGraspServersEvent = (event: Pick<TrustedEvent, "kind" | "tags">) =>
  event.kind === GRASP_SET_KIND && getDTag(event) === DEFAULT_GRASP_SET_ID

export const parseUserGraspServerUrls = (event: TrustedEvent): string[] =>
  parseUserGraspListServerUrls(event as UserGraspListEvent)

const normalizeLegacyGraspServerUrls = (urls: string[] = []) => {
  const result: string[] = []
  const seen = new Set<string>()

  for (const url of urls) {
    const normalized = normalizeGraspServerUrl(url)
    if (!normalized || !validateGraspServerUrl(normalized) || seen.has(normalized)) continue

    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

export const parseLegacyGraspServerUrls = (event: TrustedEvent): string[] => {
  const parseTags = () =>
    normalizeLegacyGraspServerUrls(
      (event.tags || [])
        .filter(tag => (tag[0] === "relay" || tag[0] === "r") && tag[1])
        .map(tag => tag[1]),
    )

  try {
    if (!event.content) return parseTags()

    const parsed = JSON.parse(event.content)
    if (!Array.isArray(parsed?.urls)) return []

    return normalizeLegacyGraspServerUrls(parseGraspServersEvent(event as any))
  } catch {
    return parseTags()
  }
}

export type GraspServerListResolution = {
  source: "user" | "legacy" | "none"
  urls: string[]
}

export const resolvePreferredGraspServerList = (events: TrustedEvent[]): GraspServerListResolution => {
  const latestUserList = selectLatest(events.filter(isUserGraspListEvent))
  if (latestUserList) return {source: "user", urls: parseUserGraspServerUrls(latestUserList)}

  const latestLegacyList = selectLatest(events.filter(isLegacyGraspServersEvent))
  if (latestLegacyList) return {source: "legacy", urls: parseLegacyGraspServerUrls(latestLegacyList)}

  return {source: "none", urls: []}
}

export const getPreferredGraspServerUrls = (events: TrustedEvent[]): string[] =>
  resolvePreferredGraspServerList(events).urls
