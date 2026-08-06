import {GIT_REPO_ANNOUNCEMENT} from "@nostr-git/core/events"
import {isRelayUrl, normalizeRelayUrl} from "@welshman/util"

type RepoPublicationEvent = {
  kind?: number
  pubkey?: string
  tags?: string[][]
}

type RequireRepoPublicationScopeParams = {
  event: RepoPublicationEvent
  relays: string[]
  repoAddress?: string
}

const REPO_COORDINATE_TAGS = new Set(["a", "A", "q", "repo"])

const normalizeRepoCoordinate = (value: string, label: string) => {
  const [kind, pubkey, ...identifierParts] = String(value || "")
    .trim()
    .split(":")
  const identifier = identifierParts.join(":")

  if (
    kind !== String(GIT_REPO_ANNOUNCEMENT) ||
    !/^[0-9a-f]{64}$/i.test(pubkey || "") ||
    !identifier
  ) {
    throw new Error(
      `${label} must be a valid ${GIT_REPO_ANNOUNCEMENT}:<owner-pubkey>:<repository-id> coordinate.`,
    )
  }

  return `${GIT_REPO_ANNOUNCEMENT}:${pubkey.toLowerCase()}:${identifier}`
}

export const normalizeRepoPublicationRelays = (relays: string[] = []) =>
  Array.from(
    new Set(
      relays
        .map(relay => {
          try {
            return normalizeRelayUrl(relay)
          } catch {
            return ""
          }
        })
        .filter(isRelayUrl),
    ),
  )

export const getRepoPublicationCoordinates = (event: RepoPublicationEvent) => {
  const coordinates: string[] = []

  for (const tag of event.tags || []) {
    if (!REPO_COORDINATE_TAGS.has(tag[0])) continue

    const value = String(tag[1] || "").trim()
    const isRepoCoordinate = value.startsWith(`${GIT_REPO_ANNOUNCEMENT}:`)
    if (!isRepoCoordinate) {
      if (tag[0] === "repo" || value === String(GIT_REPO_ANNOUNCEMENT)) {
        throw new Error(`Repository ${tag[0]} tag contains a malformed repository coordinate.`)
      }
      continue
    }

    coordinates.push(normalizeRepoCoordinate(value, `Repository ${tag[0]} tag`))
  }

  return Array.from(new Set(coordinates))
}

const getAnnouncementCoordinate = (event: RepoPublicationEvent) => {
  if (![GIT_REPO_ANNOUNCEMENT, 30618].includes(event.kind || 0)) return ""

  const identifiers = (event.tags || [])
    .filter(tag => tag[0] === "d")
    .map(tag => String(tag[1] || ""))
  if (identifiers.length !== 1 || !identifiers[0]) {
    throw new Error("Repository replacement event must contain exactly one nonempty d tag.")
  }
  if (!event.pubkey) return ""

  return normalizeRepoCoordinate(
    `${GIT_REPO_ANNOUNCEMENT}:${event.pubkey}:${identifiers[0]}`,
    event.kind === GIT_REPO_ANNOUNCEMENT ? "Repository announcement" : "Repository state",
  )
}

export const getDeclaredRepoRelays = (event: RepoPublicationEvent) =>
  normalizeRepoPublicationRelays(
    (event.tags || []).filter(tag => tag[0] === "relays").flatMap(tag => tag.slice(1)),
  )

export const getRepoPublicationAddress = (event: RepoPublicationEvent) => {
  const coordinates = getRepoPublicationCoordinates(event)
  const replacementCoordinate = getAnnouncementCoordinate(event)
  if (replacementCoordinate) coordinates.push(replacementCoordinate)

  const uniqueCoordinates = Array.from(new Set(coordinates))
  if (uniqueCoordinates.length > 1) {
    throw new Error(
      `Repository event contains conflicting repository coordinates: ${uniqueCoordinates.join(", ")}.`,
    )
  }

  return uniqueCoordinates[0] || ""
}

export const requireRepoPublicationScope = ({
  event,
  relays,
  repoAddress,
}: RequireRepoPublicationScopeParams) => {
  const authoritativeRelays = normalizeRepoPublicationRelays(relays)
  if (authoritativeRelays.length === 0) {
    throw new Error(
      "Repository publication requires at least one valid relay declared by the repository announcement. Select a repository or GRASP relay and try again.",
    )
  }

  if (event.kind === GIT_REPO_ANNOUNCEMENT && getDeclaredRepoRelays(event).length === 0) {
    throw new Error(
      "Repository announcement must declare at least one valid repository relay in its relays tag.",
    )
  }

  const expectedCoordinate = repoAddress
    ? normalizeRepoCoordinate(repoAddress, "Repository publication authority")
    : ""
  if (expectedCoordinate && event.kind === 30618) {
    const expectedIdentifier = expectedCoordinate.split(":").slice(2).join(":")
    const stateIdentifier = (event.tags || []).find(tag => tag[0] === "d")?.[1] || ""
    if (stateIdentifier !== expectedIdentifier) {
      throw new Error(
        `Repository state targets ${stateIdentifier || "an empty identifier"}, but the authoritative repository is ${expectedCoordinate}.`,
      )
    }
  }
  const eventCoordinate = getRepoPublicationAddress(event)
  if (expectedCoordinate && eventCoordinate && eventCoordinate !== expectedCoordinate) {
    throw new Error(
      `Repository event targets ${eventCoordinate}, but the authoritative repository is ${expectedCoordinate}.`,
    )
  }

  return authoritativeRelays
}
