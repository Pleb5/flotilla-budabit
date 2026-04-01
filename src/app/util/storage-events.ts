import {
  COMMENT,
  DELETE,
  GIT_STATUS_CLOSED,
  GIT_STATUS_COMPLETE,
  GIT_STATUS_DRAFT,
  GIT_STATUS_OPEN,
  getTagValue,
  type TrustedEvent,
} from "@welshman/util"
import {
  GIT_ISSUE,
  GIT_LABEL,
  GIT_PATCH,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_REPO_ANNOUNCEMENT,
  GIT_REPO_STATE,
  GIT_STATUS_APPLIED,
} from "@nostr-git/core/events"

const GIT_COVER_LETTER_KIND = 1624

const persistedGitDeleteKinds = new Set([
  GIT_REPO_ANNOUNCEMENT,
  GIT_REPO_STATE,
  GIT_ISSUE,
  GIT_PATCH,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_LABEL,
  GIT_COVER_LETTER_KIND,
  GIT_STATUS_OPEN,
  GIT_STATUS_DRAFT,
  GIT_STATUS_CLOSED,
  GIT_STATUS_COMPLETE,
  GIT_STATUS_APPLIED,
  COMMENT,
])

export const isPersistedGitDeleteEvent = (event: TrustedEvent) => {
  if (event.kind !== DELETE) return false

  const repoAddress = getTagValue("repo", event.tags)
  const targetKind = Number(getTagValue("k", event.tags))

  if (!repoAddress) return false
  if (!Number.isFinite(targetKind)) return false

  return persistedGitDeleteKinds.has(targetKind)
}
