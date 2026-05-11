import {nwc} from "@getalby/sdk"
import * as nip19 from "nostr-tools/nip19"
import {get} from "svelte/store"
import type {Override, MakeOptional} from "@welshman/lib"
import {
  first,
  sha256,
  randomId,
  append,
  remove,
  flatten,
  uniq,
  TIMEZONE,
  LOCALE,
  parseJson,
  fromPairs,
  simpleCache,
  normalizeUrl,
  nthNe,
} from "@welshman/lib"
import {decrypt, Nip01Signer} from "@welshman/signer"
import type {UploadTask} from "@welshman/editor"
import type {Feed} from "@welshman/feeds"
import {makeIntersectionFeed, feedFromFilters, makeRelayFeed} from "@welshman/feeds"
import type {TrustedEvent, EventContent, Profile} from "@welshman/util"
import {
  DELETE,
  REPORT,
  PROFILE,
  RELAYS,
  FOLLOWS,
  REACTION,
  COMMENT,
  ALERT_EMAIL,
  ALERT_WEB,
  ALERT_IOS,
  ALERT_ANDROID,
  APP_DATA,
  isSignedEvent,
  makeEvent,
  normalizeRelayUrl,
  isRelayUrl,
  makeList,
  getTag,
  getListTags,
  getRelayTags,
  toNostrURI,
  getRelaysFromList,
  RelayMode,
  getAddress,
  getTagValue,
  getTagValues,
  uploadBlob,
  canUploadBlob,
  encryptFile,
  makeBlossomAuthEvent,
  isPublishedProfile,
  editProfile,
  createProfile,
  uniqTags,
  MESSAGING_RELAYS,
} from "@welshman/util"
import {Pool} from "@welshman/net"
import {Router} from "@welshman/router"
import {
  pubkey,
  sign,
  signer,
  session,
  repository,
  tracker,
  publishThunk,
  tagEvent,
  tagEventForReaction,
  dropSession,
  tagEventForComment,
  waitForThunkError,
  getPubkeyRelays,
  userMessagingRelayList,
  userRelayList,
  userBlossomServerList,
} from "@welshman/app"
import {GIT_REPO_ANNOUNCEMENT, GIT_REPO_STATE} from "@nostr-git/core/events"
import {compressFile} from "@lib/html"
import {kv, db} from "@app/core/storage"
import type {SettingsValues, Alert} from "@app/core/state"
import {
  SETTINGS,
  INDEXER_RELAYS,
  NOTIFIER_PUBKEY,
  NOTIFIER_RELAY,
  NOTIFIER_HANDLER_ADDRESS,
  NOTIFIER_HANDLER_RELAY,
  DEFAULT_BLOSSOM_SERVERS,
  SMART_WIDGET_RELAYS,
  userSettingsValues,
  getSetting,
} from "@app/core/state"
import {loadAlertStatuses} from "@app/core/requests"
import {platform, platformName, getPushInfo} from "@app/util/push"
import {DM_KIND, getMessagingRelayHints} from "@app/core/dm"
import {
  extensionSettings,
  getInstalledExtensions,
  getInstalledExtension,
  isExtensionEnabled,
} from "@app/extensions/settings"
import {extensionRegistry, parseSmartWidget} from "@app/extensions/registry"
import {request} from "@welshman/net"
import type {ExtensionManifest, SmartWidgetEvent} from "@app/extensions/types"
import {activeRepoClass} from "@app/core/git-state"
import {deleteIndexedDB} from "@lib/util"
import {getQuoteEventTags} from "@app/util/git-quote"

// Utils

const SMART_WIDGET_KIND = 30033

export const installExtension = async (manifestUrl: string) => {
  // Fetch + validate + register the manifest in the registry
  const manifest = await extensionRegistry.load(manifestUrl)

  // Persist into settings.installed and store manifest URL for update checking
  extensionSettings.update(s => ({
    ...s,
    installed: {
      nip89: {...(s.installed?.nip89 || {}), [manifest.id]: manifest},
      widget: s.installed?.widget || {},
      legacy: s.installed?.legacy,
    },
    manifestUrls: {...(s.manifestUrls || {}), [manifest.id]: manifestUrl},
  }))

  return manifest
}

