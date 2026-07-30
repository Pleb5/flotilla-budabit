import {derived, get} from "svelte/store"
import {Router} from "@welshman/router"
import {deriveItemsByKey, getter, makeLoadItem} from "@welshman/store"
import {load, publishOne, PublishStatus, type PublishResult} from "@welshman/net"
import {
  NAMED_PEOPLE,
  addToListPrivately,
  asDecryptedEvent,
  deduplicateEvents,
  getAddress,
  isReplaceable,
  makeList,
  prep,
  readList,
  removeFromList,
  sortEventsDesc,
  type EventTemplate,
  type List,
  type PublishedList,
  type SignedEvent,
  type TrustedEvent,
} from "@welshman/util"
import {
  ensurePlaintext,
  makeOutboxLoader,
  makeUserData,
  makeUserLoader,
  nip44EncryptToSelf,
  pubkey,
  repository,
  setPlaintext,
  signer,
} from "@welshman/app"
import {
  RENOUNCED_COMMUNITIES_DTAG,
  isRenouncedCommunitiesListEvent,
  normalizeRelays,
  normalizePubkey,
} from "@app/core/community"
import {INDEXER_RELAYS} from "@app/core/state"

export const RENUNCIATION_PUBLISH_TIMEOUT = 6_000
export const RENUNCIATION_SIGNER_TIMEOUT = 20_000
export const RENUNCIATION_READBACK_TIMEOUT = 3_000

export type RenouncedCommunitiesListItem = {
  event: TrustedEvent
  list: PublishedList
  communityPubkeys: string[]
}

export type RenunciationPublishResult = {
  event: TrustedEvent
  relay: string
  result: PublishResult
}

type RenunciationPublishOptions = {
  signal?: AbortSignal
  onStatus?: (message: string) => void
}

const makeRenouncedPublicTags = (tags: string[][] = []) => [
  ["d", RENOUNCED_COMMUNITIES_DTAG],
  ...tags.filter(tag => tag[0] !== "d"),
]

export const makeRenouncedCommunitiesList = (list?: Partial<List>): List =>
  makeList({
    kind: NAMED_PEOPLE,
    event: list?.event,
    publicTags: makeRenouncedPublicTags(list?.publicTags),
    privateTags: list?.privateTags || [],
  })

export const getRenouncedCommunityPubkeysFromList = (list: List | undefined) =>
  Array.from(
    new Set(
      (list?.privateTags || [])
        .filter(tag => tag[0] === "p")
        .map(tag => normalizePubkey(tag[1] || ""))
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b))

const getUserOutboxRelays = () => {
  try {
    return Router.get().FromUser().getUrls() || []
  } catch {
    return []
  }
}

export const getRenunciationPublishRelays = (outboxRelays = getUserOutboxRelays()) => {
  const normalizedOutboxRelays = normalizeRelays(outboxRelays)

  return normalizedOutboxRelays.length > 0
    ? normalizedOutboxRelays
    : normalizeRelays(INDEXER_RELAYS)
}

const getRequiredRenunciationPublishRelays = () => {
  const relays = getRenunciationPublishRelays()

  if (relays.length === 0) {
    throw new Error("No place to save this update. Check your settings and try again.")
  }

  return relays
}

const makeAbortError = () => Object.assign(new Error("Update cancelled."), {name: "AbortError"})

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw makeAbortError()
}

const withTimeout = async <T>(
  promise: Promise<T>,
  timeout: number,
  message: string,
  signal?: AbortSignal,
) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined

  throwIfAborted(signal)

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeout)
      }),
      new Promise<never>((_, reject) => {
        if (!signal) return

        abort = () => reject(makeAbortError())
        signal.addEventListener("abort", abort, {once: true})
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    if (signal && abort) signal.removeEventListener("abort", abort)
  }
}

const encryptRenouncedCommunitiesList = (payload: string, signal?: AbortSignal) =>
  withTimeout(
    nip44EncryptToSelf(payload),
    RENUNCIATION_SIGNER_TIMEOUT,
    "Approval is taking too long. Please try again.",
    signal,
  )

const signRenouncedCommunitiesEvent = async (
  event: EventTemplate,
  options: RenunciationPublishOptions = {},
): Promise<SignedEvent> => {
  const activePubkey = normalizePubkey(pubkey.get() || "")
  const activeSigner = signer.get()

  throwIfAborted(options.signal)
  if (!activePubkey) throw new Error("Log in to update your groups.")
  if (!activeSigner) throw new Error("Couldn't get approval to save this update.")

  options.onStatus?.("Waiting for approval...")

  return withTimeout(
    activeSigner.sign(prep(event, activePubkey)),
    RENUNCIATION_SIGNER_TIMEOUT,
    "Approval is taking too long. Please try again.",
    options.signal,
  )
}

