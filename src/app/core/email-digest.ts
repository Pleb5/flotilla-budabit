import {parseRepoAnnouncementEvent, type RepoAnnouncementEvent} from "@nostr-git/core/events"
import {parseJson} from "@welshman/lib"
import {getAddress, type TrustedEvent} from "@welshman/util"
import {verifyEvent} from "nostr-tools/pure"
import {
  COMMUNITY_DEFINITION_KIND,
  getCommunityEmailDigestServiceDescriptorKey,
  normalizeCommunityEmailDigestService,
  normalizePubkey,
  parseCommunityDefinition,
  type CommunityDefinition,
  type CommunityEmailDigestService,
} from "@app/core/community"
import type {ActiveUserCommunityRef} from "@app/core/community-membership"
import type {RepoWatchOptions, RepoWatchState} from "@app/core/repo-watch"

export const EMAIL_DIGEST_CHANNEL = "email-digest"
export const EMAIL_DIGEST_DTAG = "budabit/email-digest"
export const EMAIL_DIGEST_SETTINGS_DTAG = "budabit/email-digest-settings"
export const EMAIL_DIGEST_SUBSCRIPTION_KIND = 32830
export const EMAIL_DIGEST_STATUS_KIND = 32831
export const EMAIL_DIGEST_SETTINGS_KIND = 30078
export const EMAIL_DIGEST_MAX_REPOSITORIES = 50
export const EMAIL_DIGEST_MAX_RELAYS_PER_REPOSITORY = 3
export const EMAIL_DIGEST_MAX_UNIQUE_RELAYS = 20
export const EMAIL_DIGEST_MAX_PAYLOAD_BYTES = 64 * 1024
export const EMAIL_DIGEST_MAX_REPOSITORY_ADDRESS_LENGTH = 350
export const EMAIL_DIGEST_MAX_REPOSITORY_IDENTIFIER_LENGTH = 200
export const EMAIL_DIGEST_MAX_REPOSITORY_NAME_LENGTH = 200
export const EMAIL_DIGEST_MAX_LOCALE_LENGTH = 64

export type EmailDigestProvider = CommunityEmailDigestService & {
  endorsingCommunityPubkeys: string[]
  isActiveCommunity: boolean
}

export type EmailDigestSettings = {
  version: 1
  enabled: boolean
  email: string
  intervalDays: number
  localTime: string
  timezone: string
  selectedCommunityPubkey: string
  provider?: CommunityEmailDigestService
}

export type EmailDigestRepositoryOptions = Pick<
  RepoWatchOptions,
  "issues" | "prs" | "status" | "assignments"
>

export type EmailDigestRepository = {
  address: string
  name: string
  relays: string[]
  options: EmailDigestRepositoryOptions
}

export type EmailDigestPayload = {
  version: 1
  channel: typeof EMAIL_DIGEST_CHANNEL
  email: string
  locale?: string
  manageUrl: string
  cadence: {
    intervalDays: number
    localTime: string
    timezone: string
  }
  handler: {
    address: string
    relay: string
  }
  repositories: EmailDigestRepository[]
}

export type EmailDigestStatusValue = "pending" | "ok" | "inactive" | "error"
export type EmailDigestState =
  | "pending"
  | "active"
  | "unsubscribed"
  | "suppressed"
  | "deleted"
  | "error"

export type EmailDigestStatus = {
  version: 1
  channel: typeof EMAIL_DIGEST_CHANNEL
  status: EmailDigestStatusValue
  state: EmailDigestState
  message: string
  emailConfirmed: boolean
  nextRunAt: number | null
  lastCompletedAt: number | null
}

const LOCAL_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const REPOSITORY_ADDRESS_RE = /^30617:([0-9a-f]{64}):(.+)$/i
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/
const statusValues = new Set<EmailDigestStatusValue>(["pending", "inactive", "ok", "error"])
const stateValues = new Set<EmailDigestState>([
  "pending",
  "active",
  "unsubscribed",
  "suppressed",
  "deleted",
  "error",
])
const statusKeys = [
  "channel",
  "emailConfirmed",
  "lastCompletedAt",
  "message",
  "nextRunAt",
  "state",
  "status",
  "version",
]

