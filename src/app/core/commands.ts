import * as nip19 from "nostr-tools/nip19"
import {get} from "svelte/store"
// removed deprecated type imports from @welshman/lib
import {
  sha256,
  randomId,
  append,
  remove,
  flatten,
  poll,
  uniq,
  equals,
  TIMEZONE,
  LOCALE,
  parseJson,
  fromPairs,
  last,
} from "@welshman/lib"
import {decrypt, Nip01Signer} from "@welshman/signer"
import type {UploadTask} from "@welshman/editor"
import type {Feed} from "@welshman/feeds"
import {makeIntersectionFeed, feedFromFilters, makeRelayFeed} from "@welshman/feeds"
import type {TrustedEvent, EventContent} from "@welshman/util"
import {
  WRAP,
  DELETE,
  REPORT,
  PROFILE,
  INBOX_RELAYS,
  RELAYS,
  FOLLOWS,
  REACTION,
  AUTH_JOIN,
  ROOMS,
  COMMENT,
  ALERT_EMAIL,
  ALERT_WEB,
  ALERT_IOS,
  ALERT_ANDROID,
  APP_DATA,
  isSignedEvent,
  makeEvent,
  displayProfile,
  normalizeRelayUrl,
  makeList,
  addToListPublicly,
  removeFromListByPredicate,
  getTag,
  getListTags,
  getRelayTags,
  getRelayTagValues,
  toNostrURI,
  getRelaysFromList,
  RelayMode,
  getAddress,
  getTagValue,
  getTagValues,
  uploadBlob,
  encryptFile,
  makeBlossomAuthEvent,
} from "@welshman/util"
import {Pool, AuthStatus, SocketStatus} from "@welshman/net"
import {Router} from "@welshman/router"
import {
  pubkey,
  signer,
  repository,
  publishThunk,
  profilesByPubkey,
  tagEvent,
  tagEventForReaction,
  userRelaySelections,
  userInboxRelaySelections,
  nip44EncryptToSelf,
  loadRelay,
  clearStorage,
  dropSession,
  tagEventForComment,
  tagEventForQuote,
  getPubkeyRelays,
  userBlossomServers,
  getThunkError,
} from "@welshman/app"
import {preferencesStorageProvider} from "@lib/storage"
import {compressFile} from "@src/lib/html"
import type {SettingsValues, Alert} from "@app/core/state"
import {
  SETTINGS,
  PROTECTED,
  userMembership,
  INDEXER_RELAYS,
  NOTIFIER_PUBKEY,
  NOTIFIER_RELAY,
  userRoomsByUrl,
  userSettingsValues,
  canDecrypt,
  ensureUnwrapped,
  userInboxRelays,
} from "@app/core/state"
import type {
  CommentEvent,
  IssueEvent,
  RepoAnnouncementEvent,
  StatusEvent,
} from "@nostr-git/shared-types"

// Utils

export const getPubkeyHints = (pubkey: string) => {
  const relays = getPubkeyRelays(pubkey, RelayMode.Write)
  const hints = relays.length ? relays : INDEXER_RELAYS

  return hints
}

export const getPubkeyPetname = (pubkey: string) => {
  const profile = profilesByPubkey.get().get(pubkey)
  const display = displayProfile(profile)

  return display
}

export const prependParent = (parent: TrustedEvent | undefined, {content, tags}: EventContent) => {
  if (parent) {
    const nevent = nip19.neventEncode({
      id: parent.id,
      kind: parent.kind,
      author: parent.pubkey,
      relays: Router.get().Event(parent).limit(3).getUrls(),
    })

    tags = [...tags, tagEventForQuote(parent)]
    content = toNostrURI(nevent) + "\n\n" + content
  }

  return {content, tags}
}

// Log out

export const logout = async () => {
  const $pubkey = pubkey.get()

  if ($pubkey) {
    dropSession($pubkey)
  }

  await clearStorage()

  localStorage.clear()
  await preferencesStorageProvider.clear()
}

// Synchronization

export const broadcastUserData = async (relays: string[]) => {
  const authors = [pubkey.get()!]
  const kinds = [RELAYS, INBOX_RELAYS, FOLLOWS, PROFILE]
  const events = repository.query([{kinds, authors}])

  for (const event of events) {
    if (isSignedEvent(event)) {
      await publishThunk({event, relays}).result
    }
  }
}

// List updates

export const addSpaceMembership = async (url: string) => {
  const list = get(userMembership) || makeList({kind: ROOMS})
  const event = await addToListPublicly(list, ["r", url]).reconcile(nip44EncryptToSelf)
  const relays = uniq([...Router.get().FromUser().getUrls(), ...getRelayTagValues(event.tags)])

  return publishThunk({event, relays})
}