const findPublishedRenunciationEvent = async (
  event: SignedEvent,
  relay: string,
  signal?: AbortSignal,
) => {
  const idMatches = await withTimeout(
    load({relays: [relay], filters: [{ids: [event.id], limit: 1}], signal}),
    RENUNCIATION_READBACK_TIMEOUT,
    "Confirming the save is taking too long. Please try again.",
    signal,
  )
  const exactMatch = idMatches.find(match => match.id === event.id)
  if (!exactMatch) return undefined
  if (!isReplaceable(event)) return exactMatch

  const address = getAddress(event)
  const currentMatches = await withTimeout(
    load({
      relays: [relay],
      signal,
      filters: [
        {
          kinds: [event.kind],
          authors: [event.pubkey],
          "#d": [RENOUNCED_COMMUNITIES_DTAG],
          limit: 10,
        },
      ],
    }),
    RENUNCIATION_READBACK_TIMEOUT,
    "Confirming the save is taking too long. Please try again.",
    signal,
  )
  const current = deduplicateEvents(
    currentMatches.filter(
      candidate => isReplaceable(candidate) && getAddress(candidate) === address,
    ),
  )[0]

  return current?.id === event.id ? exactMatch : undefined
}

const publishAndVerifyRenouncedCommunitiesEvent = async (
  event: SignedEvent,
  relays: string[],
  privateTagsPlaintext: string,
  options: RenunciationPublishOptions = {},
): Promise<RenunciationPublishResult> => {
  const controller = new AbortController()
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal
  const failures: string[] = []
  let pending = relays.length
  let settled = false

  options.onStatus?.("Saving your choice...")

  return new Promise((resolve, reject) => {
    const cleanup = () => options.signal?.removeEventListener("abort", abort)
    const finishResolve = (result: RenunciationPublishResult) => {
      if (settled) return

      settled = true
      controller.abort()
      cleanup()
      resolve(result)
    }
    const finishReject = (error: Error) => {
      if (settled) return

      settled = true
      controller.abort()
      cleanup()
      reject(error)
    }
    const abort = () => finishReject(makeAbortError())
    const rejectIfDone = () => {
      if (!settled && pending === 0) {
        finishReject(new Error(failures[0] || "Couldn't confirm this was saved. Please try again."))
      }
    }

    if (options.signal?.aborted) {
      finishReject(makeAbortError())
      return
    }

    options.signal?.addEventListener("abort", abort, {once: true})

    for (const relay of relays) {
      publishOne({event, relay, timeout: RENUNCIATION_PUBLISH_TIMEOUT, signal})
        .then(async result => {
          if (settled) return

          if (result.status !== PublishStatus.Success) {
            failures.push("Couldn't save this update. Please try again.")
            return
          }

          options.onStatus?.("Confirming your choice...")

          const verifiedEvent = await findPublishedRenunciationEvent(event, relay, signal)
          if (!verifiedEvent) {
            failures.push("Couldn't confirm this was saved. Please try again.")
            return
          }

          if (!settled) {
            setPlaintext(verifiedEvent, privateTagsPlaintext)
            repository.publish(verifiedEvent)
            finishResolve({event: verifiedEvent, relay, result})
          }
        })
        .catch(error => {
          if (!settled) {
            failures.push(error instanceof Error ? error.message : "Couldn't save this update.")
          }
        })
        .finally(() => {
          pending -= 1
          rejectIfDone()
        })
    }
  })
}

export const addRenouncedCommunityToList = (list: List | undefined, communityPubkey: string) => {
  const normalizedCommunity = normalizePubkey(communityPubkey)
  if (!normalizedCommunity) throw new Error("This group looks invalid.")

  return addToListPrivately(makeRenouncedCommunitiesList(list), ["p", normalizedCommunity])
}

export const removeRenouncedCommunityFromList = (
  list: List | undefined,
  communityPubkey: string,
) => {
  const normalizedCommunity = normalizePubkey(communityPubkey)
  if (!normalizedCommunity) throw new Error("This group looks invalid.")

  return removeFromList(makeRenouncedCommunitiesList(list), normalizedCommunity)
}

const readRenouncedCommunitiesList = async (event: TrustedEvent) => {
  let plaintext: string | undefined

  try {
    plaintext = await ensurePlaintext(event)
  } catch {
    // Missing decryption support should not make the public shell unusable.
  }

  return makeRenouncedCommunitiesList(
    readList(asDecryptedEvent(event, plaintext ? {content: plaintext} : {})),
  ) as PublishedList
}

const readRenouncedCommunitiesListForUpdate = async (
  event: TrustedEvent,
  options: RenunciationPublishOptions = {},
) => {
  const plaintext = await withTimeout(
    ensurePlaintext(event),
    RENUNCIATION_SIGNER_TIMEOUT,
    "Opening your saved choices is taking too long. Please try again.",
    options.signal,
  )

  if (event.content && !plaintext) {
    throw new Error("Couldn't open your saved choices.")
  }

  return makeRenouncedCommunitiesList(
    readList(asDecryptedEvent(event, plaintext ? {content: plaintext} : {})),
  ) as PublishedList
}