export const uninstallExtension = async (id: string) => {
  // Unload runtime if present
  await extensionRegistry.unloadExtension(id)

  extensionSettings.update(s => {
    const nip89 = {...(s.installed?.nip89 || {})}
    const widget = {...(s.installed?.widget || {})}
    delete nip89[id]
    delete widget[id]
    return {
      ...s,
      installed: {
        nip89,
        widget,
        legacy: s.installed?.legacy,
      },
      enabled: s.enabled.filter(e => e !== id),
    }
  })
}

export const installExtensionFromManifest = (manifest: ExtensionManifest) => {
  extensionRegistry.register(manifest)
  extensionSettings.update(s => ({
    ...s,
    installed: {
      nip89: {...(s.installed?.nip89 || {}), [manifest.id]: manifest},
      widget: s.installed?.widget || {},
      legacy: s.installed?.legacy,
    },
  }))
  return manifest
}

export const installWidgetFromEvent = (event: TrustedEvent) => {
  const widget = parseSmartWidget(event)
  extensionRegistry.registerWidget(widget)
  extensionSettings.update(s => ({
    ...s,
    installed: {
      nip89: s.installed?.nip89 || {},
      widget: {...(s.installed?.widget || {}), [widget.identifier]: widget},
      legacy: s.installed?.legacy,
    },
  }))
  return widget
}

export const installWidgetByNaddr = async (naddr: string) => {
  const decoded = nip19.decode(naddr)
  if (decoded.type !== "naddr") throw new Error("Invalid naddr")
  const data = decoded.data as nip19.AddressPointer
  const relays = data.relays?.length ? data.relays : SMART_WIDGET_RELAYS
  const kind = data.kind || SMART_WIDGET_KIND
  const filters = [{kinds: [kind], authors: [data.pubkey], "#d": [data.identifier], limit: 1}]
  try {
    await request({relays, filters, autoClose: true})
  } catch (e) {
    console.warn("Widget fetch error", e)
  }
  const events = repository.query(filters)
  if (!events.length) {
    throw new Error("Widget not found")
  }
  return installWidgetFromEvent(events[0] as TrustedEvent)
}

// NIP-89 discovery (kind 31990)
export const discoverExtensions = async (): Promise<ExtensionManifest[]> => {
  const KIND = 31990
  // Ask indexers for manifests, then read from local repository cache
  try {
    await request({
      relays: INDEXER_RELAYS,
      filters: [{kinds: [KIND], limit: 100}],
      autoClose: true,
    })
  } catch (e) {
    console.warn("Discovery request errored:", e)
  }

  const events = repository.query([{kinds: [KIND]}])
  const manifests: ExtensionManifest[] = []

  for (const ev of events) {
    try {
      const m = JSON.parse(ev.content)
      if (m && m.id && m.name && m.entrypoint) {
        manifests.push(m as ExtensionManifest)
      }
    } catch (_e) {
      // ignore malformed manifest content
    }
  }

  // De-duplicate by id, prefer latest by created_at
  const byId = new Map<string, ExtensionManifest>()
  for (const m of manifests) {
    const existing = byId.get(m.id)
    if (!existing || ((m as any).created_at ?? 0) > ((existing as any).created_at ?? 0)) {
      byId.set(m.id, m)
    }
  }

  return Array.from(byId.values())
}