export const removeSpaceMembership = async (url: string) => {
  const list = get(userMembership) || makeList({kind: ROOMS})
  const pred = (t: string[]) => t[t[0] === "r" ? 1 : 2] === url
  const event = await removeFromListByPredicate(list, pred).reconcile(nip44EncryptToSelf)
  const relays = uniq([url, ...Router.get().FromUser().getUrls(), ...getRelayTagValues(event.tags)])

  return publishThunk({event, relays})
}

export const addRoomMembership = async (url: string, room: string) => {
  const list = get(userMembership) || makeList({kind: ROOMS})
  const newTags = [
    ["r", url],
    ["group", room, url],
  ]
  const event = await addToListPublicly(list, ...newTags).reconcile(nip44EncryptToSelf)
  const relays = uniq([...Router.get().FromUser().getUrls(), ...getRelayTagValues(event.tags)])

  return publishThunk({event, relays})
}

export const removeRoomMembership = async (url: string, room: string) => {
  const list = get(userMembership) || makeList({kind: ROOMS})
  const pred = (t: string[]) => equals(["group", room, url], t.slice(0, 3))
  const event = await removeFromListByPredicate(list, pred).reconcile(nip44EncryptToSelf)
  const relays = uniq([url, ...Router.get().FromUser().getUrls(), ...getRelayTagValues(event.tags)])

  return publishThunk({event, relays})
}

export const setRelayPolicy = (url: string, read: boolean, write: boolean) => {
  const list = get(userRelaySelections) || makeList({kind: RELAYS})
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
    relays: [
      url,
      ...INDEXER_RELAYS,
      ...Router.get().FromUser().getUrls(),
      ...userRoomsByUrl.get().keys(),
    ],
  })
}

export const setInboxRelayPolicy = (url: string, enabled: boolean) => {
  const list = get(userInboxRelaySelections) || makeList({kind: INBOX_RELAYS})

  // Only update inbox policies if they already exist or we're adding them
  if (enabled || getRelaysFromList(list).includes(url)) {
    const tags = getRelayTags(getListTags(list)).filter(t => normalizeRelayUrl(t[1]) !== url)

    if (enabled) {
      tags.push(["relay", url])
    }

    return publishThunk({
      event: makeEvent(list.kind, {tags}),
      relays: [
        ...INDEXER_RELAYS,
        ...Router.get().FromUser().getUrls(),
        ...userRoomsByUrl.get().keys(),
      ],
    })
  }
}

// Relay access

export const attemptAuth = (url: string) =>
  Pool.get()
    .get(url)
    .auth.attemptAuth(e => signer.get()?.sign(e))

export const checkRelayAccess = async (url: string, claim = "") => {
  const socket = Pool.get().get(url)

  await attemptAuth(url)

  const thunk = publishThunk({
    event: makeEvent(AUTH_JOIN, {tags: [["claim", claim]]}),
    relays: [url],
  })
  await thunk.result
  const error = await getThunkError(thunk)

  if (error) {
    const message =
      socket.auth.details?.replace(/^\w+: /, "") ||
      error?.replace(/^\w+: /, "") ||
      "join request rejected"

    // If it's a strict NIP 29 relay don't worry about requesting access
    // TODO: remove this if relay29 ever gets less strict
    if (message === "missing group (`h`) tag") return

    // Ignore messages about the relay ignoring ours
    if (error?.startsWith("mute: ")) return

    // Ignore rejected empty claims
    if (!claim && error?.includes("invite code")) {
      return `failed to request access to relay`
    }

    return message
  }
}

export const checkRelayProfile = async (url: string) => {
  const relay = await loadRelay(url)

  if (!relay?.profile) {
    return "Sorry, we weren't able to find that relay."
  }
}

export const checkRelayConnection = async (url: string) => {
  const socket = Pool.get().get(url)

  socket.attemptToOpen()

  await poll({
    signal: AbortSignal.timeout(3000),
    condition: () => socket.status === SocketStatus.Open,
  })

  if (socket.status !== SocketStatus.Open) {
    return `Failed to connect`
  }
}

export const checkRelayAuth = async (url: string) => {
  const socket = Pool.get().get(url)
  const okStatuses = [AuthStatus.None, AuthStatus.Ok]

  await attemptAuth(url)

  // Only raise an error if it's not a timeout.
  // If it is, odds are the problem is with our signer, not the relay
  if (!okStatuses.includes(socket.auth.status)) {
    if (socket.auth.details) {
      return `Failed to authenticate (${socket.auth.details})`
    } else {
      return `Failed to authenticate (${last(socket.auth.status.split(":"))})`
    }
  }
}