const loadRenouncedCommunitiesListForUpdate = async (
  relays: string[],
  options: RenunciationPublishOptions = {},
) => {
  const activePubkey = normalizePubkey(pubkey.get() || "")
  if (!activePubkey) throw new Error("Log in to update your groups.")

  options.onStatus?.("Checking your current choice...")
  const filters = [
    {kinds: [NAMED_PEOPLE], authors: [activePubkey], "#d": [RENOUNCED_COMMUNITIES_DTAG]},
  ]
  const loadedEvents = await load({relays, filters, signal: options.signal})

  throwIfAborted(options.signal)

  const current = get(userRenouncedCommunitiesList)
  const latestEvent = sortEventsDesc(
    deduplicateEvents([
      ...loadedEvents,
      ...repository.query(filters),
      ...(current?.event ? [current.event] : []),
    ]).filter(isRenouncedCommunitiesListEvent),
  )[0]

  if (!latestEvent) return makeRenouncedCommunitiesList()

  options.onStatus?.("Opening your saved choices...")

  return readRenouncedCommunitiesListForUpdate(latestEvent, options)
}

export const renouncedCommunitiesListsByPubkey = deriveItemsByKey<RenouncedCommunitiesListItem>({
  repository,
  filters: [{kinds: [NAMED_PEOPLE], "#d": [RENOUNCED_COMMUNITIES_DTAG]}],
  getKey: item => item.event.pubkey,
  eventToItem: async event => {
    const list = await readRenouncedCommunitiesList(event)

    return {
      event,
      list,
      communityPubkeys: getRenouncedCommunityPubkeysFromList(list),
    }
  },
})

export const getRenouncedCommunitiesListsByPubkey = getter(renouncedCommunitiesListsByPubkey)

export const getRenouncedCommunitiesList = (pubkey: string) =>
  getRenouncedCommunitiesListsByPubkey().get(pubkey)

export const loadRenouncedCommunitiesList = makeLoadItem(
  makeOutboxLoader(NAMED_PEOPLE, {"#d": [RENOUNCED_COMMUNITIES_DTAG]}),
  getRenouncedCommunitiesList,
)

export const userRenouncedCommunitiesList = makeUserData(
  renouncedCommunitiesListsByPubkey,
  loadRenouncedCommunitiesList,
)

export const loadUserRenouncedCommunitiesList = makeUserLoader(loadRenouncedCommunitiesList)

export const userRenouncedCommunityPubkeys = derived(
  userRenouncedCommunitiesList,
  $list => $list?.communityPubkeys || [],
)

const assertCanRenounceCommunity = (communityPubkey: string) => {
  const normalizedCommunity = normalizePubkey(communityPubkey)
  const activePubkey = normalizePubkey(pubkey.get() || "")

  if (!activePubkey) throw new Error("Log in to update your groups.")
  if (!normalizedCommunity) throw new Error("This group looks invalid.")
  if (normalizedCommunity === activePubkey) {
    throw new Error("Community owner keys cannot leave their own community.")
  }

  return normalizedCommunity
}

export const renounceCommunity = async (
  communityPubkey: string,
  options: RenunciationPublishOptions = {},
) => {
  const normalizedCommunity = assertCanRenounceCommunity(communityPubkey)
  const relays = getRequiredRenunciationPublishRelays()

  const list = await loadRenouncedCommunitiesListForUpdate(relays, options)
  if (getRenouncedCommunityPubkeysFromList(list).includes(normalizedCommunity)) return undefined

  let privateTagsPlaintext = ""
  options.onStatus?.("Saving your choice...")
  const eventTemplate = await addRenouncedCommunityToList(list, normalizedCommunity).reconcile(
    async payload => {
      privateTagsPlaintext = payload
      return encryptRenouncedCommunitiesList(payload, options.signal)
    },
  )
  const event = await signRenouncedCommunitiesEvent(eventTemplate, options)

  return publishAndVerifyRenouncedCommunitiesEvent(event, relays, privateTagsPlaintext, options)
}

export const rejoinCommunity = async (
  communityPubkey: string,
  options: RenunciationPublishOptions = {},
) => {
  const normalizedCommunity = assertCanRenounceCommunity(communityPubkey)
  const relays = getRequiredRenunciationPublishRelays()

  const list = await loadRenouncedCommunitiesListForUpdate(relays, options)
  if (!getRenouncedCommunityPubkeysFromList(list).includes(normalizedCommunity)) return undefined

  let privateTagsPlaintext = ""
  options.onStatus?.("Saving your choice...")
  const eventTemplate = await removeRenouncedCommunityFromList(list, normalizedCommunity).reconcile(
    async payload => {
      privateTagsPlaintext = payload
      return encryptRenouncedCommunitiesList(payload, options.signal)
    },
  )
  const event = await signRenouncedCommunitiesEvent(eventTemplate, options)

  return publishAndVerifyRenouncedCommunitiesEvent(event, relays, privateTagsPlaintext, options)
}

export {RENOUNCED_COMMUNITIES_DTAG, isRenouncedCommunitiesListEvent}