const verifyEventSignature = (event: TrustedEvent) => {
  if (!event.sig) return false

  try {
    // Do not pass through a relay-provided or previously cached verification symbol.
    return verifyEvent({
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags,
      content: event.content,
      sig: event.sig,
    })
  } catch {
    return false
  }
}

export const getDefaultEmailDigestTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

export const isEmailDigestTimezone = (value: string) => {
  if (!value.trim()) return false

  try {
    new Intl.DateTimeFormat("en", {timeZone: value.trim()}).format()
    return true
  } catch {
    return false
  }
}

export const normalizeEmailDigestEmail = (value: unknown) => {
  if (typeof value !== "string") return ""
  const email = value.trim().toLowerCase()
  const [local, domain, extra] = email.split("@")
  const domainLabels = domain?.split(".") || []
  if (
    email.length < 3 ||
    email.length > 254 ||
    extra !== undefined ||
    !local ||
    local.length > 64 ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) ||
    domainLabels.length < 2 ||
    domainLabels.some(
      label =>
        !label ||
        label.length > 63 ||
        !/^[a-z0-9-]+$/i.test(label) ||
        label.startsWith("-") ||
        label.endsWith("-"),
    )
  ) {
    return ""
  }
  return email
}

export const normalizeEmailDigestLocale = (value: string | undefined) => {
  if (value === undefined) return undefined
  if (value.length > EMAIL_DIGEST_MAX_LOCALE_LENGTH) return undefined

  try {
    return new Intl.Locale(value).toString()
  } catch {
    return undefined
  }
}

export const normalizeEmailDigestIntervalDays = (value: unknown, fallback = 7) => {
  const intervalDays = typeof value === "number" ? value : Number.NaN
  return Number.isInteger(intervalDays) && intervalDays >= 1 && intervalDays <= 30
    ? intervalDays
    : fallback
}

export const normalizeEmailDigestLocalTime = (value: unknown, fallback = "09:00") => {
  const localTime = typeof value === "string" ? value.trim() : ""
  return LOCAL_TIME_RE.test(localTime) ? localTime : fallback
}

export const normalizeEmailDigestTimezone = (
  value: unknown,
  fallback = getDefaultEmailDigestTimezone(),
) => {
  const timezone = typeof value === "string" ? value.trim() : ""
  return isEmailDigestTimezone(timezone) ? timezone : fallback
}

export const defaultEmailDigestSettings: EmailDigestSettings = {
  version: 1,
  enabled: false,
  email: "",
  intervalDays: 7,
  localTime: "09:00",
  timezone: getDefaultEmailDigestTimezone(),
  selectedCommunityPubkey: "",
}

export const normalizeEmailDigestSettings = (value: unknown): EmailDigestSettings => {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  if (source.version !== 1) return {...defaultEmailDigestSettings}
  const email = normalizeEmailDigestEmail(source.email)
  const selectedCommunityPubkey = normalizePubkey(String(source.selectedCommunityPubkey || ""))
  const provider = normalizeEmailDigestProvider(
    (source.provider || {}) as CommunityEmailDigestService,
  )
  const enabled = source.enabled === true && Boolean(email && selectedCommunityPubkey && provider)

  return {
    version: 1,
    enabled,
    email,
    intervalDays: normalizeEmailDigestIntervalDays(source.intervalDays),
    localTime: normalizeEmailDigestLocalTime(source.localTime),
    timezone: normalizeEmailDigestTimezone(source.timezone),
    selectedCommunityPubkey,
    ...(provider ? {provider} : {}),
  }
}

const isVerifiedCommunityDefinition = (definition?: CommunityDefinition) => {
  if (!definition) return false
  const event = definition?.event
  if (!event?.sig || event.kind !== COMMUNITY_DEFINITION_KIND) return false
  if (normalizePubkey(event.pubkey) !== normalizePubkey(definition.pubkey)) return false
  return verifyEventSignature(event)
}

