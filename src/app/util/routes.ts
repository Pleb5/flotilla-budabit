import type {Page} from "@sveltejs/kit"
import * as nip19 from "nostr-tools/nip19"
import {goto} from "$app/navigation"
import {load, request} from "@welshman/net"
import type {Filter, TrustedEvent} from "@welshman/util"
import {pubkey, repository} from "@welshman/app"
import {waitAndScrollToEvent} from "@lib/html"
import {identity} from "@welshman/lib"
import {
  GIT_COMMENT,
  GIT_COVER_LETTER,
  GIT_ISSUE,
  GIT_LABEL,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_REPO_ANNOUNCEMENT,
  GIT_REPO_STATE,
  GIT_STATUS_APPLIED,
  GIT_STATUS_CLOSED,
  GIT_STATUS_DRAFT,
  GIT_STATUS_OPEN,
} from "@nostr-git/core/events"
import {githubPermalinkDiffId} from "@nostr-git/core/git"
import {
  COMMENT,
  EVENT_DATE,
  EVENT_TIME,
  MESSAGE,
  THREAD,
  ZAP_GOAL,
  getPubkeyTagValues,
  getTagValue,
} from "@welshman/util"
import {makeChatId, DM_KIND} from "@app/core/state"
import {entityLink} from "@app/util/nostr-links"
import {
  TARGETED_PUBLICATION_KIND,
  type CommunityPointer,
  makeCommunityPointer,
  parseCommunityNaddr,
  parseTargetedPublication,
} from "@app/core/community"
import {GIT_PERMALINK_KIND, SMART_WIDGET_KIND} from "@app/core/community-feeds"
import {COMMIT_COMMENT_KIND} from "@app/core/commit-comments"
import {getInboundRepoPublicationAddresses} from "@app/core/repo-publication"
import {getEventRelayHints, makeEventNevent, normalizeRelayHints} from "@app/util/event-links"

export const COMMUNITY_EXPLAINER_PATH = "/community-guide"

export const parseExactCommunityRouteParam = (community: string | undefined) => {
  if (!community) return undefined
  try {
    return parseCommunityNaddr(decodeURIComponent(community))
  } catch {
    return undefined
  }
}

export const encodeExactCommunityRouteParam = (community: CommunityPointer) =>
  encodeURIComponent(community.naddr)

export const makeExactCommunityPath = (
  community: CommunityPointer,
  ...extra: (string | undefined)[]
) => {
  let path = `/c/${encodeExactCommunityRouteParam(community)}`
  const suffix = extra.filter(identity).map(item => encodeURIComponent(item as string))
  if (suffix.length > 0) path += `/${suffix.join("/")}`
  return path
}

export const makeExactCommunityRoomPath = (community: CommunityPointer, roomId: string) =>
  makeExactCommunityPath(community, "rooms", roomId)

export const makeExactCommunityThreadPath = (community: CommunityPointer, eventId?: string) =>
  makeExactCommunityPath(community, "threads", eventId)

export const makeExactCommunityCalendarPath = (community: CommunityPointer, eventId?: string) =>
  makeExactCommunityPath(community, "calendar", eventId)

export const makeExactCommunityGoalPath = (community: CommunityPointer, eventId?: string) =>
  makeExactCommunityPath(community, "goals", eventId)

export const makeExactCommunityGitPath = (community: CommunityPointer, eventId?: string) =>
  makeExactCommunityPath(community, "git", eventId)

export const makeExactCommunityPermalinkPath = (community: CommunityPointer, eventId?: string) =>
  makeExactCommunityPath(community, "permalinks", eventId)

export const makeExactCommunityWidgetPath = (community: CommunityPointer, eventId?: string) =>
  makeExactCommunityPath(community, "widgets", eventId)

export const makeExactGitCommunityPath = (community: CommunityPointer) => {
  const params = new URLSearchParams({[GIT_COMMUNITY_PARAM]: community.naddr})
  return `${makeGitPath()}?${params}`
}

