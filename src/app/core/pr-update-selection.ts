import type {TrustedEvent} from "@welshman/util"
import {
  GIT_PULL_REQUEST_UPDATE,
  parsePullRequestUpdateEvent,
  type PullRequestEvent,
  type PullRequestUpdate,
  type PullRequestUpdateEvent,
} from "@nostr-git/core/events"
import {validatePullRequestUpdateEvent} from "@nostr-git/core/utils"

const getTagValues = (event: Pick<TrustedEvent, "tags">, name: string) =>
  (event.tags || [])
    .filter(tag => tag[0] === name)
    .map(tag => tag[1])
    .filter(Boolean)

const isFullGitOid = (value: string | undefined) => /^[0-9a-f]{40}$/i.test(value || "")

export const selectAuthorizedPullRequestUpdates = ({
  root,
  updates,
  isVisible = () => true,
}: {
  root: PullRequestEvent
  updates: TrustedEvent[]
  isVisible?: (event: TrustedEvent) => boolean
}): PullRequestUpdate[] => {
  const repoAddresses = new Set(getTagValues(root as TrustedEvent, "a"))
  if (repoAddresses.size === 0) return []

  return updates
    .filter(event => {
      if (
        event.kind !== GIT_PULL_REQUEST_UPDATE ||
        event.pubkey !== root.pubkey ||
        !isVisible(event) ||
        !validatePullRequestUpdateEvent(event).success
      ) {
        return false
      }

      const rootIds = getTagValues(event, "E")
      const rootAuthors = getTagValues(event, "P")
      const updateRepoAddresses = getTagValues(event, "a")
      const tipOids = getTagValues(event, "c")
      const mergeBases = getTagValues(event, "merge-base")

      return (
        rootIds.length === 1 &&
        rootIds[0] === root.id &&
        rootAuthors.length === 1 &&
        rootAuthors[0] === root.pubkey &&
        updateRepoAddresses.length > 0 &&
        updateRepoAddresses.every(address => repoAddresses.has(address)) &&
        tipOids.length === 1 &&
        isFullGitOid(tipOids[0]) &&
        mergeBases.length <= 1 &&
        (mergeBases.length === 0 || isFullGitOid(mergeBases[0]))
      )
    })
    .sort((left, right) =>
      left.created_at !== right.created_at
        ? left.created_at - right.created_at
        : left.id.localeCompare(right.id),
    )
    .map(event => parsePullRequestUpdateEvent(event as PullRequestUpdateEvent))
}