export const discoverSmartWidgets = async (): Promise<SmartWidgetEvent[]> => {
  const relays = uniq([...SMART_WIDGET_RELAYS, ...INDEXER_RELAYS])
  const filters = [{kinds: [SMART_WIDGET_KIND], limit: 200}]

  try {
    await request({relays, filters, autoClose: true})
  } catch (e) {
    console.warn("Smart widget discovery errored:", e)
  }

  const events = repository.query([{kinds: [SMART_WIDGET_KIND]}])
  const widgets: SmartWidgetEvent[] = []

  for (const ev of events) {
    try {
      widgets.push(parseSmartWidget(ev))
    } catch (_e) {
      // ignore malformed widget
    }
  }

  // Deduplicate by identifier, keeping the newest version
  const byId = new Map<string, SmartWidgetEvent>()
  for (const widget of widgets) {
    const existing = byId.get(widget.identifier)
    if (
      !existing ||
      (widget.created_at && existing.created_at && widget.created_at > existing.created_at)
    ) {
      byId.set(widget.identifier, widget)
    }
  }

  return Array.from(byId.values())
}

export const enableExtension = async (id: string) => {
  // Persist enabled flag
  extensionSettings.update(s => ({
    ...s,
    enabled: s.enabled.includes(id) ? s.enabled : [...s.enabled, id],
  }))

  // Load the extension iframe/runtime
  const installed = getInstalledExtensions()
  const manifest = installed.nip89[id]
  const widget = installed.widget[id]

  if (manifest) {
    try {
      await extensionRegistry.loadIframeExtension(manifest)
    } catch (e) {
      console.warn("Failed to load extension", id, e)
    }
  } else if (widget) {
    try {
      await extensionRegistry.loadWidget(widget)
    } catch (e) {
      console.warn("Failed to load widget", id, e)
    }
  }
}

export const disableExtension = async (id: string) => {
  // Unload runtime
  await extensionRegistry.unloadExtension(id)

  extensionSettings.update(s => ({
    ...s,
    enabled: s.enabled.filter(e => e !== id),
  }))
}

/**
 * Check if an extension has an update available by fetching the latest manifest.
 * Returns the new manifest if an update is available, null otherwise.
 */
export const checkForExtensionUpdate = async (
  id: string,
  manifestUrl: string,
): Promise<ExtensionManifest | null> => {
  try {
    const latestManifest = await extensionRegistry.load(manifestUrl)
    const installed = getInstalledExtension(id)

    if (!installed || !("version" in installed)) return null

    const installedVersion = (installed as ExtensionManifest).version
    const latestVersion = latestManifest.version

    // Compare versions
    if (latestVersion && installedVersion) {
      const installedParts = installedVersion.replace(/^v/, "").split(".").map(Number)
      const latestParts = latestVersion.replace(/^v/, "").split(".").map(Number)

      for (let i = 0; i < Math.max(installedParts.length, latestParts.length); i++) {
        const installed = installedParts[i] || 0
        const latest = latestParts[i] || 0
        if (latest > installed) return latestManifest
        if (latest < installed) return null
      }
    }

    return null
  } catch (e) {
    console.error("Failed to check for extension update:", e)
    return null
  }
}

/**
 * Refresh an extension by unloading it, updating the manifest, and reloading if enabled.
 */
export const refreshExtension = async (id: string, newManifest: ExtensionManifest) => {
  const wasEnabled = isExtensionEnabled(id)

  // Unload if currently loaded
  if (wasEnabled) {
    await extensionRegistry.unloadExtension(id)
  }

  // Update the installed manifest
  extensionSettings.update(s => ({
    ...s,
    installed: {
      nip89: {...(s.installed?.nip89 || {}), [id]: newManifest},
      widget: s.installed?.widget || {},
      legacy: s.installed?.legacy,
    },
  }))

  // Reload if it was enabled
  if (wasEnabled) {
    await extensionRegistry.loadIframeExtension(newManifest)
  }

  return newManifest
}

export const getPubkeyHints = (pubkey: string) => {
  const relays = getPubkeyRelays(pubkey, RelayMode.Write)
  const hints = relays.length ? relays : INDEXER_RELAYS

  return hints
}

const getEventRelayHints = (event: TrustedEvent, explicitRelays: string[] = []) => {
  const relays = new Set<string>()
  const addRelay = (relay: string | undefined) => {
    if (!relay) return
    try {
      const normalized = normalizeRelayUrl(relay)
      if (isRelayUrl(normalized)) relays.add(normalized)
    } catch {
      // Ignore non-relay tag values such as addresses, pubkeys, and labels.
    }
  }

  for (const relay of explicitRelays) addRelay(relay)
  for (const relay of tracker.getRelays(event.id)) addRelay(relay)

  return Array.from(relays)
}