export const discoverEmailDigestProviders = ({
  activeCommunityDefinition,
  communityRefs,
}: {
  activeCommunityDefinition?: CommunityDefinition
  communityRefs: ActiveUserCommunityRef[]
}): EmailDigestProvider[] => {
  const activeCommunityPubkey = normalizePubkey(activeCommunityDefinition?.pubkey || "")
  const latestByCommunity = new Map<string, CommunityDefinition>()

  for (const candidate of [
    ...(activeCommunityDefinition ? [activeCommunityDefinition] : []),
    ...communityRefs.map(ref => ref.definition),
  ]) {
    if (!isVerifiedCommunityDefinition(candidate)) continue

    const definition = parseCommunityDefinition(candidate.event)
    if (!definition) continue

    const current = latestByCommunity.get(definition.pubkey)
    if (
      !current ||
      definition.event.created_at > current.event.created_at ||
      (definition.event.created_at === current.event.created_at &&
        definition.event.id < current.event.id)
    ) {
      latestByCommunity.set(definition.pubkey, definition)
    }
  }

  const byDescriptor = new Map<string, EmailDigestProvider>()
  const definitions = Array.from(latestByCommunity.values()).sort((a, b) => {
    const activeOrder =
      Number(b.pubkey === activeCommunityPubkey) - Number(a.pubkey === activeCommunityPubkey)
    return activeOrder || a.pubkey.localeCompare(b.pubkey)
  })

  for (const definition of definitions) {
    for (const rawService of definition.emailDigestServices) {
      const service = normalizeEmailDigestProvider(rawService)
      if (!service) continue
      const key = getCommunityEmailDigestServiceDescriptorKey(service)
      if (!key) continue

      const existing = byDescriptor.get(key)
      if (existing) {
        if (!existing.endorsingCommunityPubkeys.includes(definition.pubkey)) {
          existing.endorsingCommunityPubkeys.push(definition.pubkey)
        }
        existing.isActiveCommunity ||= definition.pubkey === activeCommunityPubkey
        continue
      }

      byDescriptor.set(key, {
        ...service,
        endorsingCommunityPubkeys: [definition.pubkey],
        isActiveCommunity: definition.pubkey === activeCommunityPubkey,
      })
    }
  }

  return Array.from(byDescriptor.values()).sort((a, b) => {
    const activeOrder = Number(b.isActiveCommunity) - Number(a.isActiveCommunity)
    return activeOrder || a.requestRelay.localeCompare(b.requestRelay)
  })
}

const normalizeSecureRelay = (value: string) => {
  if (value.length > 2048) return ""
  try {
    const url = new URL(value.trim())
    if (url.protocol !== "wss:" || !url.hostname || url.username || url.password || url.hash) {
      return ""
    }
    return url.toString()
  } catch {
    return ""
  }
}

const normalizeEmailDigestProvider = (provider: CommunityEmailDigestService) => {
  const normalized = normalizeCommunityEmailDigestService(provider)
  if (!normalized) return undefined
  const requestRelay = normalizeSecureRelay(normalized.requestRelay)
  const handlerRelay = normalizeSecureRelay(normalized.handlerRelay)
  if (!requestRelay || !handlerRelay) return undefined
  return {...normalized, requestRelay, handlerRelay}
}

const parseRepositoryAddress = (address: string) => {
  if (address.length > EMAIL_DIGEST_MAX_REPOSITORY_ADDRESS_LENGTH) return undefined
  const match = REPOSITORY_ADDRESS_RE.exec(address)
  if (!match) return undefined

  const identifier = match[2]
  if (
    identifier.length > EMAIL_DIGEST_MAX_REPOSITORY_IDENTIFIER_LENGTH ||
    CONTROL_CHAR_RE.test(identifier)
  ) {
    return undefined
  }

  return {pubkey: match[1].toLowerCase(), identifier}
}

const normalizeRepositoryName = (name: string, fallback: string) => {
  const normalized = name.trim() || fallback
  if (
    normalized.length > EMAIL_DIGEST_MAX_REPOSITORY_NAME_LENGTH ||
    CONTROL_CHAR_RE.test(normalized)
  ) {
    return ""
  }
  return normalized
}