export const makeExactGitCommunityEntryPath = (community: CommunityPointer) => {
  const params = new URLSearchParams({
    [GIT_ENTRY_PARAM]: GIT_COMMUNITY_ENTRY,
    [GIT_COMMUNITY_PARAM]: community.naddr,
  })
  return `${makeGitPath()}?${params}`
}

export const makePersonalGitEntryPath = () => {
  const params = new URLSearchParams({[GIT_ENTRY_PARAM]: GIT_PERSONAL_ENTRY})
  return `${makeGitPath()}?${params}`
}

const getCoherentCommunityPointer = (value: CommunityPointer | undefined) => {
  if (!value) return undefined
  const pointer = makeCommunityPointer({
    ownerPubkey: value.ownerPubkey,
    communityId: value.communityId,
    relayHints: value.relayHints,
  })
  return pointer?.address === value.address ? pointer : undefined
}

export const getExactCommunityRouteContext = (url: URL) => {
  const segments = url.pathname.split("/").filter(Boolean)
  if (segments[0] !== "c" || !segments[1]) return undefined
  const pointer = parseExactCommunityRouteParam(segments[1])
  if (!pointer) return undefined
  const section = segments
    .slice(2)
    .map(segment => decodeURIComponent(segment))
    .join(":")
  return `community:${pointer.address}:${section}:${url.search}`
}

export const makeCanonicalExactCommunityUrl = (url: URL, pointer: CommunityPointer) => {
  const segments = url.pathname.split("/").filter(Boolean)
  const suffix = segments.slice(2).join("/")
  const pathname = `${makeExactCommunityPath(pointer)}${suffix ? `/${suffix}` : ""}`
  return `${pathname}${url.search}${url.hash}`
}

export const getExactCommunityEventPath = (
  event: TrustedEvent,
  selectedCommunity?: CommunityPointer,
) => {
  const targeted =
    event.kind === TARGETED_PUBLICATION_KIND ? parseTargetedPublication(event) : undefined
  const targetedPointer = targeted
    ? selectedCommunity
      ? targeted.communities.find(item => item.address === selectedCommunity.address)
      : targeted.communities.length === 1
        ? targeted.communities[0]
        : undefined
    : undefined
  const pointer = getCoherentCommunityPointer(
    targetedPointer ||
      (getTagValue("h", event.tags) === selectedCommunity?.communityId
        ? selectedCommunity
        : undefined),
  )
  if (!pointer) return undefined

  if (event.kind === THREAD) {
    return isRoomRootEvent(event)
      ? makeExactCommunityRoomPath(pointer, event.id)
      : makeExactCommunityThreadPath(pointer, event.id)
  }
  if (event.kind === MESSAGE) {
    const roomId = getEventRootId(event)
    return roomId ? makeExactCommunityRoomPath(pointer, roomId) : undefined
  }
  if (event.kind === COMMENT) {
    const rootKind = Number.parseInt(getTagValue("K", event.tags) || "", 10)
    const rootId = getEventRootId(event)
    if (!rootId) return undefined
    if (rootKind === THREAD) return makeExactCommunityThreadPath(pointer, rootId)
    if (rootKind === MESSAGE) return makeExactCommunityRoomPath(pointer, rootId)
    if (rootKind === EVENT_DATE || rootKind === EVENT_TIME) {
      return makeExactCommunityCalendarPath(pointer, rootId)
    }
    if (rootKind === ZAP_GOAL) return makeExactCommunityGoalPath(pointer, rootId)
  }
  if (event.kind === EVENT_DATE || event.kind === EVENT_TIME) {
    return makeExactCommunityCalendarPath(
      pointer,
      event.id || getTagValue("d", event.tags) || undefined,
    )
  }
  if (event.kind === ZAP_GOAL) return makeExactCommunityGoalPath(pointer, event.id)
  if (event.kind === SMART_WIDGET_KIND) return makeExactCommunityWidgetPath(pointer)
  if (targeted) {
    if (targeted.kind === EVENT_DATE || targeted.kind === EVENT_TIME) {
      return makeExactCommunityCalendarPath(pointer)
    }
    if (targeted.kind === ZAP_GOAL) return makeExactCommunityGoalPath(pointer)
    if (targeted.kind === SMART_WIDGET_KIND) return makeExactCommunityWidgetPath(pointer)
  }
  return undefined
}

