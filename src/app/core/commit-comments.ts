import {COMMENT, type Filter, type TrustedEvent} from "@welshman/util"

export const COMMIT_COMMENT_KIND = "commit"

export const getCommitCommentRoot = (oid: string) => `git:commit:${oid.trim().toLowerCase()}`

export const getCommitCommentFilters = ({
  oid,
  repoAddress,
}: {
  oid: string
  repoAddress?: string
}): Filter[] => {
  const filter: Filter = {
    kinds: [COMMENT],
    "#I": [getCommitCommentRoot(oid)],
  }

  if (repoAddress) filter["#q"] = [repoAddress]
  return [filter]
}

export const isCommitCommentForRepo = (
  event: TrustedEvent,
  {oid, repoAddress}: {oid: string; repoAddress?: string},
) => {
  const hasTag = (name: string, value: string) =>
    (event.tags || []).some(tag => tag[0] === name && tag[1] === value)

  return (
    event.kind === COMMENT &&
    hasTag("I", getCommitCommentRoot(oid)) &&
    hasTag("K", COMMIT_COMMENT_KIND) &&
    (!repoAddress || hasTag("q", repoAddress))
  )
}