export const attemptRelayAccess = async (url: string, claim = "") => {
  const checks = [
    () => checkRelayConnection(url),
    () => checkRelayAccess(url, claim),
    () => checkRelayAuth(url),
  ]

  for (const check of checks) {
    const error = await check()

    if (error) {
      return error
    }
  }
}

// Deletions

export const makeDelete = ({event, tags = []}: {event: TrustedEvent; tags?: string[][]}) => {
  const thisTags = [["k", String(event.kind)], ...tagEvent(event), ...tags]
  const groupTag = getTag("h", event.tags)

  if (groupTag) {
    thisTags.push(PROTECTED, groupTag)
  }

  return makeEvent(DELETE, {tags: thisTags})
}

export const publishDelete = ({
  relays,
  event,
  tags = [],
}: {
  relays: string[]
  event: TrustedEvent
  tags?: string[][]
}) => publishThunk({event: makeDelete({event, tags}), relays})

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
  event: TrustedEvent
  content: string
  tags?: string[][]
}

export const makeReaction = ({content, event, tags: paramTags = []}: ReactionParams) => {
  const tags = [...paramTags, ...tagEventForReaction(event)]

  const groupTag = getTag("h", event.tags)

  if (groupTag) {
    tags.push(PROTECTED)
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
  makeEvent(COMMENT, {content, tags: [...tags, ...tagEventForComment(event)]})

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

export const postComment = (comment: CommentEvent, relays: string[]) => {
  return publishThunk({
    relays: relays ?? [...INDEXER_RELAYS, ...Router.get().FromUser().getUrls()],
    event: comment,
  })
}

export const postIssue = (issue: IssueEvent, relays: string[]) => {
  const merged = Array.from(
    new Set([...(relays || []), ...Router.get().FromUser().getUrls(), ...INDEXER_RELAYS]),
  )
  return publishThunk({
    event: issue,
    relays: merged,
  })
}

export const postStatus = (status: StatusEvent, relays: string[]) => {
  const merged = Array.from(
    new Set([...(relays || []), ...Router.get().FromUser().getUrls(), ...INDEXER_RELAYS]),
  )
  return publishThunk({
    relays: merged,
    event: status,
  })
}

export const postRepoAnnouncement = (repo: RepoAnnouncementEvent, relays: string[]) => {
  return publishThunk({
    relays: relays ?? [...INDEXER_RELAYS, ...Router.get().FromUser().getUrls()],
    event: repo,
  })
}

// Gift Wraps

export const enableGiftWraps = () => {
  canDecrypt.set(true)

  for (const event of repository.query([{kinds: [WRAP]}])) {
    ensureUnwrapped(event)
  }
}

// File upload

export const getBlossomServer = () => {
  const userUrls = getTagValues("server", getListTags(userBlossomServers.get()))

  for (const url of userUrls) {
    return url.replace(/^ws/, "http")
  }

  return "https://cdn.satellite.earth"
}

export type UploadFileOptions = {
  encrypt?: boolean
}

export type UploadFileResult = {
  error?: string
  result?: UploadTask
}

export const uploadFile = async (file: File, options: UploadFileOptions = {}) => {
  const {name, type} = file

  if (!type.match("image/(webp|gif)")) {
    file = await compressFile(file)
  }

  const tags: string[][] = []

  if (options.encrypt) {
    const {ciphertext, key, nonce, algorithm} = await encryptFile(file)

    tags.push(
      ["decryption-key", key],
      ["decryption-nonce", nonce],
      ["encryption-algorithm", algorithm],
    )

    file = new File([new Blob([ciphertext])], name, {
      type: "application/octet-stream",
    })
  }

  const server = getBlossomServer()
  const hashes = [await sha256(await file.arrayBuffer())]
  const $signer = signer.get() || Nip01Signer.ephemeral()
  const authTemplate = makeBlossomAuthEvent({action: "upload", server, hashes})
  const authEvent = await $signer.sign(authTemplate)

  try {
    const res = await uploadBlob(server, file, {authEvent})
    const text = await res.text()

    let {uploaded, url, ...task} = parseJson(text) || {}

    if (!uploaded) {
      return {error: text}
    }

    // Always append file extension if missing
    if (new URL(url).pathname.split(".").length === 1) {
      url += "." + type.split("/")[1]
    }

    const result = {...task, tags, url}

    return {result}
  } catch (e: any) {
    console.error(e)
    return {error: e.toString()}
  }
}