const tagEventForShareQuote = (event: TrustedEvent, relays: string[]) =>
  getQuoteEventTags({id: event.id, author: event.pubkey, relays})

export const prependParent = (
  parent: TrustedEvent | undefined,
  {content, tags}: EventContent,
  {relays = []}: {relays?: string[]} = {},
) => {
  if (parent) {
    const relayHints = getEventRelayHints(parent, relays)
    const nevent = nip19.neventEncode({
      id: parent.id,
      kind: parent.kind,
      author: parent.pubkey,
      relays: relayHints,
    })

    tags = [...tags, ...tagEventForShareQuote(parent, relayHints)]
    content = toNostrURI(nevent) + "\n\n" + content
  }

  return {content, tags}
}

// Log out

const bestEffortWithTimeout = async (
  operation: Promise<unknown>,
  label: string,
  timeoutMs: number,
) => {
  let timeout: ReturnType<typeof setTimeout> | null = null
  let done = false

  const finish = (resolve: () => void) => {
    if (done) return
    done = true
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
    }
    resolve()
  }

  await new Promise<void>(resolve => {
    timeout = setTimeout(() => {
      console.warn(`[logout] ${label} timed out after ${timeoutMs}ms`)
      finish(resolve)
    }, timeoutMs)

    operation
      .catch(error => {
        console.warn(`[logout] ${label} failed`, error)
      })
      .finally(() => finish(resolve))
  })
}

export const logout = async () => {
  const $pubkey = pubkey.get()

  try {
    const repo = get(activeRepoClass)
    repo?.dispose?.()
  } catch (error) {
    console.warn("[logout] Failed to dispose active repo", error)
  } finally {
    activeRepoClass.set(undefined)
  }

  if ($pubkey) {
    dropSession($pubkey)
  }

  localStorage.clear()

  await bestEffortWithTimeout(kv.clear(), "Preferences clear", 2500)
  await bestEffortWithTimeout(db.clear(), "Main IndexedDB clear", 3000)
  await bestEffortWithTimeout(nostrGitLogoutCleanup(), "Nostr-Git DB cleanup", 2000)
}

export async function nostrGitLogoutCleanup(): Promise<void> {
  try {
    await Promise.all([deleteIndexedDB("nostr-git"), deleteIndexedDB("nostr-git-cache")])
  } catch (err) {
    console.error("Nostr-Git IndexedDB cleanup failed", err)
  }
}

// Synchronization

export const broadcastUserData = async (relays: string[]) => {
  const authors = [pubkey.get()!]
  const kinds = [RELAYS, MESSAGING_RELAYS, FOLLOWS, PROFILE]
  const events = repository.query([{kinds, authors}])

  for (const event of events) {
    if (isSignedEvent(event)) {
      await publishThunk({event, relays}).complete
    }
  }
}

// List updates

export const setRelayPolicy = (url: string, read: boolean, write: boolean) => {
  const list = get(userRelayList) || makeList({kind: RELAYS})
  const tags = getRelayTags(getListTags(list)).filter(t => normalizeRelayUrl(t[1]) !== url)

  if (read && write) {
    tags.push(["r", url])
  } else if (read) {
    tags.push(["r", url, "read"])
  } else if (write) {
    tags.push(["r", url, "write"])
  }

  return publishThunk({
    event: makeEvent(list.kind, {tags}),
    relays: [url, ...INDEXER_RELAYS, ...Router.get().FromUser().getUrls()],
  })
}

export const setMessagingRelayPolicy = (url: string, enabled: boolean) => {
  const list = get(userMessagingRelayList) || makeList({kind: MESSAGING_RELAYS})

  // Only update messaging policies if they already exist or we're adding them
  if (enabled || getRelaysFromList(list).includes(url)) {
    const tags = getRelayTags(getListTags(list)).filter(t => normalizeRelayUrl(t[1]) !== url)

    if (enabled) {
      tags.push(["relay", url])
    }

    return publishThunk({
      event: makeEvent(list.kind, {tags}),
      relays: [...INDEXER_RELAYS, ...Router.get().FromUser().getUrls()],
    })
  }
}

