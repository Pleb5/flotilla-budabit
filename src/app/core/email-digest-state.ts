import {derived, get, writable, type Readable} from "svelte/store"
import {parseJson} from "@welshman/lib"
import {AuthStatus, Pool, request} from "@welshman/net"
import {Router} from "@welshman/router"
import {deriveItemsByKey, getter, makeLoadItem} from "@welshman/store"
import {DELETE, makeEvent, type SignedEvent, type TrustedEvent} from "@welshman/util"
import {makeOutboxLoader, makeUserData, pubkey, repository, signer} from "@welshman/app"
import {GIT_RELAYS, repoAnnouncements} from "@app/core/git-state"
import {getUserDataPublishRelays} from "@app/core/community-relays"
import {publishRequiredCommunityEvent} from "@app/core/community-publish"
import {activeCommunityDefinition, activeUserCommunityRefs} from "@app/core/community-state"
import {APP_BASE_URL} from "@app/core/state"
import {
  getPersistedEmailDigestAuthRelay,
  setEmailDigestAuthRelay,
  withTemporaryEmailDigestAuthRelay,
} from "@app/core/email-digest-auth"
import {
  EMAIL_DIGEST_DTAG,
  EMAIL_DIGEST_SETTINGS_DTAG,
  EMAIL_DIGEST_SETTINGS_KIND,
  EMAIL_DIGEST_STATUS_KIND,
  EMAIL_DIGEST_SUBSCRIPTION_KIND,
  assertEmailDigestProviderQueryComplete,
  buildEmailDigestPayload,
  buildEmailDigestRepositories,
  decryptEmailDigestSettingsEvent,
  defaultEmailDigestSettings,
  discoverEmailDigestProviders,
  getEmailDigestSubscriptionTags,
  getNextEmailDigestCreatedAt,
  normalizeEmailDigestSettings,
  parseEmailDigestStatus,
  runBestEffortEmailDigestSync,
  runEmailDigestDisableSequence,
  runEmailDigestSaveSequence,
  selectEmailDigestStatusEvent,
  selectEmailDigestSubscriptionEvent,
  shouldAutoSyncEmailDigest,
  shouldAutoSyncEmailDigestProviderState,
  type EmailDigestPayload,
  type EmailDigestProvider,
  type EmailDigestSettings,
  type EmailDigestStatus,
} from "@app/core/email-digest"
import {
  getCommunityEmailDigestServiceDescriptorKey,
  type CommunityEmailDigestService,
} from "@app/core/community"
import type {RepoWatchState} from "@app/core/repo-watch"

export type EmailDigestSettingsItem = {
  event: TrustedEvent
  values: EmailDigestSettings
}

export type EmailDigestProviderState = {
  subscription?: TrustedEvent
  subscriptionPayload?: EmailDigestPayload
  statusEvent?: TrustedEvent
  status?: EmailDigestStatus
  statusError?: string
}

export type EmailDigestSettingsHydration = {
  pubkey: string
  status: "idle" | "loading" | "ready" | "error"
  item?: EmailDigestSettingsItem
  error?: string
}

export const emailDigestProviders: Readable<EmailDigestProvider[]> = derived(
  [activeCommunityDefinition, activeUserCommunityRefs],
  ([$activeCommunityDefinition, $activeUserCommunityRefs]) =>
    discoverEmailDigestProviders({
      activeCommunityDefinition: $activeCommunityDefinition,
      communityRefs: $activeUserCommunityRefs,
    }),
  [] as EmailDigestProvider[],
)

export const emailDigestSettingsByPubkey = deriveItemsByKey<EmailDigestSettingsItem>({
  repository,
  getKey: item => item.event.pubkey,
  filters: [{kinds: [EMAIL_DIGEST_SETTINGS_KIND], "#d": [EMAIL_DIGEST_SETTINGS_DTAG]}],
  eventToItem: async event => {
    const activePubkey = pubkey.get()
    const currentSigner = signer.get()
    if (!activePubkey || event.pubkey !== activePubkey) return undefined
    if (!currentSigner) {
      throw new Error("Sign in to decrypt email digest settings.")
    }
    const values = await decryptEmailDigestSettingsEvent({
      event,
      activePubkey,
      decrypt: (recipient, content) => currentSigner.nip44.decrypt(recipient, content),
    })
    return {event, values}
  },
})

