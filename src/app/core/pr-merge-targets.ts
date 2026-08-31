import {isPushCapableCloneUrl} from "@nostr-git/core/utils"

export type PrMergeRemote = {
  remote: string
  url: string
  primary: boolean
}

export const planPrMergeRemotes = ({
  declaredCloneUrls,
  configuredRemotes = [],
}: {
  declaredCloneUrls: string[]
  configuredRemotes?: Array<{remote: string; url: string}>
}): {primaryUrl: string; primaryPushCapable: boolean; remotes: PrMergeRemote[]} => {
  const declared = declaredCloneUrls.map(url => String(url || "").trim()).filter(Boolean)
  const primaryUrl = declared[0] || ""
  const configuredNames = new Map(
    configuredRemotes
      .map(remote => [String(remote.url || "").trim(), String(remote.remote || "").trim()] as const)
      .filter(([url]) => Boolean(url)),
  )
  const seen = new Set<string>()
  const remotes = declared
    .filter(isPushCapableCloneUrl)
    .filter(url => {
      if (seen.has(url)) return false
      seen.add(url)
      return true
    })
    .map((url, index) => ({
      remote: configuredNames.get(url) || `remote-${index + 1}`,
      url,
      primary: url === primaryUrl,
    }))

  return {
    primaryUrl,
    primaryPushCapable: Boolean(primaryUrl && isPushCapableCloneUrl(primaryUrl)),
    remotes,
  }
}

export const resolvePrTargetBranch = ({
  targetBranch,
  repositoryDefaultBranch,
  normalize,
}: {
  targetBranch?: string
  repositoryDefaultBranch?: string
  normalize: (branch: string) => string
}): {branch: string; source: "explicit" | "repository-default"; error?: undefined} | {error: string} => {
  if (targetBranch !== undefined) {
    const branch = normalize(targetBranch)
    return branch
      ? {branch, source: "explicit"}
      : {error: "This PR has an invalid target-branch tag."}
  }

  const branch = normalize(repositoryDefaultBranch || "")
  return branch
    ? {branch, source: "repository-default"}
    : {error: "The repository default branch could not be determined."}
}
