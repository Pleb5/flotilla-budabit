import {derived, get} from "svelte/store"
import {parseJson} from "@welshman/lib"
import {APP_DATA, makeEvent, type TrustedEvent} from "@welshman/util"
import {deriveItemsByKey, getter, makeLoadItem} from "@welshman/store"
import {
  ensurePlaintext,
  makeOutboxLoader,
  makeUserData,
  makeUserLoader,
  pubkey,
  publishThunk,
  repository,
  signer,
} from "@welshman/app"
import {Router} from "@welshman/router"
import {getUserDataPublishRelays} from "@app/core/community-relays"

export const REPO_WATCH_DTAG = "budabit/repo-watch"

export type RepoWatchActivityFilter = "all" | "community" | "maintainers" | "maintainers-community"

const repoWatchActivityFilters = new Set<RepoWatchActivityFilter>([
  "all",
  "community",
  "maintainers",
  "maintainers-community",
])

export type RepoWatchOptions = {
  issues: {
    new: boolean
    comments: boolean
  }
  prs: {
    new: boolean
    comments: boolean
    updates: boolean
  }
  status: {
    open: boolean
    draft: boolean
    applied: boolean
    closed: boolean
  }
  assignments: boolean
  reviews: boolean
  activityFilter: RepoWatchActivityFilter
}

export type RepoWatchState = {
  version: 1
  repos: Record<string, RepoWatchOptions>
  notificationSeen: Record<string, number>
}

export type RepoWatchOptionsInput = {
  issues?: Partial<RepoWatchOptions["issues"]>
  patches?: Partial<RepoWatchOptions["prs"]>
  prs?: Partial<RepoWatchOptions["prs"]>
  status?: Partial<RepoWatchOptions["status"]>
  assignments?: boolean
  reviews?: boolean
  activityFilter?: RepoWatchActivityFilter | string
}

export const defaultRepoWatchOptions: RepoWatchOptions = {
  issues: {
    new: true,
    comments: false,
  },
  prs: {
    new: true,
    comments: false,
    updates: true,
  },
  status: {
    open: true,
    draft: true,
    applied: true,
    closed: true,
  },
  assignments: true,
  reviews: false,
  activityFilter: "all",
}

export const normalizeRepoWatchActivityFilter = (
  value?: RepoWatchActivityFilter | string | null,
): RepoWatchActivityFilter => {
  return repoWatchActivityFilters.has(value as RepoWatchActivityFilter)
    ? (value as RepoWatchActivityFilter)
    : defaultRepoWatchOptions.activityFilter
}

export const defaultRepoWatchState: RepoWatchState = {
  version: 1,
  repos: {},
  notificationSeen: {},
}

export const normalizeRepoWatchOptions = (
  options?: RepoWatchOptionsInput | null,
): RepoWatchOptions => {
  const base = defaultRepoWatchOptions
  const prOptions = options?.prs ?? options?.patches
  return {
    issues: {
      new: options?.issues?.new ?? base.issues.new,
      comments: options?.issues?.comments ?? base.issues.comments,
    },
    prs: {
      new: prOptions?.new ?? base.prs.new,
      comments: prOptions?.comments ?? base.prs.comments,
      updates: prOptions?.updates ?? base.prs.updates,
    },
    status: {
      open: options?.status?.open ?? base.status.open,
      draft: options?.status?.draft ?? base.status.draft,
      applied: options?.status?.applied ?? base.status.applied,
      closed: options?.status?.closed ?? base.status.closed,
    },
    assignments: options?.assignments ?? base.assignments,
    reviews: options?.reviews ?? base.reviews,
    activityFilter: normalizeRepoWatchActivityFilter(options?.activityFilter),
  }
}

const normalizeTimestamp = (value: unknown) => {
  const timestamp = Number(value || 0)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0
  return timestamp > 10_000_000_000 ? Math.round(timestamp / 1000) : Math.round(timestamp)
}