export const getEmailDigestSettingsByPubkey = getter(emailDigestSettingsByPubkey)
export const getEmailDigestSettings = (userPubkey: string) =>
  getEmailDigestSettingsByPubkey().get(userPubkey)
export const loadEmailDigestSettings = makeLoadItem(
  makeOutboxLoader(EMAIL_DIGEST_SETTINGS_KIND, {"#d": [EMAIL_DIGEST_SETTINGS_DTAG]}),
  getEmailDigestSettings,
)
export const emailDigestSettingsHydration = writable<EmailDigestSettingsHydration>({
  pubkey: "",
  status: "idle",
})
const repositoryUserEmailDigestSettings = makeUserData(emailDigestSettingsByPubkey)
export const userEmailDigestSettings = derived(
  [repositoryUserEmailDigestSettings, emailDigestSettingsHydration, pubkey],
  ([$repositorySettings, $hydration, $pubkey]) =>
    ($hydration.pubkey === $pubkey ? $hydration.item : undefined) || $repositorySettings,
)
export const userEmailDigestSettingsValues = derived(
  userEmailDigestSettings,
  $settings => $settings?.values || defaultEmailDigestSettings,
)
let pendingEmailDigestSettingsHydration:
  | {pubkey: string; promise: Promise<EmailDigestSettingsItem | undefined>}
  | undefined

export const hydrateEmailDigestSettings = async (userPubkey = pubkey.get()) => {
  if (!userPubkey) throw new Error("Sign in to load email digest settings.")
  const current = get(emailDigestSettingsHydration)
  if (current.pubkey === userPubkey && current.status === "ready") {
    return current.item || getEmailDigestSettings(userPubkey)
  }
  if (pendingEmailDigestSettingsHydration?.pubkey === userPubkey) {
    return pendingEmailDigestSettingsHydration.promise
  }

  emailDigestSettingsHydration.set({pubkey: userPubkey, status: "loading"})
  const promise: Promise<EmailDigestSettingsItem | undefined> = loadEmailDigestSettings(userPubkey)
    .then(async loadedItem => {
      let item = loadedItem
      if (!item) {
        const event = repository
          .query([
            {
              kinds: [EMAIL_DIGEST_SETTINGS_KIND],
              authors: [userPubkey],
              "#d": [EMAIL_DIGEST_SETTINGS_DTAG],
            },
          ])
          .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0]
        if (event) {
          const currentSigner = signer.get()
          if (!currentSigner) throw new Error("Sign in to decrypt email digest settings.")
          item = {
            event,
            values: await decryptEmailDigestSettingsEvent({
              event,
              activePubkey: userPubkey,
              decrypt: (recipient, content) => currentSigner.nip44.decrypt(recipient, content),
            }),
          }
        }
      }
      if (get(emailDigestSettingsHydration).pubkey === userPubkey) {
        emailDigestSettingsHydration.set({
          pubkey: userPubkey,
          status: "ready",
          ...(item ? {item} : {}),
        })
      }
      return item
    })
    .catch(error => {
      const message = error instanceof Error ? error.message : String(error)
      if (get(emailDigestSettingsHydration).pubkey === userPubkey) {
        emailDigestSettingsHydration.set({pubkey: userPubkey, status: "error", error: message})
      }
      throw error
    })
    .finally(() => {
      if (pendingEmailDigestSettingsHydration?.promise === promise) {
        pendingEmailDigestSettingsHydration = undefined
      }
    })
  pendingEmailDigestSettingsHydration = {pubkey: userPubkey, promise}
  return promise
}

userEmailDigestSettingsValues.subscribe(settings => {
  setEmailDigestAuthRelay(getPersistedEmailDigestAuthRelay(settings))
})

const requireSession = () => {
  const userPubkey = pubkey.get()
  const currentSigner = signer.get()
  if (!userPubkey || !currentSigner) throw new Error("Sign in to manage email digests.")
  return {userPubkey, currentSigner}
}