// Relay access

export const canEnforceNip70 = async (_url: string) => {
  return false
}

// Deletions

export type DeleteParams = {
  protect: boolean
  event: TrustedEvent
  tags?: string[][]
}

const getRepoAddressForDelete = (event: TrustedEvent) => {
  const repoTag = getTagValue("repo", event.tags)
  if (repoTag) return repoTag
  const addressTag = getTagValue("a", event.tags)
  if (addressTag && addressTag.startsWith(`${GIT_REPO_ANNOUNCEMENT}:`)) {
    return addressTag
  }
  if (event.kind === GIT_REPO_ANNOUNCEMENT || event.kind === GIT_REPO_STATE) {
    try {
      return getAddress(event)
    } catch {
      return ""
    }
  }
  return ""
}

const stripProtectedTags = (tags: string[][] = []) => tags.filter(nthNe(0, "-"))

export const makeDelete = ({event, tags = []}: DeleteParams) => {
  const thisTags = [["k", String(event.kind)], ...tagEvent(event), ...stripProtectedTags(tags)]
  const repoAddress = getRepoAddressForDelete(event)
  if (repoAddress) {
    thisTags.push(["repo", repoAddress])
  }
  const groupTag = getTag("h", event.tags)

  if (groupTag) {
    thisTags.push(groupTag)
  }

  return makeEvent(DELETE, {tags: uniqTags(thisTags)})
}

const logDeleteDebug = ({
  deleteEvent,
  targetEvent,
  relays,
}: {
  deleteEvent: TrustedEvent
  targetEvent: TrustedEvent
  relays: string[]
}) => {
  const targetAddress = (() => {
    try {
      return getAddress(targetEvent)
    } catch {
      return ""
    }
  })()

  console.info("[budabit][delete-debug]", {
    relays,
    deleteEvent: {
      id: deleteEvent.id,
      kind: deleteEvent.kind,
      pubkey: deleteEvent.pubkey,
      created_at: deleteEvent.created_at,
      tags: deleteEvent.tags,
    },
    targetEvent: {
      id: targetEvent.id,
      kind: targetEvent.kind,
      pubkey: targetEvent.pubkey,
      created_at: targetEvent.created_at,
      address: targetAddress,
      tags: targetEvent.tags,
    },
    targetDeletedLocally: (repository as any).isDeleted?.(targetEvent) ?? false,
  })
}

export const publishDelete = ({relays, ...params}: DeleteParams & {relays: string[]}) => {
  const thunk = publishThunk({event: makeDelete(params), relays})

  logDeleteDebug({
    deleteEvent: thunk.event as TrustedEvent,
    targetEvent: params.event,
    relays,
  })

  return thunk
}

const sanitizeDeleteRelays = (relays: string[]) =>
  uniq(
    (relays || [])
      .map(relay => {
        try {
          return normalizeRelayUrl(relay)
        } catch {
          return ""
        }
      })
      .filter(isRelayUrl),
  )

export const getDeleteRelaysForSocialEvent = ({
  url,
  event,
}: {
  url?: string
  event: TrustedEvent
}) => {
  const seenRelays = sanitizeDeleteRelays(Array.from(tracker.getRelays(event.id)))

  if (event.kind === DM_KIND) {
    return sanitizeDeleteRelays([...seenRelays, ...getMessagingRelayHints()])
  }

  const currentRelay = url ? sanitizeDeleteRelays([url]) : []
  const fallbackRelays = [...currentRelay, ...seenRelays]

  return sanitizeDeleteRelays([...fallbackRelays, ...currentRelay, ...seenRelays])
}