const normalizeRepoWatchNotificationSeen = (state?: {
  notificationSeen?: Record<string, unknown>
  seen?: Record<string, unknown>
}) => {
  const out: Record<string, number> = {}
  const input = state?.notificationSeen || state?.seen || {}

  for (const [path, timestamp] of Object.entries(input)) {
    const normalized = normalizeTimestamp(timestamp)
    if (path && normalized > 0) out[path] = normalized
  }

  return out
}

export const normalizeRepoWatchState = (
  state?: {
    repos?: Record<string, RepoWatchOptionsInput>
    notificationSeen?: Record<string, unknown>
    seen?: Record<string, unknown>
  } | null,
): RepoWatchState => {
  const repos: Record<string, RepoWatchOptions> = {}
  const entries = state?.repos ? Object.entries(state.repos) : []
  for (const [repoAddr, opts] of entries) {
    repos[repoAddr] = normalizeRepoWatchOptions(opts)
  }
  return {
    version: 1,
    repos,
    notificationSeen: normalizeRepoWatchNotificationSeen(state || undefined),
  }
}

export type RepoWatchItem = {
  event: TrustedEvent
  values: RepoWatchState
}

export const repoWatchByPubkey = deriveItemsByKey<RepoWatchItem>({
  repository,
  getKey: item => item.event.pubkey,
  filters: [{kinds: [APP_DATA], "#d": [REPO_WATCH_DTAG]}],
  eventToItem: async event => {
    const values = normalizeRepoWatchState(parseJson(await ensurePlaintext(event)))
    return {event, values}
  },
})

export const getRepoWatchByPubkey = getter(repoWatchByPubkey)

export const getRepoWatch = (pubkey: string) => getRepoWatchByPubkey().get(pubkey)

export const loadRepoWatch = makeLoadItem(
  makeOutboxLoader(APP_DATA, {"#d": [REPO_WATCH_DTAG]}),
  getRepoWatch,
)

export const userRepoWatch = makeUserData(repoWatchByPubkey, loadRepoWatch)

export const loadUserRepoWatch = makeUserLoader(loadRepoWatch)

export const userRepoWatchValues = derived(
  userRepoWatch,
  $data => $data?.values || defaultRepoWatchState,
)

export const repoWatchNotificationSeen = derived(
  userRepoWatchValues,
  $values => $values.notificationSeen || {},
)

export const getRepoWatchOptions = (repoAddr: string) =>
  derived(userRepoWatchValues, $values => $values.repos[repoAddr])

const publishRepoWatchState = async (next: RepoWatchState) => {
  const $pubkey = pubkey.get()
  const $signer = signer.get()

  if (!$pubkey || !$signer) {
    throw new Error("Sign in to update watch settings.")
  }

  const content = await $signer.nip44.encrypt($pubkey, JSON.stringify(next))
  const event = makeEvent(APP_DATA, {content, tags: [["d", REPO_WATCH_DTAG]]})
  await publishThunk({event, relays: getUserDataPublishRelays(Router.get().FromUser().getUrls())})
}

export const updateRepoWatch = async (repoAddr: string, options: RepoWatchOptions | null) => {
  const current = get(userRepoWatchValues)
  const repos = {...current.repos}

  if (options) {
    repos[repoAddr] = normalizeRepoWatchOptions(options)
  } else {
    delete repos[repoAddr]
  }

  await publishRepoWatchState({
    version: 1,
    repos,
    notificationSeen: current.notificationSeen || {},
  })
}

export const updateRepoWatchNotificationSeen = async (updates: Record<string, number>) => {
  const entries = Object.entries(updates)
    .map(([path, timestamp]) => [path, normalizeTimestamp(timestamp)] as const)
    .filter(([path, timestamp]) => path && timestamp > 0)

  if (entries.length === 0) return

  const current = get(userRepoWatchValues)
  const notificationSeen = {...(current.notificationSeen || {})}
  let changed = false

  for (const [path, timestamp] of entries) {
    const existing = normalizeTimestamp(notificationSeen[path])
    if (existing >= timestamp) continue

    notificationSeen[path] = timestamp
    changed = true
  }

  if (!changed) return

  await publishRepoWatchState({
    version: 1,
    repos: current.repos || {},
    notificationSeen,
  })
}