const requireEmailDigestSettingsHydrated = (userPubkey: string) => {
  const hydration = get(emailDigestSettingsHydration)
  if (hydration.pubkey !== userPubkey || hydration.status !== "ready") {
    throw new Error("Wait for encrypted email digest settings to finish loading.")
  }
}

const authenticateEmailDigestRelay = async (provider: CommunityEmailDigestService) => {
  const {currentSigner} = requireSession()
  const socket = Pool.get().get(provider.requestRelay)
  await socket.auth.retryAuth(event => currentSigner.sign(event))
  if (socket.auth.status !== AuthStatus.Ok) {
    throw new Error("Email digest provider authentication did not complete.")
  }
  return socket
}

const publishAcceptedEvent = async (event: SignedEvent, relay: string, label: string) => {
  await publishRequiredCommunityEvent({
    event,
    relays: [relay],
    requiredRelay: relay,
    timeout: 12_000,
  }).catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${label} was not accepted by the provider relay: ${message}`)
  })
}

const getEmailDigestManageUrl = () => {
  const browserOrigin =
    typeof window !== "undefined" && window.location?.origin ? window.location.origin : ""
  const base = APP_BASE_URL || browserOrigin
  if (!base) throw new Error("Budabit needs a public HTTPS app URL for digest management.")
  return new URL("/settings/notifications", base).toString()
}

const getEmailDigestLocale = () =>
  typeof navigator !== "undefined" ? navigator.language?.trim() || undefined : undefined

export const publishEmailDigestSettings = async (settings: EmailDigestSettings) => {
  const {userPubkey, currentSigner} = requireSession()
  const normalized = normalizeEmailDigestSettings(settings)
  const content = await currentSigner.nip44.encrypt(userPubkey, JSON.stringify(normalized))
  const event = await currentSigner.sign(
    makeEvent(EMAIL_DIGEST_SETTINGS_KIND, {
      content,
      tags: [["d", EMAIL_DIGEST_SETTINGS_DTAG]],
      created_at: getNextEmailDigestCreatedAt(get(userEmailDigestSettings)?.event.created_at),
    }),
  )
  const relays = getUserDataPublishRelays(Router.get().FromUser().getUrls())
  if (relays.length === 0) throw new Error("No account data relay is available.")

  const {acceptedRelays} = await publishRequiredCommunityEvent({
    event,
    relays,
  })
  if (acceptedRelays.length === 0)
    throw new Error("No account data relay accepted digest settings.")
  repository.publish(event)
  emailDigestSettingsHydration.update(hydration =>
    hydration.pubkey === userPubkey
      ? {pubkey: userPubkey, status: "ready", item: {event, values: normalized}}
      : hydration,
  )
  setEmailDigestAuthRelay(getPersistedEmailDigestAuthRelay(normalized))
  return normalized
}

export const queryEmailDigestProviderState = async (
  provider: CommunityEmailDigestService,
): Promise<EmailDigestProviderState> => {
  const {userPubkey, currentSigner} = requireSession()
  const restoreRelay = getPersistedEmailDigestAuthRelay(get(userEmailDigestSettingsValues))

  return withTemporaryEmailDigestAuthRelay({
    relay: provider.requestRelay,
    restoreRelay,
    run: async () => {
      await authenticateEmailDigestRelay(provider)
      const completion = {
        authenticated: true,
        eose: false,
        timedOut: false,
        disconnected: false,
        closedReason: undefined as string | undefined,
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => {
        completion.timedOut = true
        controller.abort()
      }, 10_000)
      let events: TrustedEvent[]
      try {
        events = (await request({
          relays: [provider.requestRelay],
          filters: [
            {
              kinds: [EMAIL_DIGEST_SUBSCRIPTION_KIND],
              authors: [userPubkey],
              "#d": [EMAIL_DIGEST_DTAG],
              "#p": [provider.servicePubkey],
              limit: 10,
            },
            {
              kinds: [EMAIL_DIGEST_STATUS_KIND],
              authors: [provider.servicePubkey],
              "#d": [EMAIL_DIGEST_DTAG],
              "#p": [userPubkey],
              limit: 10,
            },
          ],
          autoClose: true,
          signal: controller.signal,
          onEose: () => {
            completion.eose = true
          },
          onClosed: reason => {
            completion.closedReason = reason || "closed without a reason"
          },
          onDisconnect: () => {
            completion.disconnected = true
          },
        })) as TrustedEvent[]
      } finally {
        clearTimeout(timeout)
      }
      assertEmailDigestProviderQueryComplete(completion)

      const subscription = selectEmailDigestSubscriptionEvent(events, userPubkey, provider)
      const statusEvent = selectEmailDigestStatusEvent(events, userPubkey, provider)
      let subscriptionPayload: EmailDigestPayload | undefined
      let status: EmailDigestStatus | undefined
      let statusError = ""

      if (subscription) {
        try {
          subscriptionPayload = parseJson(
            await currentSigner.nip44.decrypt(provider.servicePubkey, subscription.content),
          ) as EmailDigestPayload
        } catch {
          statusError = "The saved provider registration could not be decrypted."
        }
      }

      if (statusEvent) {
        try {
          const plaintext = await currentSigner.nip44.decrypt(
            provider.servicePubkey,
            statusEvent.content,
          )
          status = parseEmailDigestStatus(parseJson(plaintext))
          if (!status) statusError = "The provider returned an invalid status response."
        } catch {
          statusError = "The provider status could not be decrypted."
        }
      }

      return {
        ...(subscription ? {subscription} : {}),
        ...(subscriptionPayload ? {subscriptionPayload} : {}),
        ...(statusEvent ? {statusEvent} : {}),
        ...(status ? {status} : {}),
        ...(statusError ? {statusError} : {}),
      }
    },
  })
}

const buildCurrentEmailDigestPayload = ({
  settings,
  watchState,
  announcements,
}: {
  settings: EmailDigestSettings
  watchState: RepoWatchState
  announcements: TrustedEvent[]
}) => {
  if (!settings.provider) throw new Error("Choose an email digest provider.")
  const repositories = buildEmailDigestRepositories({
    watchState,
    announcements,
    fallbackRelays: GIT_RELAYS,
  })
  return buildEmailDigestPayload({
    email: settings.email,
    locale: getEmailDigestLocale(),
    manageUrl: getEmailDigestManageUrl(),
    intervalDays: settings.intervalDays,
    localTime: settings.localTime,
    timezone: settings.timezone,
    provider: settings.provider,
    repositories,
  })
}

const publishEmailDigestSubscription = async ({
  settings,
  watchState,
  announcements,
  currentState,
}: {
  settings: EmailDigestSettings
  watchState: RepoWatchState
  announcements: TrustedEvent[]
  currentState?: EmailDigestProviderState
}) => {
  const {userPubkey, currentSigner} = requireSession()
  const provider = settings.provider!
  const payload = buildCurrentEmailDigestPayload({settings, watchState, announcements})
  const providerState = currentState || (await queryEmailDigestProviderState(provider))
  const content = await currentSigner.nip44.encrypt(provider.servicePubkey, JSON.stringify(payload))
  const event = await currentSigner.sign(
    makeEvent(EMAIL_DIGEST_SUBSCRIPTION_KIND, {
      content,
      tags: getEmailDigestSubscriptionTags(provider.servicePubkey),
      created_at: getNextEmailDigestCreatedAt(providerState.subscription?.created_at),
    }),
  )

  await publishAcceptedEvent(event, provider.requestRelay, "Email digest registration")
  return queryEmailDigestProviderState(provider)
}

const deleteEmailDigestRegistration = async (settings: EmailDigestSettings) => {
  const {userPubkey, currentSigner} = requireSession()
  if (!settings.provider) throw new Error("No email digest provider is selected.")
  const provider = settings.provider
  const providerState = await queryEmailDigestProviderState(provider)

  await runEmailDigestDisableSequence({
    subscriptionCreatedAt: providerState.subscription?.created_at,
    publishDeletion: async createdAt => {
      const event = await currentSigner.sign(
        makeEvent(DELETE, {
          created_at: createdAt,
          tags: [
            ["a", `${EMAIL_DIGEST_SUBSCRIPTION_KIND}:${userPubkey}:${EMAIL_DIGEST_DTAG}`],
            ["p", provider.servicePubkey],
          ],
        }),
      )
      await publishAcceptedEvent(event, provider.requestRelay, "Email digest deletion")
    },
    persistDisabled: async () => undefined,
  })
}

export const disableEmailDigest = async (settings?: EmailDigestSettings) => {
  const {userPubkey} = requireSession()
  requireEmailDigestSettingsHydrated(userPubkey)
  const current = settings || get(userEmailDigestSettingsValues)
  await deleteEmailDigestRegistration(current)
  return publishEmailDigestSettings({...current, enabled: false})
}

export const saveAndEnableEmailDigest = async ({
  settings,
  watchState,
  announcements,
  providerSwitchConfirmed = false,
}: {
  settings: EmailDigestSettings
  watchState: RepoWatchState
  announcements?: TrustedEvent[]
  providerSwitchConfirmed?: boolean
}) => {
  const {userPubkey} = requireSession()
  requireEmailDigestSettingsHydrated(userPubkey)
  const next = normalizeEmailDigestSettings({...settings, enabled: true})
  if (!next.enabled || !next.provider) {
    throw new Error("Complete the provider, email, and cadence fields before enabling the digest.")
  }

  const current = get(userEmailDigestSettingsValues)
  const oldProviderKey = current.provider
    ? getCommunityEmailDigestServiceDescriptorKey(current.provider)
    : ""
  const nextProviderKey = getCommunityEmailDigestServiceDescriptorKey(next.provider)
  const switchingProvider = current.enabled && oldProviderKey !== nextProviderKey
  if (switchingProvider && !providerSwitchConfirmed) {
    throw new Error("Re-enter your delivery email to confirm the provider switch.")
  }

  const resolvedAnnouncements = announcements || (get(repoAnnouncements) as TrustedEvent[])
  buildCurrentEmailDigestPayload({
    settings: next,
    watchState,
    announcements: resolvedAnnouncements,
  })

  return runEmailDigestSaveSequence({
    switchingProvider,
    deleteOldProvider: () => deleteEmailDigestRegistration(current),
    persistNextSettings: () => publishEmailDigestSettings(next),
    publishNewRegistration: () => {
      setEmailDigestAuthRelay(next.provider!.requestRelay)
      return publishEmailDigestSubscription({
        settings: next,
        watchState,
        announcements: resolvedAnnouncements,
      })
    },
  })
}

export const resynchronizeEnabledEmailDigest = async (watchState: RepoWatchState) => {
  const {userPubkey} = requireSession()
  await hydrateEmailDigestSettings(userPubkey)
  const settings = get(userEmailDigestSettingsValues)
  const providers = get(emailDigestProviders)

  return runBestEffortEmailDigestSync({
    shouldSync: shouldAutoSyncEmailDigest(settings, providers),
    sync: async () => {
      const providerState = await queryEmailDigestProviderState(settings.provider!)
      if (!shouldAutoSyncEmailDigestProviderState(providerState.status)) return false
      await publishEmailDigestSubscription({
        settings,
        watchState,
        announcements: get(repoAnnouncements) as TrustedEvent[],
        currentState: providerState,
      })
      return true
    },
  })
}

export const makeEmailDigestStatusFilter = (
  userPubkey: string,
  provider: CommunityEmailDigestService,
) => ({
  kinds: [EMAIL_DIGEST_STATUS_KIND],
  authors: [provider.servicePubkey],
  "#d": [EMAIL_DIGEST_DTAG],
  "#p": [userPubkey],
})

export const makeEmailDigestSubscriptionFilter = (
  userPubkey: string,
  provider: CommunityEmailDigestService,
) => ({
  kinds: [EMAIL_DIGEST_SUBSCRIPTION_KIND],
  authors: [userPubkey],
  "#d": [EMAIL_DIGEST_DTAG],
  "#p": [provider.servicePubkey],
})
