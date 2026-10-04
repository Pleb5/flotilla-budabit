import {nip19} from "nostr-tools"
import type {Filter, TrustedEvent} from "@welshman/util"
import type {RepoAnnouncementEvent} from "@nostr-git/core/events"
import {queryExtensionRelays} from "@app/extensions/nostr-query"
import {deletionDeletesEvent} from "@app/core/deletion-rules"
import {getRepoMaintainers} from "@app/core/repo-authority"
import {
  authorizedApplication,
  authorizedRelease,
  coordinate,
  replacements,
  tag,
  verifiedEvent,
} from "../../../packages/budabit-releases-extension/packages/iframe-app/src/lib/trust"
import {
  normalizeRelays,
  type RepoContext,
} from "../../../packages/budabit-releases-extension/packages/iframe-app/src/lib/context"
import {
  parseApplication,
  parseAsset,
} from "../../../packages/budabit-releases-extension/packages/iframe-app/src/lib/releases"
export {assetDownloadUrl} from "../../../packages/budabit-releases-extension/packages/iframe-app/src/lib/releases"

type Event = NonNullable<ReturnType<typeof verifiedEvent>>
type Query = typeof queryExtensionRelays

export function softwareReleasePointer(value: string) {
  try {
    const decoded = nip19.decode(value)
    return decoded.type === "naddr" && decoded.data.kind === 30063 && decoded.data.identifier
      ? decoded.data
      : null
  } catch {
    return null
  }
}

/** Resolve an exact release within the current repository; pointers never establish authority. */
export async function loadSoftwareReleaseLink(
  announcement: TrustedEvent,
  pointer: string,
  relayHints: string[],
  signal: AbortSignal,
  query: Query = queryExtensionRelays,
) {
  const repo = verifiedEvent(announcement)
  const target = softwareReleasePointer(pointer)
  if (!repo || repo.kind !== 30617 || !target) return null
  const maintainers = getRepoMaintainers(repo as RepoAnnouncementEvent)
  if (!maintainers.includes(target.pubkey)) return null
  const relays = normalizeRelays([
    ...repo.tags.filter(t => t[0] === "relays").flatMap(t => t.slice(1)),
    ...relayHints,
    ...(target.relays || []),
  ]).slice(0, 8)
  let partial = false
  async function read(filter: Filter, sources = relays) {
    signal.throwIfAborted()
    const result = await query(sources, {...filter, limit: 500})
    signal.throwIfAborted()
    if (!result.completedRelays.length || result.events.length >= 500)
      throw new Error("Software release lookup is incomplete; retry the relay read.")
    partial ||= !result.complete
    return result.events.map(verifiedEvent).filter((e): e is Event => e !== null)
  }
  const release = replacements(
    await read({kinds: [30063], authors: [target.pubkey], "#d": [target.identifier]}),
  )[0]
  if (!release) return null
  const appId = tag(release, "i") || tag(release, "d")?.split("@")[0]
  const appLinks = [
    ...new Set(release.tags.filter(t => t[0] === "a" && t[1]?.startsWith("32267:")).map(t => t[1])),
  ]
  if (!appId || appLinks.length > 1) return null
  const address = appLinks[0] || `32267:${release.pubkey}:${appId}`
  const match = /^32267:([0-9a-f]{64}):(.+)$/.exec(address)
  if (!match || !maintainers.includes(match[1])) return null
  const application = replacements(
    await read({kinds: [32267], authors: [match[1]], "#d": [match[2]]}),
  )[0]
  if (!application) return null
  const context: RepoContext = {
    repoPubkey: repo.pubkey,
    repoName: tag(repo, "d") || "",
    repoAddress: coordinate(repo),
    repoNaddr: "",
    repoRelays: relays,
    relayHints,
    relaySource: "announcement",
    userPubkey: "",
    maintainers,
    repoUrls: repo.tags.filter(t => ["clone", "web"].includes(t[0])).flatMap(t => t.slice(1)),
  }
  if (!authorizedApplication(application, context)) return null
  const app = parseApplication(application)
  if (!authorizedRelease(release, context, [app])) return null
  const ids = [
    ...new Set(
      release.tags.filter(t => t[0] === "e" && /^[0-9a-f]{64}$/.test(t[1] || "")).map(t => t[1]),
    ),
  ]
  if (ids.length > 200) throw new Error("This release exceeds the asset lookup limit.")
  const assetRelays = normalizeRelays([
    ...release.tags.filter(t => t[0] === "e").map(t => t[2]),
    ...relays,
  ]).slice(0, 8)
  const assets = await read({kinds: [3063], ids}, assetRelays)
  const records = [repo, release, application, ...assets]
  const deletions = (
    await Promise.all([
      read(
        {kinds: [5], "#a": [coordinate(repo), coordinate(release), coordinate(application)]},
        assetRelays,
      ),
      read({kinds: [5], "#e": records.map(e => e.id)}, assetRelays),
    ])
  ).flat()
  const deleted = (event: Event) =>
    deletions.some(d => deletionDeletesEvent(d as TrustedEvent, event as TrustedEvent))
  if ([repo, release, application].some(deleted)) return null
  const version = tag(release, "version") || tag(release, "d")!.slice(appId.length + 1)
  const accepted = assets
    .filter(event => {
      const links = [
        ...new Set(
          event.tags.filter(t => t[0] === "a" && t[1]?.startsWith("32267:")).map(t => t[1]),
        ),
      ]
      return (
        !deleted(event) &&
        event.pubkey === release.pubkey &&
        tag(event, "i") === app.appId &&
        tag(event, "version") === version &&
        (!links.length || (links.length === 1 && links[0] === coordinate(application)))
      )
    })
    .map(parseAsset)
    .filter(asset => asset !== null)
  const ordered = ids.flatMap(id => accepted.filter(asset => asset.eventId === id))
  return {
    event: release,
    application: app,
    version,
    assets: ordered,
    missingAssets: ids.length - ordered.length,
    partial,
  }
}

export type SoftwareReleaseLink = NonNullable<Awaited<ReturnType<typeof loadSoftwareReleaseLink>>>