const hasSupportedRepositoryOption = (options: EmailDigestRepositoryOptions) =>
  options.issues.new ||
  options.issues.comments ||
  options.prs.new ||
  options.prs.comments ||
  options.prs.updates ||
  options.status.open ||
  options.status.draft ||
  options.status.applied ||
  options.status.closed ||
  options.assignments

const copyRepositoryOptions = (options: RepoWatchOptions): EmailDigestRepositoryOptions => ({
  issues: {
    new: Boolean(options.issues.new),
    comments: Boolean(options.issues.comments),
  },
  prs: {
    new: Boolean(options.prs.new),
    comments: Boolean(options.prs.comments),
    updates: Boolean(options.prs.updates),
  },
  status: {
    open: Boolean(options.status.open),
    draft: Boolean(options.status.draft),
    applied: Boolean(options.status.applied),
    closed: Boolean(options.status.closed),
  },
  assignments: Boolean(options.assignments),
})

export const buildEmailDigestRepositories = ({
  watchState,
  announcements,
  fallbackRelays,
}: {
  watchState: RepoWatchState
  announcements: TrustedEvent[]
  fallbackRelays: string[]
}): EmailDigestRepository[] => {
  const entries = Object.entries(watchState.repos)
  if (entries.length > EMAIL_DIGEST_MAX_REPOSITORIES) {
    throw new Error(
      `Email digests support at most ${EMAIL_DIGEST_MAX_REPOSITORIES} watched repositories. Unwatch ${entries.length - EMAIL_DIGEST_MAX_REPOSITORIES} before enabling the digest.`,
    )
  }

  const announcementByAddress = new Map<string, RepoAnnouncementEvent>()
  for (const event of announcements) {
    if (event.kind !== 30617) continue
    try {
      announcementByAddress.set(getAddress(event), event as RepoAnnouncementEvent)
    } catch {
      // A malformed announcement cannot provide digest metadata.
    }
  }

  const normalizedFallbackRelays = Array.from(
    new Set(fallbackRelays.map(normalizeSecureRelay).filter(Boolean)),
  )
  const uniqueRelays = new Set<string>()
  const repositories = entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rawAddress, options]) => {
      const parsedAddress = parseRepositoryAddress(rawAddress)
      if (!parsedAddress) throw new Error(`Invalid watched repository address: ${rawAddress}`)

      const address = `30617:${parsedAddress.pubkey}:${parsedAddress.identifier}`
      const identifier = parsedAddress.identifier
      const announcement =
        announcementByAddress.get(rawAddress) || announcementByAddress.get(address)
      let name = identifier
      let announcementRelays: string[] = []

      if (announcement) {
        try {
          const parsed = parseRepoAnnouncementEvent(announcement)
          name = parsed.name?.trim() || parsed.repoId?.trim() || identifier
          announcementRelays = (parsed.relays || []).map(normalizeSecureRelay).filter(Boolean)
        } catch {
          // Identifier and configured Git relays are the explicit fallbacks.
        }
      }
      name = normalizeRepositoryName(name, identifier)
      if (!name) throw new Error(`Invalid repository name for ${address}.`)

      const relays = Array.from(
        new Set(announcementRelays.length > 0 ? announcementRelays : normalizedFallbackRelays),
      ).slice(0, EMAIL_DIGEST_MAX_RELAYS_PER_REPOSITORY)
      if (relays.length === 0) {
        throw new Error(`No secure relay is available for watched repository ${name}.`)
      }
      relays.forEach(relay => uniqueRelays.add(relay))

      return {
        address,
        name,
        relays,
        options: copyRepositoryOptions(options),
      }
    })

  if (uniqueRelays.size > EMAIL_DIGEST_MAX_UNIQUE_RELAYS) {
    throw new Error(
      `Watched repositories use ${uniqueRelays.size} relays; email digests support at most ${EMAIL_DIGEST_MAX_UNIQUE_RELAYS}.`,
    )
  }

  return repositories
}

