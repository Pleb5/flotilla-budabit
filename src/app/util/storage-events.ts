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
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_REPO_ANNOUNCEMENT,
  GIT_REPO_STATE,
  GIT_STATUS_APPLIED,
} from "@nostr-git/core/events"
import {COMMUNITY_REPORT_KIND} from "@app/core/community-reports"

const GIT_COVER_LETTER_KIND = 1624

const persistedGitDeleteKinds = new Set([
  GIT_REPO_ANNOUNCEMENT,
  GIT_REPO_STATE,
  GIT_ISSUE,
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

export const isPersistedCommunityReportDeleteEvent = (event: TrustedEvent) => {
  if (event.kind !== DELETE) return false
  if (!event.tags.some(tag => tag[0] === "e" && tag[1])) return false

  return event.tags.some(tag => tag[0] === "k" && tag[1] === String(COMMUNITY_REPORT_KIND))
}