export const publishSocialDelete = ({
  url,
  relays,
  ...params
}: DeleteParams & {url?: string; relays?: string[]}) =>
  publishDelete({
    ...params,
    relays:
      relays && relays.length > 0
        ? sanitizeDeleteRelays(relays)
        : getDeleteRelaysForSocialEvent({url, event: params.event}),
  })

// Reports

export type ReportParams = {
  event: TrustedEvent
  content: string
  reason: string
}

export const makeReport = ({event, reason, content}: ReportParams) => {
  const tags = [
    ["p", event.pubkey],
    ["e", event.id, reason],
  ]

  return makeEvent(REPORT, {content, tags})
}

export const publishReport = ({
  relays,
  event,
  reason,
  content,
}: ReportParams & {relays: string[]}) =>
  publishThunk({event: makeReport({event, reason, content}), relays})

// Reactions

export type ReactionParams = {
  protect: boolean
  event: TrustedEvent
  content: string
  tags?: string[][]
}

export const makeReaction = ({content, event, tags: paramTags = []}: ReactionParams) => {
  const tags = [...stripProtectedTags(paramTags), ...tagEventForReaction(event)]
  const groupTag = getTag("h", event.tags)

  if (groupTag) {
    tags.push(groupTag)
  }

  return makeEvent(REACTION, {content, tags})
}

export const publishReaction = ({relays, ...params}: ReactionParams & {relays: string[]}) =>
  publishThunk({event: makeReaction(params), relays})

// Comments

export type CommentParams = {
  event: TrustedEvent
  content: string
  tags?: string[][]
}

export const makeComment = ({event, content, tags = []}: CommentParams) =>
  makeEvent(COMMENT, {content, tags: [...stripProtectedTags(tags), ...tagEventForComment(event)]})

export const publishComment = ({relays, ...params}: CommentParams & {relays: string[]}) =>
  publishThunk({event: makeComment(params), relays})

// Alerts

export type AlertParamsEmail = {
  cron: string
  email: string
  handler: string[]
}

export type AlertParamsWeb = {
  endpoint: string
  p256dh: string
  auth: string
}

export type AlertParamsIos = {
  device_token: string
  bundle_identifier: string
}

export type AlertParamsAndroid = {
  device_token: string
}

export type AlertParams = {
  feed: Feed
  description: string
  claims?: Record<string, string>
  email?: AlertParamsEmail
  web?: AlertParamsWeb
  ios?: AlertParamsIos
  android?: AlertParamsAndroid
}

export const makeAlert = async (params: AlertParams) => {
  const tags = [
    ["feed", JSON.stringify(params.feed)],
    ["locale", LOCALE],
    ["timezone", TIMEZONE],
    ["description", params.description],
  ]

  for (const [relay, claim] of Object.entries(params.claims || [])) {
    tags.push(["claim", relay, claim])
  }

  let kind: number
  if (params.email) {
    kind = ALERT_EMAIL
    tags.push(...Object.entries(params.email).map(flatten))
  } else if (params.web) {
    kind = ALERT_WEB
    tags.push(...Object.entries(params.web).map(flatten))
  } else if (params.ios) {
    kind = ALERT_IOS
    tags.push(...Object.entries(params.ios).map(flatten))
  } else if (params.android) {
    kind = ALERT_ANDROID
    tags.push(...Object.entries(params.android).map(flatten))
  } else {
    throw new Error("Alert has invalid params")
  }

  return makeEvent(kind, {
    content: await signer.get().nip44.encrypt(NOTIFIER_PUBKEY, JSON.stringify(tags)),
    tags: [
      ["d", randomId()],
      ["p", NOTIFIER_PUBKEY],
    ],
  })
}

export const publishAlert = async (params: AlertParams) =>
  publishThunk({event: await makeAlert(params), relays: [NOTIFIER_RELAY]})

export const deleteAlert = (alert: Alert) => {
  const relays = [NOTIFIER_RELAY]
  const tags = [["p", NOTIFIER_PUBKEY]]

  return publishDelete({event: alert.event, relays, tags, protect: false})
}

export type CreateAlertParams = Override<
  AlertParams,
  {
    email?: MakeOptional<AlertParamsEmail, "handler">
  }