const normalizeManageUrl = (value: string) => {
  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:" ||
      url.pathname !== "/settings/notifications" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      return ""
    }
    return url.toString()
  } catch {
    return ""
  }
}

export const buildEmailDigestPayload = ({
  email,
  locale,
  manageUrl,
  intervalDays,
  localTime,
  timezone,
  provider,
  repositories,
}: {
  email: string
  locale?: string
  manageUrl: string
  intervalDays: number
  localTime: string
  timezone: string
  provider: CommunityEmailDigestService
  repositories: EmailDigestRepository[]
}): EmailDigestPayload => {
  const normalizedEmail = normalizeEmailDigestEmail(email)
  if (!normalizedEmail) throw new Error("Enter a valid delivery email address.")
  if (normalizeEmailDigestIntervalDays(intervalDays, 0) !== intervalDays) {
    throw new Error("Digest cadence must be a whole number from 1 to 30 days.")
  }
  if (normalizeEmailDigestLocalTime(localTime, "") !== localTime) {
    throw new Error("Digest delivery time must use HH:MM in 24-hour time.")
  }
  if (!isEmailDigestTimezone(timezone) || timezone.trim() !== timezone) {
    throw new Error("Enter a valid IANA timezone.")
  }
  const normalizedManageUrl = normalizeManageUrl(manageUrl)
  if (!normalizedManageUrl) {
    throw new Error("Digest management requires the HTTPS Budabit notifications URL.")
  }
  const normalizedProvider = normalizeEmailDigestProvider(provider)
  if (!normalizedProvider) throw new Error("The selected email digest provider is invalid.")
  if (repositories.length === 0) throw new Error("Watch at least one repository first.")
  if (repositories.length > EMAIL_DIGEST_MAX_REPOSITORIES) {
    throw new Error(`Email digests support at most ${EMAIL_DIGEST_MAX_REPOSITORIES} repositories.`)
  }

  const normalizedLocale = normalizeEmailDigestLocale(locale)
  if (locale !== undefined && normalizedLocale === undefined) {
    throw new Error("Enter a valid locale of at most 64 characters.")
  }
  const repositoryAddresses = new Set<string>()
  const repositoryRelays = new Set<string>()
  const normalizedRepositories = repositories.map(repository => {
    const parsedAddress = parseRepositoryAddress(repository.address)
    if (!parsedAddress) {
      throw new Error(`Invalid digest repository address: ${repository.address}`)
    }
    const address = `30617:${parsedAddress.pubkey}:${parsedAddress.identifier}`
    if (repositoryAddresses.has(address)) {
      throw new Error(`Duplicate digest repository address: ${address}`)
    }
    repositoryAddresses.add(address)

    const relays = Array.from(new Set(repository.relays.map(normalizeSecureRelay).filter(Boolean)))
    if (relays.length === 0 || relays.length !== repository.relays.length) {
      throw new Error(`Repository ${repository.name} must use unique secure WebSocket relays.`)
    }
    if (relays.length > EMAIL_DIGEST_MAX_RELAYS_PER_REPOSITORY) {
      throw new Error(
        `Repository ${repository.name} has more than ${EMAIL_DIGEST_MAX_RELAYS_PER_REPOSITORY} relays.`,
      )
    }
    relays.forEach(relay => repositoryRelays.add(relay))

    const name = normalizeRepositoryName(repository.name, parsedAddress.identifier)
    if (!name) throw new Error(`Invalid repository name for ${repository.address}.`)

    return {
      address,
      name,
      relays,
      options: {
        issues: {
          new: Boolean(repository.options.issues.new),
          comments: Boolean(repository.options.issues.comments),
        },
        prs: {
          new: Boolean(repository.options.prs.new),
          comments: Boolean(repository.options.prs.comments),
          updates: Boolean(repository.options.prs.updates),
        },
        status: {
          open: Boolean(repository.options.status.open),
          draft: Boolean(repository.options.status.draft),
          applied: Boolean(repository.options.status.applied),
          closed: Boolean(repository.options.status.closed),
        },
        assignments: Boolean(repository.options.assignments),
      },
    }
  })
  if (repositoryRelays.size > EMAIL_DIGEST_MAX_UNIQUE_RELAYS) {
    throw new Error(
      `Digest repositories use ${repositoryRelays.size} relays; at most ${EMAIL_DIGEST_MAX_UNIQUE_RELAYS} are supported.`,
    )
  }

  if (
    !normalizedRepositories.some(repository => hasSupportedRepositoryOption(repository.options))
  ) {
    throw new Error("Select at least one supported email digest event option.")
  }

  const payload: EmailDigestPayload = {
    version: 1,
    channel: EMAIL_DIGEST_CHANNEL,
    email: normalizedEmail,
    ...(normalizedLocale ? {locale: normalizedLocale} : {}),
    manageUrl: normalizedManageUrl,
    cadence: {intervalDays, localTime, timezone},
    handler: {
      address: normalizedProvider.handlerAddress,
      relay: normalizedProvider.handlerRelay,
    },
    repositories: normalizedRepositories,
  }
  if (
    new TextEncoder().encode(JSON.stringify(payload)).byteLength > EMAIL_DIGEST_MAX_PAYLOAD_BYTES
  ) {
    throw new Error("Email digest configuration exceeds the 64 KiB payload limit.")
  }

  return payload
}

