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

export const REPO_WATCH_DTAG = "budabit/repo-watch"

export type RepoWatchOptions = {
  issues: {
    new: boolean
    comments: boolean
  }
  patches: {
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
}

export type RepoWatchState = {
  version: 1
  repos: Record<string, RepoWatchOptions>
}

export type RepoWatchOptionsInput = {
  issues?: Partial<RepoWatchOptions["issues"]>
  patches?: Partial<RepoWatchOptions["patches"]>
  status?: Partial<RepoWatchOptions["status"]>
  assignments?: boolean
  reviews?: boolean
}

export const defaultRepoWatchOptions: RepoWatchOptions = {
  issues: {
    new: true,
    comments: false,
  },
  patches: {
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
  reviews: true,
}

export const defaultRepoWatchState: RepoWatchState = {
  version: 1,
  repos: {},
}

export const normalizeRepoWatchOptions = (
  options?: RepoWatchOptionsInput | null,
): RepoWatchOptions => {
  const base = defaultRepoWatchOptions
  return {
    issues: {
      new: options?.issues?.new ?? base.issues.new,
      comments: options?.issues?.comments ?? base.issues.comments,
    },
    patches: {
      new: options?.patches?.new ?? base.patches.new,
      comments: options?.patches?.comments ?? base.patches.comments,
      updates: options?.patches?.updates ?? base.patches.updates,
    },
    status: {
      open: options?.status?.open ?? base.status.open,
      draft: options?.status?.draft ?? base.status.draft,
      applied: options?.status?.applied ?? base.status.applied,
      closed: options?.status?.closed ?? base.status.closed,
    },
    assignments: options?.assignments ?? base.assignments,
    reviews: options?.reviews ?? base.reviews,
  }
}

export const normalizeRepoWatchState = (
  state?: {repos?: Record<string, RepoWatchOptionsInput>} | null,
): RepoWatchState => {
  const repos: Record<string, RepoWatchOptions> = {}
  const entries = state?.repos ? Object.entries(state.repos) : []
  for (const [repoAddr, opts] of entries) {
    repos[repoAddr] = normalizeRepoWatchOptions(opts)
  }
  return {
    version: 1,
    repos,
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

export const getRepoWatchOptions = (repoAddr: string) =>
  derived(userRepoWatchValues, $values => $values.repos[repoAddr])

export const updateRepoWatch = async (repoAddr: string, options: RepoWatchOptions | null) => {
  const $pubkey = pubkey.get()
  const $signer = signer.get()

  if (!$pubkey || !$signer) {
    throw new Error("Sign in to update watch settings.")
  }

  const current = get(userRepoWatchValues)
  const repos = {...current.repos}

  if (options) {
    repos[repoAddr] = normalizeRepoWatchOptions(options)
  } else {
    delete repos[repoAddr]
  }

  const next: RepoWatchState = {version: 1, repos}
  const content = await $signer.nip44.encrypt($pubkey, JSON.stringify(next))
  const event = makeEvent(APP_DATA, {content, tags: [["d", REPO_WATCH_DTAG]]})
  await publishThunk({event, relays: Router.get().FromUser().getUrls()})
}