>

export type CreateAlertResult = {
  ok?: true
  error?: string
}

const DEFAULT_NOTIFIER_HANDLER_ADDRESS =
  "31990:97c70a44366a6535c145b333f973ea86dfdc2d7a99da618c40c64705ad98e322:1737058597050"
const DEFAULT_NOTIFIER_HANDLER_RELAY = "wss://purplepag.es/"

const getNotifierHandler = () => {
  const address = NOTIFIER_HANDLER_ADDRESS || DEFAULT_NOTIFIER_HANDLER_ADDRESS
  const relay = NOTIFIER_HANDLER_RELAY || NOTIFIER_RELAY || DEFAULT_NOTIFIER_HANDLER_RELAY
  return [address, relay, "web"]
}

export const createAlert = async (params: CreateAlertParams): Promise<CreateAlertResult> => {
  if (params.email) {
    const cadence = params.email.cron.endsWith("1") ? "Weekly" : "Daily"
    const handler = getNotifierHandler()

    params.email = {handler, ...params.email}
    params.description = `${cadence} alert ${params.description}, sent via email.`
  } else {
    try {
      // @ts-ignore
      params[platform] = await getPushInfo()
      params.description = `${platformName} push notification ${params.description}.`
    } catch (e: any) {
      return {error: String(e)}
    }
  }

  // If we don't do this we'll get an event rejection
  await Pool.get().get(NOTIFIER_RELAY).auth.attemptAuth(sign)

  const thunk = await publishAlert(params as AlertParams)
  const error = await waitForThunkError(thunk)

  if (error) {
    return {error}
  }

  // Fetch our new status to make sure it's active
  const $pubkey = pubkey.get()!
  const address = getAddress(thunk.event)
  const statusEvents = await loadAlertStatuses($pubkey!)
  const statusEvent = statusEvents.find(event => getTagValue("d", event.tags) === address)
  const statusTags = statusEvent
    ? parseJson(await decrypt(signer.get(), NOTIFIER_PUBKEY, statusEvent.content))
    : []
  const {status = "error", message = "Your alert was not activated"}: Record<string, string> =
    fromPairs(statusTags)

  if (status === "error") {
    return {error: message}
  }

  return {ok: true}
}

export const createDmAlert = async () => {
  const $pubkey = pubkey.get()!

  return createAlert({
    description: `for direct messages.`,
    feed: makeIntersectionFeed(
      feedFromFilters([{kinds: [DM_KIND], "#p": [$pubkey]}]),
      makeRelayFeed(...getPubkeyRelays($pubkey, RelayMode.Messaging)),
    ),
  })
}

// Settings

export const makeSettings = async (params: Partial<SettingsValues>) => {
  const json = JSON.stringify({...get(userSettingsValues), ...params})
  const content = await signer.get().nip44.encrypt(pubkey.get()!, json)
  const tags = [["d", SETTINGS]]

  return makeEvent(APP_DATA, {content, tags})
}

export const publishSettings = async (params: Partial<SettingsValues>) =>
  publishThunk({event: await makeSettings(params), relays: Router.get().FromUser().getUrls()})

export const addTrustedRelay = async (url: string) =>
  publishSettings({trusted_relays: append(url, getSetting<string[]>("trusted_relays"))})

export const removeTrustedRelay = async (url: string) =>
  publishSettings({trusted_relays: remove(url, getSetting<string[]>("trusted_relays"))})

// Lightning

export const getWebLn = () => (window as any).webln

export const payInvoice = async (invoice: string, msats?: number) => {
  const $session = session.get()

  if (!$session?.wallet) {
    throw new Error("No wallet is connected")
  }

  if ($session.wallet.type === "nwc") {
    const params: {invoice: string; amount?: number} = {invoice}
    if (msats) params.amount = msats
    return new nwc.NWCClient($session.wallet.info).payInvoice(params)
  } else if ($session.wallet.type === "webln") {
    if (msats) throw new Error("Unable to pay zero invoices with webln")
    return getWebLn()
      .enable()
      .then(() => getWebLn().sendPayment(invoice))
  }
}