export const getNextEmailDigestCreatedAt = (
  currentCreatedAt?: number,
  now = Math.floor(Date.now() / 1000),
) => Math.max(now, currentCreatedAt ? currentCreatedAt + 1 : 0)

export const getEmailDigestSubscriptionTags = (servicePubkey: string) => [
  ["d", EMAIL_DIGEST_DTAG],
  ["p", servicePubkey],
]

export const getEmailDigestStatusTags = (userPubkey: string) => [
  ["d", EMAIL_DIGEST_DTAG],
  ["p", userPubkey],
]

const hasExactTags = (actual: string[][], expected: string[][]) =>
  JSON.stringify(actual) === JSON.stringify(expected)

const isVerifiedEvent = (event: TrustedEvent) => {
  return verifyEventSignature(event)
}

const selectLatest = (events: TrustedEvent[]) =>
  [...events].sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0]

export const selectEmailDigestSubscriptionEvent = (
  events: TrustedEvent[],
  userPubkey: string,
  provider: CommunityEmailDigestService,
) =>
  selectLatest(
    events.filter(
      event =>
        event.kind === EMAIL_DIGEST_SUBSCRIPTION_KIND &&
        event.pubkey === userPubkey &&
        hasExactTags(event.tags, getEmailDigestSubscriptionTags(provider.servicePubkey)) &&
        isVerifiedEvent(event),
    ),
  )

export const selectEmailDigestStatusEvent = (
  events: TrustedEvent[],
  userPubkey: string,
  provider: CommunityEmailDigestService,
) =>
  selectLatest(
    events.filter(
      event =>
        event.kind === EMAIL_DIGEST_STATUS_KIND &&
        event.pubkey === provider.servicePubkey &&
        hasExactTags(event.tags, getEmailDigestStatusTags(userPubkey)) &&
        isVerifiedEvent(event),
    ),
  )

const isStatusTimestamp = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value))

export const parseEmailDigestStatus = (value: unknown): EmailDigestStatus | undefined => {
  if (!value || typeof value !== "object") return undefined
  const source = value as Record<string, unknown>
  if (
    JSON.stringify(Object.keys(source).sort()) !== JSON.stringify(statusKeys) ||
    source.version !== 1 ||
    source.channel !== EMAIL_DIGEST_CHANNEL ||
    !statusValues.has(source.status as EmailDigestStatusValue) ||
    !stateValues.has(source.state as EmailDigestState) ||
    typeof source.message !== "string" ||
    typeof source.emailConfirmed !== "boolean" ||
    !isStatusTimestamp(source.nextRunAt) ||
    !isStatusTimestamp(source.lastCompletedAt)
  ) {
    return undefined
  }

  return {
    version: 1,
    channel: EMAIL_DIGEST_CHANNEL,
    status: source.status as EmailDigestStatusValue,
    state: source.state as EmailDigestState,
    message: source.message,
    emailConfirmed: source.emailConfirmed,
    nextRunAt: source.nextRunAt,
    lastCompletedAt: source.lastCompletedAt,
  }
}

