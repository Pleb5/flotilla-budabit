import type {RepoAnnouncementEvent, RepoAnnouncementTag, RepoStateEvent} from "./nip34.js"
import {createRepoAnnouncementEvent, type RepoCommunityBinding} from "./nip34-utils.js"

export type RepoUpstreamTag = ["u", string, ...string[]]

/** An independent fork points at its immediate source, not at the source's upstream. */
export function getForkUpstreamTags(
  source: RepoAnnouncementEvent | undefined,
  gitUrl: string,
): RepoUpstreamTag[] {
  if (source) {
    const identifier = source.tags.find(tag => tag[0] === "d")?.[1]
    if (source.kind !== 30617 || !source.pubkey || !identifier)
      throw new Error("Invalid fork source announcement")
    const address = `30617:${source.pubkey}:${identifier}`
    const relay = source.tags.find(tag => tag[0] === "relays")?.[1]
    return [relay ? ["u", address, relay] : ["u", address]]
  }
  return [["u", gitUrl]]
}

export function getRepoUpstreamTags(event: Pick<RepoAnnouncementEvent, "tags">): RepoUpstreamTag[] {
  return event.tags
    .filter(tag => tag[0] === "u" && tag.length > 1)
    .map(tag => [...tag] as RepoUpstreamTag)
}

/** Upstreams describe provenance, never repository identity or permissions. */
export function validateRepoUpstream(target: string, ownAddress?: string): string | undefined {
  if (!target || target !== target.trim())
    return "Upstream must not be empty or contain surrounding spaces"
  const coordinate = target.match(/^30617:([0-9a-f]{64}):(.+)$/i)
  const ownCoordinate = ownAddress?.match(/^30617:([0-9a-f]{64}):(.+)$/i)
  if (
    target === ownAddress ||
    (coordinate &&
      ownCoordinate &&
      coordinate[1].toLowerCase() === ownCoordinate[1].toLowerCase() &&
      coordinate[2] === ownCoordinate[2])
  )
    return "A repository cannot be its own upstream"
  if (/^30617:[0-9a-f]{64}:.+$/i.test(target)) return undefined
  if (/^git@[^\s/:]+:[^\s]+$/.test(target)) return undefined
  try {
    const url = new URL(target)
    if (
      ["https:", "http:", "git:", "ssh:"].includes(url.protocol) &&
      url.hostname &&
      !url.password &&
      (!url.username || url.protocol === "ssh:")
    )
      return undefined
  } catch {
    /* Show the same validation error for malformed URLs. */
  }
  return "Use a 30617:<owner>:<identifier> coordinate or a Git URL for the upstream"
}

export interface RepoAnnouncementChanges {
  name?: string
  description?: string
  clone?: string[]
  web?: string[]
  relays?: string[]
  maintainers?: string[]
  hashtags?: string[]
  earliestUniqueCommit?: string
  community?: RepoCommunityBinding
  upstreams?: RepoUpstreamTag[]
}

/** Change only explicitly supplied fields of this owner's announcement. Never change d. */
export function editRepoAnnouncementEvent(
  source: RepoAnnouncementEvent,
  changes: RepoAnnouncementChanges,
  createdAt = Math.max(Math.floor(Date.now() / 1000), source.created_at + 1),
): RepoAnnouncementEvent {
  const identifiers = source.tags.filter(tag => tag[0] === "d")
  if (source.kind !== 30617 || identifiers.length !== 1 || !identifiers[0][1]) {
    throw new Error("Repository announcement must have exactly one non-empty identifier")
  }
  let tags = source.tags.map(tag => [...tag])
  const replace = (matches: (tag: string[]) => boolean, replacement: string[][]) => {
    tags = [...tags.filter(tag => !matches(tag)), ...replacement]
  }
  const names = {
    name: "name",
    description: "description",
    clone: "clone",
    web: "web",
    relays: "relays",
    maintainers: "maintainers",
    hashtags: "t",
  } as const
  for (const field of Object.keys(names) as Array<keyof typeof names>) {
    if (!Object.prototype.hasOwnProperty.call(changes, field)) continue
    const name = names[field]
    const value = changes[field]
    const replacement = Array.isArray(value)
      ? field === "hashtags"
        ? value.map(item => [name, item])
        : value.length
          ? [[name, ...value]]
          : []
      : value
        ? [[name, value]]
        : []
    replace(tag => tag[0] === name, replacement)
  }
  if (Object.prototype.hasOwnProperty.call(changes, "earliestUniqueCommit")) {
    replace(
      tag => tag[0] === "r" && tag[2] === "euc",
      changes.earliestUniqueCommit ? [["r", changes.earliestUniqueCommit, "euc"]] : [],
    )
  }
  if (Object.prototype.hasOwnProperty.call(changes, "community")) {
    const communityTags = createRepoAnnouncementEvent({
      repoId: identifiers[0][1],
      community: changes.community,
    }).tags.filter(tag => tag[0] !== "d")
    replace(
      tag => tag[0] === "h" || (tag[0] === "a" && tag[1]?.startsWith("32222:")),
      communityTags,
    )
  }
  if (Object.prototype.hasOwnProperty.call(changes, "upstreams")) {
    replace(
      tag => tag[0] === "u",
      (changes.upstreams || []).map(tag => [...tag]),
    )
  }
  return {
    kind: 30617,
    pubkey: source.pubkey,
    content: source.content,
    tags: tags as RepoAnnouncementTag[],
    created_at: createdAt,
  } as RepoAnnouncementEvent
}

/** A default-branch edit preserves the complete signed ref map and ancestry tags. */
export function editRepoStateHead(
  source: RepoStateEvent | undefined,
  identifier: string,
  head: string,
  owner: string,
  createdAt: number,
): RepoStateEvent {
  if (
    !source ||
    source.kind !== 30618 ||
    source.tags.find(tag => tag[0] === "d")?.[1] !== identifier
  ) {
    throw new Error(
      "The current repository state is unavailable; reload before changing the default branch",
    )
  }
  if (!source.tags.some(tag => tag[0] === `refs/heads/${head}`)) {
    throw new Error("The default branch must exist in the current signed repository state")
  }
  return {
    kind: 30618,
    pubkey: owner,
    content: source.content,
    tags: [
      ...source.tags.filter(tag => tag[0] !== "HEAD").map(tag => [...tag]),
      ["HEAD", `ref: refs/heads/${head}`],
    ],
    created_at: createdAt,
  } as RepoStateEvent
}