// File upload

export const normalizeBlossomUrl = (url: string) => normalizeUrl(url.replace(/^ws/, "http"))

export const fetchHasBlossomSupport = async (url: string) => {
  const server = normalizeBlossomUrl(url)
  const $signer = signer.get() || Nip01Signer.ephemeral()
  const headers: Record<string, string> = {
    "X-Content-Type": "text/plain",
    "X-Content-Length": "1",
    "X-SHA-256": "73cb3858a687a8494ca3323053016282f3dad39d42cf62ca4e79dda2aac7d9ac",
  }

  try {
    const authEvent = await $signer.sign(makeBlossomAuthEvent({action: "upload", server}))
    const res = await canUploadBlob(server, {authEvent, headers})

    return res.status === 200
  } catch (e) {
    if (!String(e).match(/Failed to fetch|NetworkError/)) {
      console.error(e)
    }
  }

  return false
}

export const hasBlossomSupport = simpleCache(([url]: [string]) => fetchHasBlossomSupport(url))

export type GetBlossomServerOptions = {
  url?: string
}

export const getBlossomServer = async (options: GetBlossomServerOptions = {}) => {
  if (options.url) {
    if (await hasBlossomSupport(options.url)) {
      return normalizeBlossomUrl(options.url)
    }
  }

  const userUrls = getTagValues("server", getListTags(get(userBlossomServerList)))

  for (const url of userUrls) {
    return normalizeBlossomUrl(url)
  }

  return first(DEFAULT_BLOSSOM_SERVERS)!
}

export type UploadFileOptions = {
  url?: string
  encrypt?: boolean
  maxWidth?: number
  maxHeight?: number
}

export type UploadFileResult = {
  error?: string
  result?: UploadTask
}

export const uploadFile = async (file: File, options: UploadFileOptions = {}) => {
  try {
    const {name, type} = file

    if (!type.match("image/(webp|gif|svg)")) {
      file = await compressFile(file, options)
    }

    const tags: string[][] = []

    if (options.encrypt) {
      const {ciphertext, key, nonce, algorithm} = await encryptFile(file)

      tags.push(
        ["decryption-key", key],
        ["decryption-nonce", nonce],
        ["encryption-algorithm", algorithm],
      )

      file = new File([new Uint8Array(ciphertext)], name, {
        type: "application/octet-stream",
      })
    }

    const ext = "." + type.split("/")[1]
    const server = await getBlossomServer(options)
    const hashes = [await sha256(await file.arrayBuffer())]
    const $signer = signer.get() || Nip01Signer.ephemeral()
    const authTemplate = makeBlossomAuthEvent({action: "upload", server, hashes})
    const authEvent = await $signer.sign(authTemplate)
    const res = await uploadBlob(server, file, {authEvent})
    const text = await res.text()

    let {uploaded, url, ...task} = parseJson(text) || {}

    if (!uploaded) {
      return {error: text || `Failed to upload file (HTTP ${res.status})`}
    }

    // Always append correct file extension if we encrypted the file, or if it's missing
    if (options.encrypt) {
      url = url.replace(/\.\w+$/, "") + ext
    } else if (new URL(url).pathname.split(".").length === 1) {
      url += ext
    }

    const result = {...task, tags, url}

    return {result}
  } catch (e: any) {
    console.error("Error caught when uploading file:", e)

    return {error: e.toString()}
  }
}

// Update Profile

export const updateProfile = async ({
  profile,
  shouldBroadcast = true,
}: {
  profile: Profile
  shouldBroadcast?: boolean
}) => {
  const router = Router.get()
  const template = isPublishedProfile(profile) ? editProfile(profile) : createProfile(profile)
  template.tags = stripProtectedTags(template.tags)
  const scenarios = shouldBroadcast ? [router.FromUser(), router.Index()] : [router.FromUser()]

  const event = makeEvent(template.kind, template)
  const relays = router.merge(scenarios).getUrls()

  await publishThunk({event, relays}).complete
}