export const decryptEmailDigestSettingsEvent = async ({
  event,
  activePubkey,
  decrypt,
}: {
  event: TrustedEvent
  activePubkey: string
  decrypt: (pubkey: string, content: string) => Promise<string>
}) => {
  if (!activePubkey || event.pubkey !== activePubkey) {
    throw new Error("Email digest settings do not belong to the active signer.")
  }
  const plaintext = await decrypt(event.pubkey, event.content)
  return normalizeEmailDigestSettings(parseJson(plaintext))
}

export type EmailDigestProviderQueryCompletion = {
  authenticated: boolean
  eose: boolean
  timedOut: boolean
  closedReason?: string
  disconnected: boolean
}

export const assertEmailDigestProviderQueryComplete = (
  completion: EmailDigestProviderQueryCompletion,
) => {
  if (completion.timedOut) throw new Error("Email digest provider query timed out before EOSE.")
  if (completion.closedReason) {
    throw new Error(`Email digest provider closed the query: ${completion.closedReason}`)
  }
  if (completion.disconnected) {
    throw new Error("Email digest provider disconnected before EOSE.")
  }
  if (!completion.authenticated) {
    throw new Error("Email digest provider authentication did not complete.")
  }
  if (!completion.eose) throw new Error("Email digest provider query ended before EOSE.")
}

const terminalEmailDigestStates = new Set<EmailDigestState>([
  "unsubscribed",
  "deleted",
  "suppressed",
  "error",
])

export const shouldAutoSyncEmailDigestProviderState = (status?: EmailDigestStatus) =>
  !status || !terminalEmailDigestStates.has(status.state)

export const runEmailDigestDisableSequence = async <T>({
  subscriptionCreatedAt,
  currentTime,
  publishDeletion,
  persistDisabled,
}: {
  subscriptionCreatedAt?: number
  currentTime?: number
  publishDeletion: (createdAt: number) => Promise<unknown>
  persistDisabled: () => Promise<T>
}) => {
  if (subscriptionCreatedAt !== undefined) {
    await publishDeletion(getNextEmailDigestCreatedAt(subscriptionCreatedAt, currentTime))
  }
  return persistDisabled()
}

export const runEmailDigestSaveSequence = async <T>({
  switchingProvider,
  deleteOldProvider,
  persistNextSettings,
  publishNewRegistration,
}: {
  switchingProvider: boolean
  deleteOldProvider: () => Promise<unknown>
  persistNextSettings: () => Promise<unknown>
  publishNewRegistration: () => Promise<T>
}) => {
  if (switchingProvider) await deleteOldProvider()
  await persistNextSettings()
  return publishNewRegistration()
}

export const isEmailDigestProviderAdvertised = (
  provider: CommunityEmailDigestService | undefined,
  advertisedProviders: CommunityEmailDigestService[],
) => {
  const key = provider ? getCommunityEmailDigestServiceDescriptorKey(provider) : ""
  return Boolean(
    key &&
    advertisedProviders.some(
      candidate => getCommunityEmailDigestServiceDescriptorKey(candidate) === key,
    ),
  )
}

export const shouldAutoSyncEmailDigest = (
  settings: EmailDigestSettings,
  advertisedProviders: CommunityEmailDigestService[],
) => settings.enabled && isEmailDigestProviderAdvertised(settings.provider, advertisedProviders)

export const runBestEffortEmailDigestSync = async ({
  shouldSync,
  sync,
  onError = error => console.warn("[email-digest] Failed to synchronize watch settings", error),
}: {
  shouldSync: boolean
  sync: () => Promise<unknown>
  onError?: (error: unknown) => void
}) => {
  if (!shouldSync) return false

  try {
    const result = await sync()
    return result !== false
  } catch (error) {
    onError(error)
    return false
  }
}