export const GIT_COMMUNITY_PARAM = "community"
export const GIT_ENTRY_PARAM = "entry"
export const GIT_COMMUNITY_ENTRY = "community"
export const GIT_PERSONAL_ENTRY = "personal"

export const makeGitPath = (_url?: string, eventId?: string) =>
  `/git${eventId ? `/${encodeURIComponent(eventId)}` : ""}`

export const makeGitCommunityPath = (community: string) => {
  const value = community.trim()
  if (!value) return makeGitPath()

  const params = new URLSearchParams({[GIT_COMMUNITY_PARAM]: value})
  return `${makeGitPath()}?${params}`
}

export const makeGitIssuePath = (url?: string, eventId?: string) =>
  `${makeGitPath(url, eventId)}/issues`

const normalizeRoutePath = (pathname: string) => {
  const path = pathname.split(/[?#]/)[0]?.replace(/\/+$/, "") || "/"

  return path.startsWith("/") ? path : `/${path}`
}

const normalizeBreadcrumbPath = (value: string | null | undefined) =>
  (value ?? "").replace(/^\/+/, "").replace(/\/+$/, "")

const getParentDirectory = (value: string) => value.split("/").slice(0, -1).join("/")

const appendSearchParams = (pathname: string, params: URLSearchParams) => {
  const search = params.toString()

  return search ? `${pathname}?${search}` : pathname
}

const gitSectionLabels: Record<string, string> = {
  code: "Code",
  commits: "Commits",
  feed: "Activity",
  issues: "Issues",
  prs: "PRs",
  settings: "Settings",
}

const getCodeTargetLabel = (dir: string) => dir || "Code"

export type GitParentTarget = {
  path: string
  label: string
}

export const getGitParentTarget = (
  pathname: string,
  searchParams: URLSearchParams | string = "",
): GitParentTarget => {
  const normalizedPath = normalizeRoutePath(pathname)
  const segments = normalizedPath.split("/").filter(Boolean)

  if (segments[0] !== "git") return {path: "/git", label: "Repos"}
  if (segments.length <= 1) return {path: "/", label: "Home"}
  if (segments.length === 2) return {path: "/git", label: "Repos"}

  const repoPath = `/${segments.slice(0, 2).join("/")}`
  const section = segments[2]

  if (section === "code") {
    const params = new URLSearchParams(searchParams)
    const filePath = normalizeBreadcrumbPath(params.get("path"))
    const dirPath = normalizeBreadcrumbPath(params.get("dir"))
    const currentDir = filePath ? getParentDirectory(filePath) : dirPath

    if (filePath || dirPath) {
      const parentDir = getParentDirectory(currentDir)
      let targetDir = ""

      if (filePath && currentDir) {
        targetDir = currentDir
        params.set("dir", targetDir)
      } else if (dirPath && parentDir) {
        targetDir = parentDir
        params.set("dir", targetDir)
      } else {
        params.delete("dir")
      }

      params.delete("path")

      return {
        path: appendSearchParams(`${repoPath}/code`, params),
        label: getCodeTargetLabel(targetDir),
      }
    }
  }

  if (section === "extensions") return {path: repoPath, label: "Overview"}
  if (segments.length > 3) {
    return {
      path: `/${segments.slice(0, -1).join("/")}`,
      label: gitSectionLabels[section] || "Overview",
    }
  }

  return {path: repoPath, label: "Overview"}
}

export const getGitParentPath = (pathname: string, searchParams: URLSearchParams | string = "") =>
  getGitParentTarget(pathname, searchParams).path

export type CommunityReportTargetPathInput = {
  targetEventId?: string
  targetEventKind?: number
  targetEventSubtype?: string
  targetRootId?: string
  targetRootKind?: number
  targetIdentifier?: string
}

const isRoomRootEvent = (event: TrustedEvent) => event.tags.some(tag => tag[0] === "room")

const getEventRootId = (event: TrustedEvent) =>
  getTagValue("E", event.tags) || getTagValue("e", event.tags)

const getExactCommunityPathForKind = ({
  community,
  kind,
  id,
  subtype = "",
}: {
  community: CommunityPointer
  kind?: number
  id?: string
  subtype?: string
}) => {
  if (!kind || !id) return undefined
  if (kind === THREAD) {
    return subtype === "room"
      ? makeExactCommunityRoomPath(community, id)
      : makeExactCommunityThreadPath(community, id)
  }
  if (kind === MESSAGE) return makeExactCommunityRoomPath(community, id)
  if (kind === EVENT_DATE || kind === EVENT_TIME) {
    return makeExactCommunityCalendarPath(community, id)
  }
  if (kind === ZAP_GOAL) return makeExactCommunityGoalPath(community, id)
  if (kind === SMART_WIDGET_KIND) return makeExactCommunityWidgetPath(community, id)
}

export const getExactCommunityReportTargetPath = (
  community: CommunityPointer,
  target: CommunityReportTargetPathInput,
) => {
  const targetId =
    target.targetEventKind === EVENT_DATE || target.targetEventKind === EVENT_TIME
      ? target.targetEventId || target.targetIdentifier || ""
      : target.targetIdentifier || target.targetEventId || ""
  const rootId = target.targetRootId || ""

  if (target.targetEventKind === COMMENT) {
    return getExactCommunityPathForKind({
      community,
      kind: target.targetRootKind,
      id: rootId,
    })
  }
  if (target.targetEventKind === MESSAGE) {
    return getExactCommunityPathForKind({
      community,
      kind: MESSAGE,
      id: rootId || target.targetEventId,
    })
  }
  return getExactCommunityPathForKind({
    community,
    kind: target.targetEventKind,
    id: targetId,
    subtype: target.targetEventSubtype,
  })
}

const TARGETED_PUBLICATION_ROUTE_KINDS = [EVENT_DATE, EVENT_TIME, ZAP_GOAL, SMART_WIDGET_KIND]

const hasTargetedPublicationPath = (kind: number) => TARGETED_PUBLICATION_ROUTE_KINDS.includes(kind)

const makeTargetedPublicationPath = (community: CommunityPointer, kind: number) => {
  switch (kind) {
    case EVENT_DATE:
    case EVENT_TIME:
      return makeExactCommunityCalendarPath(community)
    case ZAP_GOAL:
      return makeExactCommunityGoalPath(community)
    case SMART_WIDGET_KIND:
      return makeExactCommunityWidgetPath(community)
    default:
      return undefined
  }
}

const getFirstTargetedPublicationCommunity = (events: TrustedEvent[]) => {
  for (const event of events) {
    const targeting = parseTargetedPublication(event)
    const community = targeting?.communities.length === 1 ? targeting.communities[0] : undefined

    if (community) return community
  }

  return undefined
}

const getTargetedPublicationFiltersForOriginal = (event: TrustedEvent): Filter[] => {
  if (!hasTargetedPublicationPath(event.kind)) return []

  const filters: Filter[] = []
  const targetingId = getTagValue("h", event.tags)
  const identifier = getTagValue("d", event.tags)

  if (targetingId) {
    filters.push({
      kinds: [TARGETED_PUBLICATION_KIND],
      "#d": [targetingId],
      "#k": [String(event.kind)],
    })
  }

  if (identifier) {
    filters.push({
      kinds: [TARGETED_PUBLICATION_KIND],
      "#a": [`${event.kind}:${event.pubkey}:${identifier}`],
      "#k": [String(event.kind)],
    })
  }

  filters.push({
    kinds: [TARGETED_PUBLICATION_KIND],
    "#e": [event.id],
    "#k": [String(event.kind)],
  })

  return filters
}

const getTargetedPublicationCommunityForOriginal = (event: TrustedEvent) => {
  const filters = getTargetedPublicationFiltersForOriginal(event)

  return filters.length
    ? getFirstTargetedPublicationCommunity(
        repository.query(filters, {shouldSort: false}) as TrustedEvent[],
      )
    : undefined
}

const getTargetedPublicationEventPath = (event: TrustedEvent) => {
  if (event.kind === TARGETED_PUBLICATION_KIND) {
    const targeting = parseTargetedPublication(event)
    const community = targeting?.communities.length === 1 ? targeting.communities[0] : undefined

    return community && targeting
      ? makeTargetedPublicationPath(community, targeting.kind)
      : undefined
  }

  if (!hasTargetedPublicationPath(event.kind)) return undefined

  const community = getTargetedPublicationCommunityForOriginal(event)

  return community ? makeTargetedPublicationPath(community, event.kind) : undefined
}

const getTargetedPublicationDetailPath = (event: TrustedEvent) => {
  const path = getTargetedPublicationEventPath(event)
  if (!path) return undefined

  if (event.kind === EVENT_DATE || event.kind === EVENT_TIME) {
    const routeParam = event.id || getTagValue("d", event.tags)

    return routeParam ? `${path}/${encodeURIComponent(routeParam)}` : path
  }

  if (event.kind === ZAP_GOAL) return `${path}/${encodeURIComponent(event.id)}`

  return path
}

const loadTargetedPublicationEventPath = async (event: TrustedEvent, urls: string[]) => {
  const filters = getTargetedPublicationFiltersForOriginal(event)

  if (filters.length === 0 || urls.length === 0) return undefined

  await request({relays: urls, filters, autoClose: true}).catch(() => undefined)

  return getTargetedPublicationDetailPath(event)
}

export const getCommunityEventPath = (event: TrustedEvent) => {
  const selectedCommunity =
    typeof window === "undefined"
      ? undefined
      : parseExactCommunityRouteParam(window.location.pathname.split("/").filter(Boolean)[1])
  const exactCommunityPath = getExactCommunityEventPath(event, selectedCommunity)
  const targetedPublicationPath = getTargetedPublicationDetailPath(event)
  return exactCommunityPath || targetedPublicationPath || undefined
}

const GIT_STATUS_KINDS = new Set([
  GIT_STATUS_OPEN,
  GIT_STATUS_APPLIED,
  GIT_STATUS_CLOSED,
  GIT_STATUS_DRAFT,
])

const getFirstTagValue = (event: TrustedEvent, names: string[]) => {
  for (const name of names) {
    const value = getTagValue(name, event.tags)
    if (value) return value
  }

  return ""
}

const getGitRootId = (event: TrustedEvent) => {
  if (GIT_STATUS_KINDS.has(event.kind)) {
    return (
      event.tags.find(tag => tag[0] === "e" && tag[3] === "root")?.[1] ||
      getFirstTagValue(event, ["E", "e"])
    )
  }

  return getFirstTagValue(event, ["E", "e"])
}

const loadReferencedEvent = async (id: string, relays: string[]) => {
  if (!id) return undefined

  const cached = repository.getEvent(id) as TrustedEvent | undefined
  if (cached || relays.length === 0) return cached

  const events = await load({relays, filters: [{ids: [id], limit: 1}]}).catch(
    () => [] as TrustedEvent[],
  )

  return (
    (repository.getEvent(id) as TrustedEvent | undefined) || events.find(event => event.id === id)
  )
}

const getSharedRepoAddress = (...events: Array<TrustedEvent | undefined>) => {
  try {
    const coordinateSets = events
      .filter(Boolean)
      .map(event => getInboundRepoPublicationAddresses(event!))
      .filter(addresses => addresses.length > 0)
    if (coordinateSets.length === 0) return ""

    return (
      coordinateSets[0].find(address =>
        coordinateSets.slice(1).every(addresses => addresses.includes(address)),
      ) || ""
    )
  } catch {
    return ""
  }
}

const makeRepoEventBasePath = (repoAddress: string, relays: string[]) => {
  const [kindValue, owner, ...identifierParts] = repoAddress.split(":")
  const identifier = identifierParts.join(":")
  if (
    kindValue !== String(GIT_REPO_ANNOUNCEMENT) ||
    !/^[0-9a-f]{64}$/i.test(owner) ||
    !identifier
  ) {
    return ""
  }

  const relayHints = normalizeRelayHints(relays)
  const naddr = nip19.naddrEncode({
    kind: GIT_REPO_ANNOUNCEMENT,
    pubkey: owner,
    identifier,
    relays: relayHints.length > 0 ? relayHints : undefined,
  })

  return makeGitPath(undefined, naddr)
}

const getGitLineRange = (event: TrustedEvent) => {
  const tag = event.tags.find(candidate => candidate[0] === "lines" || candidate[0] === "line")
  const [startValue = "", dashEndValue = ""] = (tag?.[1] || "").split("-")
  const start = Number.parseInt(startValue, 10)
  const separateEndValue = tag?.[2] === "del" ? "" : tag?.[2] || ""
  const end = Number.parseInt(dashEndValue || separateEndValue, 10)

  return {
    start: Number.isFinite(start) ? start : undefined,
    end: Number.isFinite(end) ? end : Number.isFinite(start) ? start : undefined,
  }
}

const getGitPermalinkPath = async (event: TrustedEvent, basePath: string) => {
  const commit = getTagValue("commit", event.tags)
  const parentCommit = getTagValue("parent-commit", event.tags)
  const filePath = getFirstTagValue(event, ["file", "path", "f"])
  const pullRequestId = getTagValue("e", event.tags)
  const {start, end} = getGitLineRange(event)

  if (parentCommit) {
    const diffHash = filePath ? await githubPermalinkDiffId(filePath).catch(() => "") : ""
    if (filePath && !diffHash) return undefined

    const lineRange = start ? `R${start}${end && end !== start ? `-R${end}` : ""}` : ""
    const anchor = diffHash ? `#diff-${diffHash}${lineRange}` : ""
    if (commit) return `${basePath}/commits/${commit}${anchor}`
    if (pullRequestId) return `${basePath}/prs/${pullRequestId}${anchor}`
    return `${basePath}${anchor}`
  }

  if (filePath) {
    const anchor = start ? `#L${start}${end && end !== start ? `-L${end}` : ""}` : ""

    return `${basePath}/code?path=${encodeURIComponent(filePath)}${anchor}`
  }
  if (commit) return `${basePath}/commits/${commit}`
  if (pullRequestId) return `${basePath}/prs/${pullRequestId}`

  return basePath
}

export const getGitEventPath = async (event: TrustedEvent, relays: string[]) => {
  const rootId = getGitRootId(event)
  const eventRepoAddress = getSharedRepoAddress(event)
  const commentRootKind = Number.parseInt(getFirstTagValue(event, ["K", "k"]), 10)
  const needsCommentRoot =
    event.kind === GIT_COMMENT &&
    !!rootId &&
    (!commentRootKind ||
      ([GIT_ISSUE, GIT_PULL_REQUEST].includes(commentRootKind) && !eventRepoAddress))
  const needsRoot =
    event.kind === GIT_COVER_LETTER ||
    event.kind === GIT_LABEL ||
    GIT_STATUS_KINDS.has(event.kind) ||
    needsCommentRoot
  const root = needsRoot ? await loadReferencedEvent(rootId, relays) : undefined
  const repoAddress = getSharedRepoAddress(event, root)
  const basePath = makeRepoEventBasePath(repoAddress, relays)
  if (!basePath) return undefined

  if (event.kind === GIT_REPO_ANNOUNCEMENT || event.kind === GIT_REPO_STATE) return basePath
  if (event.kind === GIT_ISSUE) return `${basePath}/issues/${event.id}`
  if (event.kind === GIT_PULL_REQUEST) return `${basePath}/prs/${event.id}`
  if (event.kind === GIT_PULL_REQUEST_UPDATE) {
    return rootId ? `${basePath}/prs/${rootId}` : undefined
  }

  if (
    event.kind === GIT_COVER_LETTER ||
    event.kind === GIT_LABEL ||
    GIT_STATUS_KINDS.has(event.kind)
  ) {
    if (!rootId || !root) return undefined
    if (root.kind === GIT_ISSUE) return `${basePath}/issues/${rootId}`
    if (root.kind === GIT_PULL_REQUEST) return `${basePath}/prs/${rootId}`
    return undefined
  }

  if (event.kind === GIT_COMMENT) {
    const rootKindValue = getFirstTagValue(event, ["K", "k"])
    if (rootKindValue === COMMIT_COMMENT_KIND) {
      const externalRoot = getFirstTagValue(event, ["I", "i"])
      const commitPrefix = "git:commit:"
      const commit = externalRoot.toLowerCase().startsWith(commitPrefix)
        ? externalRoot.slice(commitPrefix.length)
        : ""

      return commit ? `${basePath}/commits/${commit}#comment-${event.id}` : undefined
    }

    const rootKind = root?.kind || Number.parseInt(rootKindValue, 10)
    if (!rootId) return undefined
    if (rootKind === GIT_ISSUE) return `${basePath}/issues/${rootId}#comment-${event.id}`
    if (rootKind === GIT_PULL_REQUEST) return `${basePath}/prs/${rootId}#comment-${event.id}`
    return undefined
  }

  if (event.kind === GIT_PERMALINK_KIND) return getGitPermalinkPath(event, basePath)

  return undefined
}

export const makeChatPath = (recipient: string) => {
  const id = makeChatId(recipient)

  return `/chat/${id}`
}

export const makeProfilePath = (profile: string, relays: string[] = []) => {
  const relayHints = Array.from(
    new Set(relays.map(relay => String(relay || "").trim()).filter(Boolean)),
  )
  const value = /^[0-9a-f]{64}$/i.test(profile)
    ? relayHints.length > 0
      ? nip19.nprofileEncode({pubkey: profile, relays: relayHints})
      : nip19.npubEncode(profile)
    : profile

  return `/people/${encodeURIComponent(value)}`
}

export const getPrimaryNavItem = ($page: Page) => $page.route?.id?.split("/")[1]

export const getPrimaryNavItemIndex = ($page: Page) => {
  switch (getPrimaryNavItem($page)) {
    case "settings":
      return 3
    default:
      return 0
  }
}

const getCanonicalRouteContext = (url: URL) => {
  const segments = url.pathname.split("/").filter(Boolean)

  if (segments[0] === "c" && segments[1]) {
    const community = parseExactCommunityRouteParam(segments[1])
    const section = segments
      .slice(2)
      .map(segment => decodeURIComponent(segment))
      .join(":")
    if (community) return `community:${community.address}:${section}:${url.search}`
  }

  if (segments[0] === "git" && segments[1]) {
    try {
      const decoded = nip19.decode(decodeURIComponent(segments[1]))
      if (decoded.type === "naddr") {
        const data = decoded.data
        const section = segments
          .slice(2)
          .map(segment => decodeURIComponent(segment))
          .join(":")

        return `git:${data.kind}:${data.pubkey}:${data.identifier}:${section}:${url.search}`
      }
    } catch {
      // Fall through to literal route comparison for malformed or legacy routes.
    }
  }

  return `${normalizeRoutePath(url.pathname)}${url.search}`
}

const isSameRouteContext = (target: URL, current: URL) =>
  getCanonicalRouteContext(target) === getCanonicalRouteContext(current)

const setCurrentTargetHash = (hash: string, suppressNativeScroll = false) => {
  if (!hash) return

  const current = new URL(window.location.href)
  if (current.hash !== hash) {
    if (!suppressNativeScroll) {
      window.location.hash = hash
      return
    }

    const next = new URL(current)
    next.hash = hash
    window.history.pushState(window.history.state, "", next)
    window.dispatchEvent(
      new HashChangeEvent("hashchange", {oldURL: current.href, newURL: next.href}),
    )
    return
  }

  window.dispatchEvent(
    new HashChangeEvent("hashchange", {
      oldURL: current.href,
      newURL: current.href,
    }),
  )
}

const getLocalEventHash = (event: TrustedEvent) =>
  window.location.pathname.startsWith("/git/") && event.kind === GIT_COMMENT
    ? `#comment-${event.id}`
    : `#event-${event.id}`

const isEventTargetHash = (hash: string) =>
  hash.startsWith("#event-") || hash.startsWith("#comment-")

const getRenderedEventTargetId = (event: TrustedEvent) => {
  if (
    event.kind === GIT_PULL_REQUEST_UPDATE ||
    event.kind === GIT_COVER_LETTER ||
    event.kind === GIT_LABEL ||
    GIT_STATUS_KINDS.has(event.kind)
  ) {
    return getGitRootId(event) || event.id
  }

  return event.id
}

const getGitDetailTargetId = (path: string) => {
  const target = new URL(path, window.location.origin)
  if (target.hash) return ""

  const match = target.pathname.match(/\/(?:issues|prs)\/([0-9a-f]{64})$/i)
  return match?.[1] || ""
}

const goToEventTarget = async (
  id: string,
  path: string,
  {
    defaultHash = `#event-${id}`,
    options = {},
  }: {defaultHash?: string; options?: Record<string, any>} = {},
) => {
  const target = new URL(path, window.location.origin)
  if (target.origin !== window.location.origin) {
    window.open(target.href, "_blank", "noopener,noreferrer")
    return false
  }

  if (!target.hash && defaultHash) target.hash = defaultHash

  const href = `${target.pathname}${target.search}${target.hash}`
  const focusEvent = isEventTargetHash(target.hash)
  const routeOwnsFocus = target.pathname.startsWith("/git/") && target.hash.startsWith("#comment-")
  const sameContext = isSameRouteContext(target, new URL(window.location.href))

  if (sameContext) {
    if (target.hash) setCurrentTargetHash(target.hash, routeOwnsFocus)
  } else {
    await goto(href, routeOwnsFocus ? {...options, noScroll: true} : options)
  }

  return focusEvent && !routeOwnsFocus
    ? waitAndScrollToEvent(id, {behavior: sameContext ? "auto" : "smooth"})
    : true
}

export const goToEventIdPath = (id: string, path: string, options: Record<string, any> = {}) => {
  const targetId = getGitDetailTargetId(path) || id
  const hash = new URL(path, window.location.origin).hash || `#event-${targetId}`

  return goToEventTarget(targetId, path, {defaultHash: hash, options})
}

export const goToEventPath = async (
  event: TrustedEvent,
  path: string,
  options: Record<string, any> = {},
) => {
  const isBasicView = /^\/(?:note1|nevent1|naddr1)/.test(path)
  const targetId = isBasicView ? event.id : getRenderedEventTargetId(event)
  const defaultHash = isBasicView
    ? `#event-${event.id}`
    : event.kind === GIT_PERMALINK_KIND
      ? ""
      : targetId === event.id
        ? getLocalEventHash(event)
        : `#event-${targetId}`

  return goToEventTarget(targetId, path, {defaultHash, options})
}

export const goToEvent = async (event: TrustedEvent, options: Record<string, any> = {}) => {
  const urls = getEventRelayHints(event)
  const path = await getEventPath(event, urls)

  return goToEventPath(event, path, options)
}

// The resolver uses this without a fallback so it can render an event in place
// instead of navigating back to itself indefinitely.
export const getDedicatedEventPath = async (event: TrustedEvent, urls: string[]) => {
  const relayHints = getEventRelayHints(event, {relays: urls})

  if (event.kind === 0) return makeProfilePath(event.pubkey, relayHints)

  if (event.kind === DM_KIND) {
    const selfPubkey = pubkey.get()
    const participants = Array.from(new Set([event.pubkey, ...getPubkeyTagValues(event.tags)]))
    const recipients = participants.filter(pk => pk !== selfPubkey)

    if (recipients.length === 0 && selfPubkey && participants.includes(selfPubkey)) {
      return makeChatPath(selfPubkey)
    }

    if (recipients.length !== 1) {
      return "/chat"
    }

    return makeChatPath(recipients[0])
  }

  const communityPath = getCommunityEventPath(event)

  if (communityPath) return communityPath

  const loadedCommunityPath = await loadTargetedPublicationEventPath(event, relayHints)

  if (loadedCommunityPath) return loadedCommunityPath

  const gitPath = await getGitEventPath(event, relayHints)

  return gitPath
}

export const getEventPath = async (event: TrustedEvent, urls: string[]) =>
  (await getDedicatedEventPath(event, urls)) ||
  entityLink(makeEventNevent(event, {relays: getEventRelayHints(event, {relays: urls})}))
